export type Stance =
  | "STRONG_SUPPORT" | "SUPPORT" | "MIXED" | "OPPOSE" | "STRONG_OPPOSE"
  | "NO_STATED_POSITION"  // searched, they have not addressed it
  | "DECLINED_TO_STATE";  // asked, they refused

/** Neither absence is scored. Both are shown; only MIXED is a real midpoint. */
export type Unscorable = "NO_STATED_POSITION" | "DECLINED_TO_STATE";

// Numeric scale used by the matcher. Absences are excluded, never zeroed —
// imputing a midpoint would make silence read as moderation.
export const STANCE_VALUE: Record<Exclude<Stance, Unscorable>, number> = {
  STRONG_SUPPORT: 2,
  SUPPORT: 1,
  MIXED: 0,
  OPPOSE: -1,
  STRONG_OPPOSE: -2,
};

export function isScorable(s: Stance): s is Exclude<Stance, Unscorable> {
  return s !== "NO_STATED_POSITION" && s !== "DECLINED_TO_STATE";
}
