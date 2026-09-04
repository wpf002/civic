import { describe, expect, it } from "vitest";
import {
  calendarFor,
  deadlinesNeedingReview,
  iso,
  mayUniformDate,
  novemberCalendar,
  novemberUniformDate,
  uniformElectionsFor,
} from "./tx-uniform-dates.js";

describe("Texas uniform election dates", () => {
  it("finds the first Saturday in May", () => {
    expect(iso(mayUniformDate(2027))).toBe("2027-05-01");
    expect(iso(mayUniformDate(2025))).toBe("2025-05-03"); // the real 2025 Dallas city election
    expect(iso(mayUniformDate(2026))).toBe("2026-05-02"); // the real 2026 DISD election
  });

  it("finds the first Tuesday after the first Monday in November", () => {
    // The pilot. Nov 1 2027 is a Monday, so election day is the 2nd.
    expect(iso(novemberUniformDate(2027))).toBe("2027-11-02");
    expect(iso(novemberUniformDate(2026))).toBe("2026-11-03");
    expect(iso(novemberUniformDate(2028))).toBe("2028-11-07");
  });

  it("does not confuse 'first Tuesday' with 'first Tuesday after the first Monday'", () => {
    // 2028: Nov 1 is a Wednesday. The naive reading gives Nov 7 by luck here, but
    // 2022 is the discriminating case — Nov 1 was a Tuesday and election day was the 8th.
    expect(iso(novemberUniformDate(2022))).toBe("2022-11-08");
  });
});

describe("statutory filing calendar", () => {
  const pilot = novemberCalendar(2027);

  it("derives the November 2027 Dallas filing window from the statute", () => {
    expect(iso(pilot.electionDate)).toBe("2027-11-02");
    expect(iso(pilot.filingDeadline)).toBe("2027-08-16"); // 78th day
    expect(iso(pilot.writeInFilingDeadline)).toBe("2027-08-20"); // 74th day
    expect(iso(pilot.withdrawalDeadline)).toBe("2027-08-23"); // 71st day
    expect(iso(pilot.filingOpensAt)).toBe("2027-07-17"); // 30 days before the deadline
  });

  it("counts offsets from election day, not from the month", () => {
    const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86_400_000);
    for (const c of [...uniformElectionsFor(2027), ...uniformElectionsFor(2028)]) {
      expect(days(c.filingDeadline, c.electionDate)).toBe(78);
      expect(days(c.writeInFilingDeadline, c.electionDate)).toBe(74);
      expect(days(c.withdrawalDeadline, c.electionDate)).toBe(71);
    }
  });

  it("carries its own citations so a wrong date is traceable to a wrong reading", () => {
    expect(pilot.derivedFrom).toContain("§41.001(a)");
    expect(pilot.derivedFrom).toContain("§143.007(a)");
  });

  it("flags deadlines that fall on a weekend rather than silently rolling them", () => {
    // §1.006 extends a weekend deadline to the next business day, but the holiday list
    // moves. The generator surfaces the candidates instead of guessing.
    const flagged = deadlinesNeedingReview(pilot);
    for (const f of flagged) {
      const d = f.date.getUTCDay();
      expect(d === 0 || d === 6).toBe(true);
    }
    // 2027-07-17 is a Saturday, so the pilot has at least one to confirm.
    expect(flagged.map((f) => f.name)).toContain("filingOpensAt");
  });

  it("is deterministic and I/O-free", () => {
    expect(novemberCalendar(2027)).toEqual(novemberCalendar(2027));
  });

  it("works on an arbitrary election date, not only uniform ones", () => {
    const special = calendarFor(new Date(Date.UTC(2027, 11, 14)), "NOVEMBER");
    expect(iso(special.filingDeadline)).toBe("2027-09-27");
  });
});
