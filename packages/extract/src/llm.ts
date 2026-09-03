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

/** USD per million tokens, from the published price list. Update alongside model ids. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

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
  usage: { input_tokens: number; output_tokens: number },
): number {
  const price = PRICING[model];
  if (!price) return 0; // unknown model: report 0 rather than guess a number into ExtractRun
  return ((usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000) * 100;
}

export const complete: CompleteFn = async <T>(req: CompleteRequest<T>): Promise<Completion<T>> => {
  const res = await getClient().beta.messages.parse({
    model: req.model,
    max_tokens: req.maxTokens ?? 16000,
    thinking: { type: "adaptive" },
    system: req.system,
    messages: [{ role: "user", content: req.input }],
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
