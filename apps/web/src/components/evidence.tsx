import type { Stance } from "@civic/core";
import { STANCE_WORD } from "./stance";

export type SourceRow = {
  id: string;
  title: string | null;
  url: string;
  kind: string;
  tier: string;
  capturedAt: string;
};

export type EvidenceRow = {
  id: string;
  quote: string;
  mediaTimestamp: string | null;
  source: SourceRow & { publisher: string | null; publishedAt: string | null };
  context: { before: string; span: string; after: string };
};

/**
 * Always UTC. Election dates and capture stamps are stored at UTC midnight, so
 * formatting them in the viewer's local zone renders the previous day anywhere
 * west of Greenwich — which for an election date is not a cosmetic bug.
 */
export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export const fmtDateLong = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const KIND_LABEL: Record<string, string> = {
  CANDIDATE_WEBSITE: "Candidate site",
  QUESTIONNAIRE: "Questionnaire",
  VOTING_RECORD: "Voting record",
  PUBLIC_STATEMENT: "Public statement",
  NEWS_INTERVIEW: "Interview",
  DEBATE_TRANSCRIPT: "Forum transcript",
  SOCIAL_POST: "Social post",
  OFFICIAL_FILING: "Official filing",
  OTHER: "Other",
};

/**
 * Quote-in-source, with the verified span marked.
 *
 * Not a pull quote. This shows the archived source text around the span, with the
 * span itself in <mark>. It is the substring guarantee made visible: competitors
 * publish quotation marks around text they admit they edit, and a bare span proves
 * the words exist but not that they were about this. Context is what survives a
 * campaign's challenge.
 *
 * The offsets come from findVerbatim, so the marked text is byte-identical to the
 * archived source by construction — including its original line wrapping.
 */
export function QuoteInSource({ evidence }: { evidence: EvidenceRow }) {
  const { context, source } = evidence;
  return (
    <figure className="mt-4 border-l-[3px] border-ink bg-sunk px-4 py-4">
      <blockquote className="max-w-measure whitespace-pre-line font-serif text-quote text-ink">
        <span className="text-ink-2">{context.before}</span>
        <mark>{context.span}</mark>
        <span className="text-ink-2">{context.after}</span>
      </blockquote>
      <figcaption className="mono mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{KIND_LABEL[source.kind] ?? source.kind}</span>
        <span aria-hidden>·</span>
        <span>Captured {fmtDate(source.capturedAt)}</span>
        {evidence.mediaTimestamp ? (
          <>
            <span aria-hidden>·</span>
            <span>At {evidence.mediaTimestamp}</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <a
          href={source.url}
          rel="nofollow noopener external"
          target="_blank"
          className="link !min-h-[44px]"
        >
          {hostOf(source.url)} ↗
        </a>
      </figcaption>
    </figure>
  );
}

/**
 * The Silence Receipt.
 *
 * The hardest visual problem in the product, and everyone else gets it wrong in the
 * same direction: they fill the gap from party, infer it, delete the candidate,
 * delete the question, or print a silent blank. Absence here is rendered as a
 * completed research finding — a dated enumeration of what was searched — which
 * makes the emptiest cell the most persuasive one on the page.
 *
 * It is never greyed, shrunk, italicised or right-aligned. Full body contrast, and
 * more vertical space than a stance, not less. Zero JS: a <details> element over
 * the Source rows the pipeline already writes.
 */
export function SilenceReceipt({
  stance,
  candidateName,
  issueName,
  sourcesRead,
  asOf,
}: {
  stance: Extract<Stance, "NO_STATED_POSITION" | "DECLINED_TO_STATE">;
  candidateName: string;
  issueName: string;
  sourcesRead: SourceRow[];
  asOf?: string;
}) {
  const declined = stance === "DECLINED_TO_STATE";
  const surname = candidateName.split(" ").slice(-1)[0] ?? candidateName;

  return (
    <div className="mt-3 border-t border-dashed border-rule-strong pt-4">
      <p className="mono mb-2 font-medium !text-ink">{STANCE_WORD[stance]}</p>
      <p className="max-w-measure text-base text-ink">
        {declined ? (
          <>
            We asked {surname} about {issueName.toLowerCase()} and {surname} declined to answer.
          </>
        ) : (
          <>
            {surname} has not stated a position on {issueName.toLowerCase()}.
          </>
        )}
      </p>

      {sourcesRead.length > 0 ? (
        <details className="mt-3">
          <summary className="mono inline-flex min-h-[44px] items-center underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
            We read {sourcesRead.length} source{sourcesRead.length === 1 ? "" : "s"}
            {asOf ? ` through ${fmtDate(asOf)}` : ""} — see the list
          </summary>
          <ul className="mt-2 space-y-2">
            {sourcesRead.map((s) => (
              <li key={s.id} className="mono !normal-case !tracking-normal">
                <a
                  href={s.url}
                  rel="nofollow noopener external"
                  target="_blank"
                  className="link"
                >
                  {s.title ?? hostOf(s.url)}
                </a>
                <span className="uppercase tracking-[0.08em]">
                  {" "}
                  · {KIND_LABEL[s.kind] ?? s.kind} · {fmtDate(s.capturedAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="mono mt-3 !normal-case !tracking-normal">
          We have not found any published source for this candidate yet. That is a gap in our
          coverage, not a statement about the candidate.
        </p>
      )}
    </div>
  );
}
