import { describe, expect, it } from "vitest";
import { extractOnce, reconcile } from "./pipeline.js";
import type { CompleteFn } from "./llm.js";

const DOC = "I will vote to legalize fourplexes citywide. On policing, I have not taken a position.";

/** Replays a recorded model output. CI never calls a model. */
const replay = (positions: unknown[], costCents = 0.5): CompleteFn =>
  (async () => ({ model: "recorded", output: { positions }, costCents })) as unknown as CompleteFn;

describe("extractOnce", () => {
  const input = { sourceText: DOC, issueSlugs: ["housing-cost-of-living", "public-safety-policing"] };

  it("rejects a position whose quote is not verbatim in the source", async () => {
    const out = await extractOnce(
      input,
      "recorded",
      replay([
        {
          issueSlug: "housing-cost-of-living",
          stance: "SUPPORT",
          summary: "Would allow fourplexes citywide.",
          quote: "I will vote to legalise fourplexes citywide.", // British spelling: not in the source
          confidence: 0.9,
        },
      ]),
    );
    expect(out.positions).toHaveLength(0);
    expect(out.rejected[0]?.reason).toBe("quote not found verbatim in source");
  });

  it("keeps a verbatim quote and drops an issue outside the taxonomy", async () => {
    const out = await extractOnce(
      input,
      "recorded",
      replay([
        {
          issueSlug: "housing-cost-of-living",
          stance: "SUPPORT",
          summary: "Would allow fourplexes citywide.",
          quote: "I will vote to legalize fourplexes citywide.",
          confidence: 0.9,
        },
        {
          issueSlug: "interstellar-policy",
          stance: "SUPPORT",
          summary: "Invented issue.",
          quote: "I will vote to legalize fourplexes citywide.",
          confidence: 0.9,
        },
      ]),
    );
    expect(out.positions.map((p) => p.issueSlug)).toEqual(["housing-cost-of-living"]);
    expect(out.rejected[0]?.reason).toBe("unknown issue");
  });

  it("does not require a quote for NO_STATED_POSITION", async () => {
    const out = await extractOnce(
      input,
      "recorded",
      replay([
        {
          issueSlug: "public-safety-policing",
          stance: "NO_STATED_POSITION",
          summary: "The document does not state a position.",
          quote: "",
          confidence: 0.8,
        },
      ]),
    );
    expect(out.positions).toHaveLength(1);
  });
});

describe("reconcile", () => {
  const p = (issueSlug: string, stance: string, confidence: number) =>
    ({ issueSlug, stance, summary: "s", quote: "q", confidence }) as never;
  const outcome = (positions: unknown[]) =>
    ({ model: "m", positions, rejected: [], costCents: 0 }) as never;

  it("agrees on matching stance and takes the lower confidence", () => {
    const r = reconcile(
      outcome([p("housing-cost-of-living", "SUPPORT", 0.9)]),
      outcome([p("housing-cost-of-living", "SUPPORT", 0.6)]),
    );
    expect(r.agreed[0]?.confidence).toBe(0.6);
    expect(r.flagged).toHaveLength(0);
  });

  it("flags a stance disagreement instead of picking a winner", () => {
    const r = reconcile(
      outcome([p("guns", "SUPPORT", 0.9)]),
      outcome([p("guns", "OPPOSE", 0.9)]),
    );
    expect(r.agreed).toHaveLength(0);
    expect(r.flagged[0]?.issueSlug).toBe("guns");
  });

  it("flags an issue only one model found", () => {
    const r = reconcile(outcome([p("guns", "SUPPORT", 0.9)]), outcome([]));
    expect(r.flagged[0]).toMatchObject({ issueSlug: "guns" });
    expect(r.flagged[0]?.b).toBeUndefined();
  });
});
