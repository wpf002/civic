import {
  ExtractedPositionSchema,
  LenientExtractionOutputSchema,
  findVerbatim,
  type ExtractedPosition,
} from "@civic/core";
import { complete, type CompleteFn } from "./llm.js";
import { EXTRACT_SYSTEM } from "./prompts/extract-positions.js";

export interface Proposition {
  issueSlug: string;
  text: string;
  yesMeans: string;
  noMeans: string;
}

export interface ExtractInput {
  sourceText: string;
  issueSlugs: string[];
  /**
   * The question each issue's stance answers.
   *
   * Optional only so existing tests can pass a bare issue list. When absent the model
   * is shown slugs alone, which is the behaviour that produced 128 supporting stances
   * against 5 opposing ones — a stance toward a topic has no direction.
   */
  propositions?: Proposition[];
}

export interface ExtractOutcome {
  model: string;
  /** The propositions this reader says the document addresses. */
  addressed: string[];
  positions: ExtractedPosition[];
  rejected: Array<{ position: ExtractedPosition; reason: string }>;
  costCents: number;
}

/** Show the model the actual question, not the topic name. */
function renderInput(input: ExtractInput): string {
  const list = input.propositions?.length
    ? input.propositions
        .map(
          (p, i) =>
            `${i + 1}. issueSlug: ${p.issueSlug}\n   QUESTION: ${p.text}\n` +
            `   agreeing means: ${p.yesMeans}\n   disagreeing means: ${p.noMeans}`,
        )
        .join("\n\n")
    : input.issueSlugs.map((s, i) => `${i + 1}. issueSlug: ${s}`).join("\n");

  return `PROPOSITIONS:\n${list}\n\nDOCUMENT:\n${input.sourceText}`;
}

/**
 * One model, one source. Validates quotes against the source text before returning.
 * `fn` is injectable so tests can replay recorded model output without a network call.
 */
export async function extractOnce(
  input: ExtractInput,
  model: string,
  fn: CompleteFn = complete,
): Promise<ExtractOutcome> {
  const res = await fn({
    model,
    system: EXTRACT_SYSTEM,
    input: renderInput(input),
    schema: LenientExtractionOutputSchema,
  });

  const positions: ExtractedPosition[] = [];
  const rejected: ExtractOutcome["rejected"] = [];
  for (const raw of res.output.positions) {
    // Enforce the length caps here rather than at the transport layer, so one
    // oversized field costs one position instead of the whole document.
    const strict = ExtractedPositionSchema.safeParse(raw);
    if (!strict.success) {
      rejected.push({
        position: raw as ExtractedPosition,
        reason: strict.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      continue;
    }
    const p = strict.data;
    if (!input.issueSlugs.includes(p.issueSlug)) {
      rejected.push({ position: p, reason: "unknown issue" });
      continue;
    }
    if (p.stance === "NO_STATED_POSITION") {
      positions.push(p);
      continue;
    }
    const match = findVerbatim(input.sourceText, p.quote);
    if (!match) {
      rejected.push({ position: p, reason: "quote not found verbatim in source" });
      continue;
    }
    // Store the archived source's own span, never the model's rendering of it.
    positions.push({ ...p, quote: match.quote });
  }
  // A slug the reader listed but produced no usable position for still counts as
  // addressed: it is a claim that the document says something, and losing it would
  // silently turn a rejected quote into an agreed silence.
  const addressed = [...new Set([...(res.output.addressed ?? []), ...positions.map((p) => p.issueSlug)])]
    .filter((s) => input.issueSlugs.includes(s));

  return { model: res.model, addressed, positions, rejected, costCents: res.costCents };
}

/**
 * Two independent models. Agreement on stance => DRAFT with min confidence.
 * Disagreement or either NO_STATED => ReviewTask.
 */
/**
 * Two independent models. Agreement on stance => DRAFT with min confidence.
 *
 * `allIssueSlugs` is required to tell a shared silence from a shared oversight. A
 * proposition neither reader listed as addressed is an agreed absence and becomes a
 * NO_STATED_POSITION draft. One that only one reader listed is a disagreement and
 * goes to a person, exactly as a stance disagreement does.
 */
export function reconcile(a: ExtractOutcome, b: ExtractOutcome, allIssueSlugs: string[] = []) {
  const byIssue = (o: ExtractOutcome) => new Map(o.positions.map((p) => [p.issueSlug, p]));
  const ma = byIssue(a);
  const mb = byIssue(b);
  const sa = new Set(a.addressed);
  const sb = new Set(b.addressed);

  const agreed: ExtractedPosition[] = [];
  const flagged: Array<{ issueSlug: string; a?: ExtractedPosition; b?: ExtractedPosition }> = [];

  for (const slug of new Set([...ma.keys(), ...mb.keys()])) {
    const pa = ma.get(slug), pb = mb.get(slug);
    if (pa && pb && pa.stance === pb.stance) {
      agreed.push({ ...pa, confidence: Math.min(pa.confidence, pb.confidence) });
    } else {
      flagged.push({ issueSlug: slug, ...(pa ? { a: pa } : {}), ...(pb ? { b: pb } : {}) });
    }
  }

  for (const slug of allIssueSlugs) {
    if (ma.has(slug) || mb.has(slug)) continue;
    if (sa.has(slug) || sb.has(slug)) {
      // One reader says the document addresses this and produced nothing usable.
      // That is a disagreement about whether the candidate spoke, not a silence.
      if (!flagged.some((f) => f.issueSlug === slug)) flagged.push({ issueSlug: slug });
      continue;
    }
    agreed.push({
      issueSlug: slug,
      stance: "NO_STATED_POSITION",
      summary: "The document does not address this question.",
      quote: "",
      confidence: Math.min(0.9, 0.9),
    });
  }

  return { agreed, flagged };
}
