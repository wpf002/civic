import { describe, expect, it } from "vitest";
import { findVerbatim, isVerbatim, normalizeWhitespace } from "./verbatim.js";

// Hard-wrapped, the way real archived candidate pages arrive.
const DOC = `Housing. Our neighborhoods are getting more expensive every year. I will vote to
allow duplexes and fourplexes on every residential lot in District 7, and I will
push to cut the parking minimums that make small apartment buildings impossible
to finance.

Public safety. I support fully funding the department's current headcount.`;

describe("findVerbatim", () => {
  it("accepts an exact slice and reports it unchanged", () => {
    const m = findVerbatim(DOC, "Public safety. I support fully funding");
    expect(m?.rewrapped).toBe(false);
    expect(DOC.slice(m!.start, m!.end)).toBe(m!.quote);
  });

  // The case that broke the first live run: the model unwrapped the source's
  // line breaks while copying. Same words, same order, no alteration.
  it("accepts a quote whose line wraps were collapsed to spaces", () => {
    const unwrapped =
      "I will vote to allow duplexes and fourplexes on every residential lot in District 7, and I will push to cut the parking minimums that make small apartment buildings impossible to finance.";
    expect(DOC.includes(unwrapped)).toBe(false); // naive gate would reject
    const m = findVerbatim(DOC, unwrapped);
    expect(m).not.toBeNull();
    expect(m!.rewrapped).toBe(true);
  });

  it("returns the source span, not the model's string", () => {
    const unwrapped = "I will vote to allow duplexes and fourplexes on every residential lot";
    const m = findVerbatim(DOC, unwrapped)!;
    // What we store is byte-identical to the archived source, newlines and all.
    expect(m.quote).toBe(DOC.slice(m.start, m.end));
    expect(m.quote).toContain("\n");
    expect(m.quote).not.toBe(unwrapped);
    expect(normalizeWhitespace(m.quote)).toBe(unwrapped);
  });

  it("rejects altered words", () => {
    expect(isVerbatim(DOC, "I will vote to allow duplexes and SIXPLEXES on every lot")).toBe(false);
  });

  it("rejects reordered words", () => {
    expect(isVerbatim(DOC, "on every residential lot I will vote to allow duplexes")).toBe(false);
  });

  it("rejects changed punctuation, including smart quotes", () => {
    expect(isVerbatim(DOC, "the department’s current headcount")).toBe(false); // curly
    expect(isVerbatim(DOC, "the department's current headcount")).toBe(true); // straight, as in source
  });

  it("rejects a quote that spans a gap in the source", () => {
    expect(isVerbatim(DOC, "Housing. Public safety.")).toBe(false);
  });

  it("rejects empty and whitespace-only quotes", () => {
    expect(isVerbatim(DOC, "")).toBe(false);
    expect(isVerbatim(DOC, "   \n  ")).toBe(false);
  });

  it("handles a quote at the very start and very end of the source", () => {
    expect(findVerbatim(DOC, "Housing.")!.start).toBe(0);
    const tail = findVerbatim(DOC, "current headcount.")!;
    expect(tail.end).toBe(DOC.length);
  });

  it("is deterministic", () => {
    const q = "I will vote to allow duplexes";
    expect(findVerbatim(DOC, q)).toEqual(findVerbatim(DOC, q));
  });
});
