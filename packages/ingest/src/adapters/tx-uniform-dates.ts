/**
 * Texas uniform election dates and the statutory filing calendar.
 *
 * This is the one part of "keep the data current" that needs no source, no vendor,
 * no API key and no network call. Texas fixes its election dates and every filing
 * deadline in statute, as offsets from election day, so the whole calendar is a pure
 * function of a year. Deterministic and I/O-free, like the matcher.
 *
 * That matters more than it sounds. Every scraped source in this pipeline can lie by
 * omission — a rotated slug, a soft 404, a folder that does not exist yet — and each
 * failure looks like "nothing happened". The calendar cannot fail that way, so it is
 * the fixed point the rest of the ingest system is checked against: if the City
 * Secretary has published nothing by the statutory filing deadline, that is a fetch
 * failure, not an empty field.
 *
 * Citations are carried on every generated date. A wrong date should be traceable to
 * a wrong reading of the statute, not to a wrong scrape.
 */

/** Texas Election Code sections this file encodes. Quoted in the output, not just here. */
export const AUTHORITY = {
  UNIFORM_DATES: "Tex. Elec. Code §41.001(a)",
  CITY_FILING: "Tex. Elec. Code §143.007(a)",
  WITHDRAWAL: "Tex. Elec. Code §145.092(f)",
  WRITE_IN: "Tex. Elec. Code §146.054",
  WRITE_IN_WITHDRAWAL: "Tex. Elec. Code §146.0301(a)",
} as const;

export type UniformDateKind = "MAY" | "NOVEMBER";

export interface ElectionCalendar {
  electionDate: Date;
  kind: UniformDateKind;
  /** First day a candidate may file an application for a place on the ballot. */
  filingOpensAt: Date;
  /** 78th day before election day. */
  filingDeadline: Date;
  /** 74th day before election day. */
  writeInFilingDeadline: Date;
  /** 71st day before election day. */
  withdrawalDeadline: Date;
  /** 71st day before election day. */
  writeInWithdrawalDeadline: Date;
  /** Every date above, with the section it comes from. Stored on the Election row. */
  derivedFrom: string;
}

/** All arithmetic is in UTC. A cron boundary must never decide a legal date. */
function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

function minusDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86_400_000);
}

/** §41.001(a)(2): the first Saturday in May. */
export function mayUniformDate(year: number): Date {
  const first = utc(year, 4, 1);
  // 6 = Saturday
  return utc(year, 4, 1 + ((6 - first.getUTCDay() + 7) % 7));
}

/** §41.001(a)(3): the first Tuesday after the first Monday in November. */
export function novemberUniformDate(year: number): Date {
  const first = utc(year, 10, 1);
  const firstMonday = 1 + ((1 - first.getUTCDay() + 7) % 7);
  return utc(year, 10, firstMonday + 1);
}

/**
 * The filing calendar for a Texas election held on a uniform date.
 *
 * Offsets are counted backwards from election day in whole days, which is how the
 * Code expresses them ("the 78th day before election day"). Where a deadline would
 * fall on a weekend or holiday the Code extends it to the next business day
 * (§1.006); that adjustment is deliberately NOT applied here — see below.
 */
export function calendarFor(electionDate: Date, kind: UniformDateKind): ElectionCalendar {
  const filingDeadline = minusDays(electionDate, 78);
  return {
    electionDate,
    kind,
    // §143.007(a): filing opens the 30th day before the filing deadline.
    filingOpensAt: minusDays(filingDeadline, 30),
    filingDeadline,
    writeInFilingDeadline: minusDays(electionDate, 74),
    withdrawalDeadline: minusDays(electionDate, 71),
    writeInWithdrawalDeadline: minusDays(electionDate, 71),
    derivedFrom: [
      `${AUTHORITY.UNIFORM_DATES} (election date)`,
      `${AUTHORITY.CITY_FILING} (filing opens, 78th day deadline)`,
      `${AUTHORITY.WRITE_IN} (74th day)`,
      `${AUTHORITY.WITHDRAWAL} / ${AUTHORITY.WRITE_IN_WITHDRAWAL} (71st day)`,
    ].join("; "),
  };
}

export function mayCalendar(year: number): ElectionCalendar {
  return calendarFor(mayUniformDate(year), "MAY");
}

export function novemberCalendar(year: number): ElectionCalendar {
  return calendarFor(novemberUniformDate(year), "NOVEMBER");
}

/** Both uniform-date elections for a year, in date order. */
export function uniformElectionsFor(year: number): ElectionCalendar[] {
  return [mayCalendar(year), novemberCalendar(year)];
}

/**
 * Deadlines that land on a weekend.
 *
 * §1.006 extends a deadline falling on a weekend or legal holiday to the next
 * business day, but "legal holiday" pulls in a list that changes, and getting it
 * silently wrong is worse than not applying it. So the generator reports the
 * candidates instead: these are flagged for a human to confirm against the Secretary
 * of State's published calendar for that cycle, and the confirmed date is what gets
 * stored.
 */
export function deadlinesNeedingReview(c: ElectionCalendar): Array<{ name: string; date: Date }> {
  const entries: Array<[string, Date]> = [
    ["filingOpensAt", c.filingOpensAt],
    ["filingDeadline", c.filingDeadline],
    ["writeInFilingDeadline", c.writeInFilingDeadline],
    ["withdrawalDeadline", c.withdrawalDeadline],
  ];
  return entries
    .filter(([, d]) => d.getUTCDay() === 0 || d.getUTCDay() === 6)
    .map(([name, date]) => ({ name, date }));
}

export const iso = (d: Date) => d.toISOString().slice(0, 10);
