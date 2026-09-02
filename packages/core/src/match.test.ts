import { describe, expect, it } from "vitest";
import { matchCandidates } from "./match.js";

describe("matchCandidates", () => {
  it("excludes NO_STATED_POSITION from score and reports coverage", () => {
    const r = matchCandidates(
      [
        { issueSlug: "housing", value: 2, weight: 3 },
        { issueSlug: "guns", value: -2, weight: 1 },
      ],
      [
        { candidateId: "a", issueSlug: "housing", stance: "STRONG_SUPPORT" },
        { candidateId: "a", issueSlug: "guns", stance: "NO_STATED_POSITION" },
        { candidateId: "b", issueSlug: "housing", stance: "OPPOSE" },
        { candidateId: "b", issueSlug: "guns", stance: "STRONG_OPPOSE" },
      ],
    );
    const a = r.find((x) => x.candidateId === "a")!;
    const b = r.find((x) => x.candidateId === "b")!;
    expect(a.score).toBe(100);
    expect(a.coverage).toBe(0.5);
    expect(b.coverage).toBe(1);
    expect(b.score).toBe(Math.round(((0.25 * 3 + 1 * 1) / 4) * 100));
  });

  it("is deterministic", () => {
    const answers = [{ issueSlug: "x", value: 1 as const, weight: 2 as const }];
    const positions = [{ candidateId: "c", issueSlug: "x", stance: "SUPPORT" as const }];
    expect(matchCandidates(answers, positions)).toEqual(matchCandidates(answers, positions));
  });
});
