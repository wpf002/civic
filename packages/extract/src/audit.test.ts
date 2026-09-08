import { describe, expect, it } from "vitest";
import { auditPublished, wilsonInterval } from "./audit.js";
import type { CompleteFn } from "./llm.js";

const reply = (output: unknown): CompleteFn =>
  (async () => ({ model: "recorded", output, costCents: 0.1 })) as unknown as CompleteFn;

describe("reporting a rate honestly", () => {
  it("gives a range, not a point", () => {
    // Two errors in sixty is 3.3%. Saying that alone, when the true rate could be
    // 12%, is precision that misleads whoever relies on it.
    const [lo, hi] = wilsonInterval(58, 60);
    expect(lo).toBeLessThan(0.97);
    expect(hi).toBeGreaterThan(0.97);
    expect(hi - lo).toBeGreaterThan(0.05);
  });

  it("is honest about knowing nothing from no sample", () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });

  it("narrows as the sample grows", () => {
    const small = wilsonInterval(19, 20);
    const large = wilsonInterval(950, 1000);
    expect(large[1] - large[0]).toBeLessThan(small[1] - small[0]);
  });
});

describe("what the audit does and does not do", () => {
  it("counts an uncertain verdict as an error", async () => {
    const r = await auditPublished({
      size: 3,
      complete: reply({ correct: false, fault: "WRONG_STANCE", explanation: "not supported" }),
    });
    if (r.sampled > 0) {
      expect(r.correct).toBe(0);
      expect(r.errorRate).toBe(1);
    }
  });

  it("changes nothing it audits", async () => {
    // An audit that fixes what it finds cannot report a rate: the rate would
    // describe a state that no longer exists.
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./audit.ts", import.meta.url), "utf8"),
    );
    expect(src).not.toMatch(/prisma\.position\.update/);
    expect(src).not.toMatch(/prisma\.position\.delete/);
  });

  it("samples reproducibly, so a published rate can be checked", async () => {
    const a = await auditPublished({ size: 5, seed: 7, complete: reply({ correct: true, fault: "NONE", explanation: "" }) });
    const b = await auditPublished({ size: 5, seed: 7, complete: reply({ correct: true, fault: "NONE", explanation: "" }) });
    expect(a.sampled).toBe(b.sampled);
  });
});
