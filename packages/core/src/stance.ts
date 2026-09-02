export type Stance =
  | "STRONG_SUPPORT" | "SUPPORT" | "MIXED" | "OPPOSE" | "STRONG_OPPOSE" | "NO_STATED_POSITION";

// Numeric scale used by the matcher. NO_STATED_POSITION is excluded, never zeroed.
export const STANCE_VALUE: Record<Exclude<Stance, "NO_STATED_POSITION">, number> = {
  STRONG_SUPPORT: 2,
  SUPPORT: 1,
  MIXED: 0,
  OPPOSE: -1,
  STRONG_OPPOSE: -2,
};

export function isScorable(s: Stance): s is Exclude<Stance, "NO_STATED_POSITION"> {
  return s !== "NO_STATED_POSITION";
}
