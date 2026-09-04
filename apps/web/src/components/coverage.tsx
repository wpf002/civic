import Link from "next/link";

export type TickState = "stated" | "silent" | "unattempted";

/**
 * Coverage ticks.
 *
 * One tick per issue that applies to this office: filled where a published position
 * exists, hollow where the candidate is silent, struck where we have not attempted
 * the issue at all.
 *
 * This is the visual counterweight to the match percentage. Extraction from public
 * record inherently favours candidates who are more vocal in local press — the
 * strongest fair criticism of this architecture — so a completeness meter makes a
 * thin evidence base read as thin rather than as a real absence of position. The
 * matcher computes coverage separately from score precisely so this can exist.
 *
 * Teal is the only chroma besides the quote highlight, and it is never used to mean
 * good or bad — only "we have something here".
 */
export function CoverageTicks({
  states,
  label,
}: {
  states: TickState[];
  /** Screen-reader sentence. The ticks are decoration; the fraction and sentence carry it. */
  label: string;
}) {
  return (
    <span role="img" aria-label={label} className="inline-flex flex-wrap items-center gap-[3px]">
      {states.map((s, i) => (
        <span
          key={i}
          className="h-3 w-[7px]"
          style={
            s === "stated"
              ? { background: "var(--meter)" }
              : s === "silent"
                ? { boxShadow: "inset 0 0 0 1px var(--rule-strong)" }
                : {
                    boxShadow: "inset 0 0 0 1px var(--rule)",
                    background:
                      "linear-gradient(to bottom right, transparent 45%, var(--rule-strong) 45% 55%, transparent 55%)",
                  }
          }
        />
      ))}
    </span>
  );
}

/** Ticks + the literal fraction + one plain sentence. Never the ticks alone. */
export function CoverageMeter({
  coverage,
  subject,
}: {
  coverage: Array<{ slug: string; name: string; state: TickState }>;
  /** "Ochoa" or "she" — whatever reads naturally in the sentence. */
  subject: string;
}) {
  const stated = coverage.filter((c) => c.state === "stated").length;
  const silent = coverage.filter((c) => c.state === "silent").length;
  const total = coverage.length;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <CoverageTicks
          states={coverage.map((c) => c.state)}
          label={`Positions found on ${stated} of ${total} issues that apply to this office`}
        />
        <span className="mono font-medium !text-ink">
          {stated} / {total}
        </span>
      </div>
      <p className="mt-2 max-w-measure text-base text-ink">
        We found positions on {stated} of the {total} issues that apply to this office.
        {silent > 0 ? ` On ${silent}, ${subject} has not stated one.` : ""}
      </p>
    </div>
  );
}

export function Monogram({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      aria-hidden
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px] border border-ink text-[13px] font-semibold"
    >
      {initials}
    </span>
  );
}

/**
 * Party gets a letter in a hairline circle — the same treatment for D, R, L, G, I
 * and nonpartisan. There is no party color token in this codebase.
 */
export function PartyMark({ abbreviation, name }: { abbreviation: string; name: string }) {
  return (
    <span
      title={name}
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-rule-strong text-[11px] font-medium text-ink-2"
    >
      <span className="sr-only">{name}</span>
      <span aria-hidden>{abbreviation}</span>
    </span>
  );
}

export function CandidateHead({
  slug,
  fullName,
  party,
  isIncumbent,
  ballotOrder,
}: {
  slug: string;
  fullName: string;
  party: { name: string; abbreviation: string } | null;
  isIncumbent?: boolean;
  ballotOrder?: number | null;
}) {
  return (
    <div className="flex items-center gap-3">
      {ballotOrder ? <span className="mono w-4 shrink-0">{ballotOrder}</span> : null}
      <Monogram name={fullName} />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link
          href={`/c/${slug}`}
          className="link text-summary font-semibold"
        >
          {fullName}
        </Link>
        {party ? <PartyMark abbreviation={party.abbreviation} name={party.name} /> : null}
        {isIncumbent ? <span className="mono border border-rule-strong px-1.5 py-0.5">Incumbent</span> : null}
      </div>
    </div>
  );
}
