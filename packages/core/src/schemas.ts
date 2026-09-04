import { z } from "zod";

// Contract between the extractor (via Flint) and the db. The model must emit exactly this.
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
  positions: z.array(ExtractedPositionSchema),
});
