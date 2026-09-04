import { describe, expect, it } from "vitest";
import { diffRoster, nameKey, normalizeForHash, type Roster } from "./roster.js";

const at = new Date("2027-08-01T00:00:00Z");
const roster = (names: string[], extra: Partial<Roster> = {}): Roster => ({
  raceKey: "disd-trustee-2",
  entries: names.map((n) => ({ key: nameKey(n), name: n })),
  sourceUrl: "https://example.org/roster",
  observedAt: at,
  ...extra,
});

describe("nameKey", () => {
  it("folds case, punctuation, accents and suffixes", () => {
    expect(nameKey("Winnetka K. Smith-Alford")).toBe(nameKey("winnetka k smith alford"));
    expect(nameKey("José Rivas Jr.")).toBe(nameKey("Jose Rivas"));
    expect(nameKey("O'Neil Hesson")).toBe(nameKey("ONeil Hesson"));
  });

  it("does not collapse two different people", () => {
    expect(nameKey("Joyce Foreman")).not.toBe(nameKey("Joe Carreon"));
  });
});

describe("the shrink guard", () => {
  it("auto-applies a purely additive diff", () => {
    const d = diffRoster(roster(["Sarah Weinberg"]), roster(["Sarah Weinberg", "Joe Carreon"]));
    expect(d.verdict).toBe("AUTO_APPLIED");
    expect(d.added.map((a) => a.name)).toEqual(["Joe Carreon"]);
    expect(d.removed).toHaveLength(0);
  });

  it("QUARANTINES any removal, with no threshold and no exception", () => {
    const d = diffRoster(
      roster(["Sarah Weinberg", "Joe Carreon", "Joyce Foreman"]),
      roster(["Sarah Weinberg", "Joe Carreon"]),
    );
    expect(d.verdict).toBe("QUARANTINED");
    expect(d.removed.map((r) => r.name)).toEqual(["Joyce Foreman"]);
    expect(d.reasons[0]).toMatch(/requires an attached document/);
  });

  it("quarantines a removal even when many candidates were added at the same time", () => {
    // The tempting case: 6 added, 1 removed reads like a healthy update. It is not.
    const d = diffRoster(
      roster(["Sarah Weinberg", "Joyce Foreman"]),
      roster(["Sarah Weinberg", "A One", "B Two", "C Three", "D Four", "E Five", "F Six"]),
    );
    expect(d.added).toHaveLength(6);
    expect(d.verdict).toBe("QUARANTINED");
  });

  it("treats a roster going empty as a failed fetch, not a cancelled race", () => {
    const d = diffRoster(roster(["Sarah Weinberg"]), roster([]));
    expect(d.verdict).toBe("QUARANTINED");
    expect(d.reasons.join(" ")).toMatch(/failed fetch/);
  });

  it("treats a short parse against a certified field as a failed fetch", () => {
    const d = diffRoster(roster(["A One"]), roster(["A One", "B Two"]), { expectedCount: 5 });
    expect(d.verdict).toBe("QUARANTINED");
    expect(d.reasons.join(" ")).toMatch(/certified field is 5/);
  });

  it("blocks publication on an unnamed ballot line", () => {
    const next = roster(["A One"]);
    next.entries.push({ key: "write in candidate", name: "Write-In Candidate", isPlaceholder: true });
    const d = diffRoster(roster(["A One"]), next);
    expect(d.verdict).toBe("QUARANTINED");
    expect(d.reasons.join(" ")).toMatch(/no name/);
  });

  it("surfaces a probable respelling instead of resolving it", () => {
    // Real 2025 Dallas pairs: Sukhbri/Sukhbir Kaur, Russouw/Rossouw.
    const d = diffRoster(roster(["Anna Russouw"]), roster(["Anna Rossouw"]));
    expect(d.verdict).toBe("QUARANTINED");
    expect(d.reasons.join(" ")).toMatch(/may be one person spelled two ways/);
  });

  it("is deterministic", () => {
    const a = roster(["A One"]);
    const b = roster(["A One", "B Two"]);
    expect(diffRoster(a, b)).toEqual(diffRoster(a, b));
  });

  it("treats a first observation as all-additive", () => {
    const d = diffRoster(null, roster(["A One", "B Two"]));
    expect(d.verdict).toBe("AUTO_APPLIED");
    expect(d.added).toHaveLength(2);
  });
});

describe("normalizeForHash", () => {
  it("strips the Cloudflare token that otherwise changes on every poll", () => {
    const a = `<html><body>x<script>window.__CF$cv$params={r:'aaa111',t:'x'}</script></body></html>`;
    const b = `<html><body>x<script>window.__CF$cv$params={r:'bbb222',t:'y'}</script></body></html>`;
    expect(a).not.toBe(b);
    expect(normalizeForHash(a)).toBe(normalizeForHash(b));
  });

  it("strips the SharePoint per-request form digest", () => {
    const a = `<p>y</p><script>formDigestElement.value = '0xAAA,04 Sep 2026 00:53:12 -0000';</script>`;
    const b = `<p>y</p><script>formDigestElement.value = '0xBBB,04 Sep 2026 00:53:13 -0000';</script>`;
    expect(normalizeForHash(a)).toBe(normalizeForHash(b));
  });

  it("still notices a real content change", () => {
    const a = `<p>District 2</p><script>window.__CF$cv$params={r:'aaa'}</script>`;
    const b = `<p>District 3</p><script>window.__CF$cv$params={r:'bbb'}</script>`;
    expect(normalizeForHash(a)).not.toBe(normalizeForHash(b));
  });
});
