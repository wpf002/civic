/**
 * Every state and DC, with what is on the November 3 2026 federal and governor ballot.
 *
 * House seats are the 2020 apportionment, fixed until 2032. The Senate column is the
 * seat class up in 2026: Class II for the 33 regular seats, Class III for the two
 * special elections (Florida and Ohio, for the seats Rubio and Vance left). Governor
 * is true for the 36 states electing one in 2026.
 *
 * Static on purpose. These facts are set by the Constitution, the census and state
 * law, and none of them can change before the election they describe.
 */
export interface UsState {
  code: string;
  name: string;
  fips: string;
  houseSeats: number;
  /** The Senate seat class on the 2026 ballot, or null when neither seat is up. */
  senate2026: "Class II" | "Class III" | null;
  governor2026: boolean;
}

const s = (
  code: string,
  name: string,
  fips: string,
  houseSeats: number,
  senate2026: UsState["senate2026"],
  governor2026: boolean,
): UsState => ({ code, name, fips, houseSeats, senate2026, governor2026 });

export const US_STATES: readonly UsState[] = [
  s("AL", "Alabama", "01", 7, "Class II", true),
  s("AK", "Alaska", "02", 1, "Class II", true),
  s("AZ", "Arizona", "04", 9, null, true),
  s("AR", "Arkansas", "05", 4, "Class II", true),
  s("CA", "California", "06", 52, null, true),
  s("CO", "Colorado", "08", 8, "Class II", true),
  s("CT", "Connecticut", "09", 5, null, true),
  s("DE", "Delaware", "10", 1, "Class II", false),
  s("DC", "District of Columbia", "11", 1, null, false),
  s("FL", "Florida", "12", 28, "Class III", true),
  s("GA", "Georgia", "13", 14, "Class II", true),
  s("HI", "Hawaii", "15", 2, null, true),
  s("ID", "Idaho", "16", 2, "Class II", true),
  s("IL", "Illinois", "17", 17, "Class II", true),
  s("IN", "Indiana", "18", 9, null, false),
  s("IA", "Iowa", "19", 4, "Class II", true),
  s("KS", "Kansas", "20", 4, "Class II", true),
  s("KY", "Kentucky", "21", 6, "Class II", false),
  s("LA", "Louisiana", "22", 6, "Class II", false),
  s("ME", "Maine", "23", 2, "Class II", true),
  s("MD", "Maryland", "24", 8, null, true),
  s("MA", "Massachusetts", "25", 9, "Class II", true),
  s("MI", "Michigan", "26", 13, "Class II", true),
  s("MN", "Minnesota", "27", 8, "Class II", true),
  s("MS", "Mississippi", "28", 4, "Class II", false),
  s("MO", "Missouri", "29", 8, null, false),
  s("MT", "Montana", "30", 2, "Class II", false),
  s("NE", "Nebraska", "31", 3, "Class II", true),
  s("NV", "Nevada", "32", 4, null, true),
  s("NH", "New Hampshire", "33", 2, "Class II", true),
  s("NJ", "New Jersey", "34", 12, "Class II", false),
  s("NM", "New Mexico", "35", 3, "Class II", true),
  s("NY", "New York", "36", 26, null, true),
  s("NC", "North Carolina", "37", 14, "Class II", false),
  s("ND", "North Dakota", "38", 1, null, false),
  s("OH", "Ohio", "39", 15, "Class III", true),
  s("OK", "Oklahoma", "40", 5, "Class II", true),
  s("OR", "Oregon", "41", 6, "Class II", true),
  s("PA", "Pennsylvania", "42", 17, null, true),
  s("RI", "Rhode Island", "44", 2, "Class II", true),
  s("SC", "South Carolina", "45", 7, "Class II", true),
  s("SD", "South Dakota", "46", 1, "Class II", true),
  s("TN", "Tennessee", "47", 9, "Class II", true),
  s("TX", "Texas", "48", 38, "Class II", true),
  s("UT", "Utah", "49", 4, null, false),
  s("VT", "Vermont", "50", 1, null, true),
  s("VA", "Virginia", "51", 11, "Class II", false),
  s("WA", "Washington", "53", 10, null, false),
  s("WV", "West Virginia", "54", 2, "Class II", false),
  s("WI", "Wisconsin", "55", 8, null, true),
  s("WY", "Wyoming", "56", 1, "Class II", true),
];

export const stateByCode = (code: string): UsState | undefined =>
  US_STATES.find((st) => st.code === code.toUpperCase());

export const stateByName = (name: string): UsState | undefined =>
  US_STATES.find((st) => st.name.toLowerCase() === name.trim().toLowerCase());

/**
 * The seat label a House race carries. Single-seat states elect at large, and DC
 * elects a non-voting delegate; neither has a "District 1".
 */
export function houseSeatLabel(stateCode: string, district: number): string {
  if (stateCode.toUpperCase() === "DC") return "Delegate";
  const st = stateByCode(stateCode);
  if (st && st.houseSeats === 1) return "At-Large";
  return `District ${district}`;
}

/**
 * The House seat label for an address, from the Census congressional district name.
 *
 * Census names a numbered seat "Congressional District 7", a single-seat state
 * "Congressional District (at Large)" and DC "Delegate District (at Large)". Returns
 * null when the name does not fit the state, so a mismatch shows no race rather than
 * the wrong one.
 */
export function congressionalSeat(stateCode: string, censusName: string | undefined): string | null {
  if (!censusName) return null;
  const st = stateByCode(stateCode);
  if (!st) return null;
  if (/at large/i.test(censusName)) return st.houseSeats === 1 ? houseSeatLabel(st.code, 0) : null;
  const n = censusName.match(/(\d{1,2})\s*$/);
  if (!n) return null;
  const d = Number(n[1]);
  return d >= 1 && d <= st.houseSeats && st.houseSeats > 1 ? houseSeatLabel(st.code, d) : null;
}

/**
 * Elections whose candidates are invented, for building and testing the UI. They are
 * never listed to a voter or counted in a measured error rate. Reachable by direct
 * slug for the e2e suite, and listed everywhere when SHOW_SYNTHETIC=true.
 */
export const SYNTHETIC_ELECTIONS: readonly string[] = ["2027-11-dallas"];

export const hiddenElectionSlugs = (env: Record<string, string | undefined> = process.env): string[] =>
  env.SHOW_SYNTHETIC === "true" ? [] : [...SYNTHETIC_ELECTIONS];
