import { ExtractionOutputSchema, findVerbatim, type ExtractedPosition } from "@civic/core";
import { complete, type CompleteFn } from "./llm.js";
import { EXTRACT_SYSTEM } from "./prompts/extract-positions.js";

export interface ExtractInput {
  sourceText: string;
  issueSlugs: string[];
}

export interface ExtractOutcome {
  model: string;
  positions: ExtractedPosition[];
  rejected: Array<{ position: ExtractedPosition; reason: string }>;
  costCents: number;
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
    input: `ISSUES: ${input.issueSlugs.join(", ")}\n\nDOCUMENT:\n${input.sourceText}`,
    schema: ExtractionOutputSchema,
  });

  const positions: ExtractedPosition[] = [];
  const rejected: ExtractOutcome["rejected"] = [];
  for (const p of res.output.positions) {
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
  return { model: res.model, positions, rejected, costCents: res.costCents };
}

/**
 * Two independent models. Agreement on stance => DRAFT with min confidence.
 * Disagreement or either NO_STATED => ReviewTask.
 */
export function reconcile(a: ExtractOutcome, b: ExtractOutcome) {
  const byIssue = (o: ExtractOutcome) => new Map(o.positions.map((p) => [p.issueSlug, p]));
  const ma = byIssue(a);
  const mb = byIssue(b);
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
  return { agreed, flagged };
}
