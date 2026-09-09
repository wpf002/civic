import { z } from "zod";

// The contract between the extractor and the database. Every position must satisfy
// this before anything is written.
export const ExtractedPositionSchema = z.object({
  issueSlug: z.string(),
  stance: z.enum([
    "STRONG_SUPPORT",
    "SUPPORT",
    "MIXED",
    "OPPOSE",
    "STRONG_OPPOSE",
    "NO_STATED_POSITION",
    "DECLINED_TO_STATE",
  ]),
  summary: z.string().max(300),
  quote: z.string().max(500),         // verbatim from source text; validated by substring check
  locator: z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedPosition = z.infer<typeof ExtractedPositionSchema>;

export const ExtractionOutputSchema = z.object({
  /**
   * Which propositions this document addresses. Everything else is silence.
   *
   * Returning an entry for all twenty and writing a summary for each cost most of
   * the output budget, and output is priced five times input. A document that
   * addresses two questions now returns two entries instead of twenty.
   */
  addressed: z.array(z.string()).default([]),
  positions: z.array(ExtractedPositionSchema),
});

/**
 * The same shape with the length caps lifted, used only for TRANSPORT.
 *
 * A structured-output parse is all-or-nothing: one summary a few characters over the
 * cap threw, and a whole candidate page produced nothing instead of eleven good
 * positions and one bad one. The caps are a real product constraint — a "summary"
 * the length of an essay is not a summary — so they are still enforced, just per
 * position by `ExtractedPositionSchema` after the response arrives, where a
 * violation costs that one position and is reported rather than silently dropped.
 *
 * The prompt states the limits, so the model still aims for them.
 */
export const LenientExtractionOutputSchema = z.object({
  addressed: z.array(z.string()).default([]),
  positions: z.array(ExtractedPositionSchema.extend({ summary: z.string(), quote: z.string() })),
});
