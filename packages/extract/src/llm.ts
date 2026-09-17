/**
 * The model seam.
 *
 * This is the ONLY file in the repo permitted to import an AI vendor SDK.
 * Everything else — pipeline, CLI, API — imports `complete` from here. The rule
 * is enforced by `no-vendor-sdk.test.ts`, not by convention.
 *
 * Why a seam at all: extraction provenance is editorial. `Position.extractedBy`
 * has to name the exact model that produced a row, and the two-model reconcile
 * is only meaningful if both calls are independent and attributable.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ZodType } from "zod";

/**
 * The two models the reconcile step runs. They must be different models, not
 * the same model twice — agreement between two samples of one model measures
 * temperature, not truth.
 */
export const MODEL_A = process.env.EXTRACT_MODEL_A ?? "claude-opus-5";
export const MODEL_B = process.env.EXTRACT_MODEL_B ?? "claude-sonnet-5";

/**
 * USD per million tokens, from the published price list, plus whether the model
 * accepts `thinking: {type:"adaptive"}`. Update alongside model ids.
 *
 * Adaptive thinking is a Claude 5 feature; sending it to a model that does not
 * support it is a hard 400, not a degraded response, so it has to be gated per
 * model rather than sent hopefully. Unknown models default to NOT sending it —
 * losing the feature costs quality, sending it wrongly costs the whole run.
 */
const PRICING: Record<string, { input: number; output: number; adaptiveThinking: boolean }> = {
  "claude-opus-5": { input: 5, output: 25, adaptiveThinking: true },
  "claude-sonnet-5": { input: 2, output: 10, adaptiveThinking: true },
  "claude-haiku-4-5": { input: 1, output: 5, adaptiveThinking: false },
};

/** Cents for this many uncached input tokens. Unknown models: 0, never a guess. */
export function inputCentsFor(model: string, tokens: number): number {
  const price = PRICING[model];
  return price ? (tokens / 1_000_000) * price.input * 100 : 0;
}

/** Whether `model` accepts adaptive thinking. Unknown models: assume not. */
export function supportsAdaptiveThinking(model: string): boolean {
  return PRICING[model]?.adaptiveThinking ?? false;
}

/**
 * The user turn, with `cachedInput` (when present) in its own block behind a cache
 * breakpoint and the varying input after it. Shared by `complete` and
 * `countInputTokens` so the request that is counted is the request that is sent.
 *
 * Caching is a prefix match: the breakpoint must sit at the END of the shared part,
 * never after the document, or every call writes a distinct entry and none is read.
 */
function userContent(req: Pick<CompleteRequest<unknown>, "cachedInput" | "input">) {
  if (!req.cachedInput) return req.input;
  return [
    { type: "text" as const, text: req.cachedInput, cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: req.input },
  ];
}

/**
 * A safety classifier declined the request. Not a crash and not a retry: the
 * source goes to the review queue for a human to read. We deliberately do not
 * use server-side refusal fallbacks here — silently completing on a different
 * model would put a model id in `extractedBy` that never saw the document.
 */
export class ModelRefusalError extends Error {
  constructor(
    readonly model: string,
    readonly category: string | null,
    explanation?: string | null,
  ) {
    super(`${model} declined the request (${category ?? "unspecified"})${explanation ? `: ${explanation}` : ""}`);
    this.name = "ModelRefusalError";
  }
}

export class ModelOutputError extends Error {
  constructor(readonly model: string, message: string) {
    super(`${model}: ${message}`);
    this.name = "ModelOutputError";
  }
}

export interface CompleteRequest<T> {
  model: string;
  system: string;
  /**
   * Stable text that opens the user turn and repeats across calls — the proposition
   * list, which is identical for every source at the same jurisdiction level. Sent
   * as its own block behind a cache breakpoint, so it bills at ~0.1x after the first
   * call instead of full price on every one. Leave unset when nothing repeats: a
   * breakpoint on content that is never reused only adds the 1.25x write premium.
   */
  cachedInput?: string;
  /** The part that varies per call (the document), placed after the breakpoint. */
  input: string;
  /** The model is constrained to this shape server-side, then re-validated here. */
  schema: ZodType<T>;
  maxTokens?: number;
}

export interface Completion<T> {
  model: string;
  output: T;
  /** Fractional. Callers sum across a run and round once when writing ExtractRun. */
  costCents: number;
}

/** Injectable so the pipeline can be tested against recorded outputs with no network. */
export type CompleteFn = <T>(req: CompleteRequest<T>) => Promise<Completion<T>>;

let client: Anthropic | undefined;
function getClient(): Anthropic {
  // Lazy so importing this module never requires credentials (tests, typecheck, CLI --help).
  //
  // An identity-linked key is not bound to one workspace, so the API rejects it
  // with a 400 unless each request names the workspace it acts in. The SDK reads
  // ANTHROPIC_WORKSPACE_ID on its own only for OAuth and federated credentials —
  // on the API-key path we have to send the header ourselves. A workspace-scoped
  // key carries its own workspace, so leaving the variable unset is correct there.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
  client ??= new Anthropic(
    workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {},
  );
  return client;
}

export function estimateCostCents(
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  },
): number {
  const price = PRICING[model];
  if (!price) return 0; // unknown model: report 0 rather than guess a number into ExtractRun

  // Cached input is billed differently: a write costs 1.25x an ordinary input token
  // and a read costs 0.1x. Counting cache reads at full price would report a run as
  // far more expensive than it was, which makes the --max-cost limit fire early.
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const plain = usage.input_tokens;

  const inputCost = (plain + write * 1.25 + read * 0.1) * price.input;
  return ((inputCost + usage.output_tokens * price.output) / 1_000_000) * 100;
}

export const complete: CompleteFn = async <T>(req: CompleteRequest<T>): Promise<Completion<T>> => {
  const res = await getClient().beta.messages.parse({
    model: req.model,
    max_tokens: req.maxTokens ?? 16000,
    ...(supportsAdaptiveThinking(req.model) ? { thinking: { type: "adaptive" as const } } : {}),
    // Two breakpoints, one per stable layer. The system prompt (~2,000 tokens) is
    // byte-identical across every call. The proposition list (~2,900 tokens for
    // twenty) is identical for every source at a jurisdiction level but lives in the
    // user turn, not here — this comment used to say otherwise, and for as long as it
    // did the larger of the two layers was billed at full price on every call. See
    // userContent() for the second breakpoint.
    system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent(req) }],
    output_config: { format: betaZodOutputFormat(req.schema) },
  });

  if (res.stop_reason === "refusal") {
    throw new ModelRefusalError(
      res.model,
      res.stop_details?.category ?? null,
      res.stop_details?.explanation,
    );
  }
  if (res.stop_reason === "max_tokens") {
    throw new ModelOutputError(res.model, "hit max_tokens before finishing; raise maxTokens or split the source");
  }
  if (res.parsed_output === null || res.parsed_output === undefined) {
    throw new ModelOutputError(res.model, "response did not parse against the schema");
  }

  return {
    model: res.model,
    output: res.parsed_output as T,
    costCents: estimateCostCents(res.model, res.usage),
  };
};

/**
 * Exact input tokens for a request, without running it.
 *
 * Token counting is free, so a cost estimate can use the real count of what would be
 * sent rather than a characters-divided-by-four guess. Built from the same system,
 * messages, thinking and output format as `complete`, so the count matches what the
 * real call would be billed for on the input side.
 */
export async function countInputTokens<T>(req: CompleteRequest<T>): Promise<number> {
  const res = await getClient().beta.messages.countTokens({
    model: req.model,
    // Same gate as complete(): counting with adaptive thinking on a model that does
    // not support it is the same 400 the real call would get.
    ...(supportsAdaptiveThinking(req.model) ? { thinking: { type: "adaptive" as const } } : {}),
    system: [{ type: "text", text: req.system }],
    messages: [{ role: "user", content: userContent(req) }],
    output_config: { format: betaZodOutputFormat(req.schema) },
  });
  return res.input_tokens;
}
