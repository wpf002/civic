import { ExtractionOutputSchema, type ExtractedPosition } from "@civic/core";
import { flintComplete } from "./flint.js";
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

/** One model, one source. Validates quotes against the source text before returning. */
export async function extractOnce(input: ExtractInput, model?: string): Promise<ExtractOutcome> {
  const res = await flintComplete<unknown>({
    task: "civic.extract_positions",
    ...(model ? { models: [model] } : {}),
    system: EXTRACT_SYSTEM,
    input: `ISSUES: ${input.issueSlugs.join(", ")}\n\nDOCUMENT:\n${input.sourceText}`,
    jsonSchema: { type: "object" }, // Flint enforces the real schema by task id
  });
  const parsed = ExtractionOutputSchema.safeParse(res.output);
  if (!parsed.success) throw new Error(`extractor returned invalid shape: ${parsed.error.message}`);

  const positions: ExtractedPosition[] = [];
  const rejected: ExtractOutcome["rejected"] = [];
  for (const p of parsed.data.positions) {
    if (!input.issueSlugs.includes(p.issueSlug)) { rejected.push({ position: p, reason: "unknown issue" }); continue; }
    if (p.stance !== "NO_STATED_POSITION" && !input.sourceText.includes(p.quote)) {
      rejected.push({ position: p, reason: "quote not found verbatim in source" });
      continue;
    }
    positions.push(p);
  }
  return { model: res.model, positions, rejected, costCents: res.costCents };
}

/**
 * Two independent models. Agreement on stance => DRAFT with min confidence.
 * Disagreement or either NO_STATED => ReviewTask. This is the Trident pattern, inlined.
 */
export function reconcile(a: ExtractOutcome, b: ExtractOutcome) {
  const byIssue = (o: ExtractOutcome) => new Map(o.positions.map((p) => [p.issueSlug, p]));
  const ma = byIssue(a), mb = byIssue(b);
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
