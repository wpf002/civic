import type { Stance } from "@civic/core";

/**
 * The Stance Rule.
 *
 * Direction is encoded by POSITION on a five-cell track (oppose left → support
 * right). Intensity is encoded by INK VALUE (strong = full ink, plain = soft).
 * MIXED is encoded by SHAPE — a split diagonal cell, not a different color.
 *
 * Hue never participates. That is simultaneously the accessibility argument
 * (every value resolves in grayscale and in dark mode) and the nonpartisanship
 * argument (there is no "good color" to accuse us of assigning). The track is
 * always paired with the stance word, so it is redundant encoding and never the
 * sole carrier of meaning.
 *
 * Plain divs with background colors and no SVG — so it renders identically in
 * Satori for the OG card as it does in the app. Same component, twice.
 */

export const STANCE_WORD: Record<Stance, string> = {
  STRONG_OPPOSE: "Strongly opposes",
  OPPOSE: "Opposes",
  MIXED: "Mixed",
  SUPPORT: "Supports",
  STRONG_SUPPORT: "Strongly supports",
  NO_STATED_POSITION: "No stated position",
  DECLINED_TO_STATE: "Declined to answer",
};

/** Left→right order of the track. Absences never appear on it. */
const SLOTS = ["STRONG_OPPOSE", "OPPOSE", "MIXED", "SUPPORT", "STRONG_SUPPORT"] as const;
type Slot = (typeof SLOTS)[number];

export function isOnTrack(s: Stance): s is Slot {
  return (SLOTS as readonly string[]).includes(s);
}

/** The user's own quiz answer uses the same scale, so the same track can show it. */
export function stanceFromValue(v: -2 | -1 | 0 | 1 | 2): Slot {
  return SLOTS[v + 2]!;
}

export function StanceRule({
  stance,
  label,
  size = "md",
}: {
  stance: Stance;
  /** Completes the aria sentence: "Strongly opposes: <label>". Required — the track alone is not a label. */
  label: string;
  size?: "sm" | "md";
}) {
  if (!isOnTrack(stance)) return null;
  const active = SLOTS.indexOf(stance);
  const strong = stance === "STRONG_SUPPORT" || stance === "STRONG_OPPOSE";
  const cell = size === "sm" ? "h-2.5 w-4" : "h-3.5 w-6";

  return (
    <span
      role="img"
      aria-label={`${STANCE_WORD[stance]}: ${label}`}
      className="inline-flex items-center gap-[2px]"
    >
      {SLOTS.map((slot, i) => {
        const on = i === active;
        if (on && stance === "MIXED") {
          return (
            <span
              key={slot}
              className={`${cell} border border-ink`}
              // MIXED is a SHAPE, not a color: two ink half-triangles on a diagonal.
              style={{
                background: `linear-gradient(135deg, var(--ink) 0 50%, transparent 50% 100%)`,
              }}
            />
          );
        }
        return (
          <span
            key={slot}
            className={cell}
            style={
              on
                ? { background: strong ? "var(--stance-strong)" : "var(--stance-soft)" }
                : { boxShadow: "inset 0 0 0 1px var(--rule-strong)" }
            }
          />
        );
      })}
    </span>
  );
}

/** Track plus word. The word is what a screen reader and a grayscale screenshot both get. */
export function StanceLine({
  stance,
  label,
  size = "md",
}: {
  stance: Stance;
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <StanceRule stance={stance} label={label} size={size} />
      <span className="mono font-medium !text-ink">{STANCE_WORD[stance]}</span>
    </span>
  );
}
