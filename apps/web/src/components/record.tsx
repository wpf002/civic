import Link from "next/link";
import { isOnTrack, StanceLine } from "./stance";
import { CandidateHead } from "./coverage";
import { QuoteInSource, SilenceReceipt, fmtDate } from "./evidence";
import type { Position, SourceRow } from "@/lib/types";

/**
 * One candidate on one issue.
 *
 * The same component renders on the issue comparison and on the candidate page.
 * That reuse is the point: a reader learns one row shape and it holds everywhere,
 * so the shape itself becomes the guarantee — stance, plain summary, the words in
 * their source, the link.
 *
 * A record is never a card. Full-bleed, separated by a hairline rule, no shadow.
 */
export function PositionRecord({
  candidate,
  position,
  sourcesRead,
  issueName,
  showHead = true,
  asOf,
}: {
  candidate: {
    slug: string;
    fullName: string;
    party: { name: string; abbreviation: string } | null;
    isIncumbent?: boolean;
    ballotOrder?: number | null;
  };
  position: Position | null;
  sourcesRead: SourceRow[];
  issueName: string;
  showHead?: boolean;
  asOf?: string;
}) {
  const silent = !position || !isOnTrack(position.stance);

  return (
    <article className="record">
      {showHead ? <CandidateHead {...candidate} /> : null}

      {position && !silent ? (
        <div className={showHead ? "mt-3" : ""}>
          <StanceLine stance={position.stance} label={`${candidate.fullName} on ${issueName}`} />
          <p className="mt-3 max-w-measure text-summary text-ink">{position.summary}</p>

          {position.evidence.map((e) => (
            <QuoteInSource key={e.id} evidence={e} />
          ))}

          <details className="mt-3">
            <summary className="mono inline-flex min-h-[44px] items-center underline decoration-rule-strong underline-offset-4 hover:decoration-ink">
              How we recorded this
            </summary>
            <div className="mono mt-2 space-y-1 !normal-case !tracking-normal">
              <p>
                Two models read the source independently and agreed on this stance. A person
                reviewed it before publication. The quote is a verbatim span of the archived
                document — we store the source&rsquo;s own text, not the model&rsquo;s copy of it.
              </p>
              <p className="uppercase tracking-[0.08em]">
                <span className="select-all">{position.id}</span>
                {position.publishedAt ? ` · Published ${fmtDate(position.publishedAt)}` : ""}
                {position.supersedesId ? " · Correction — replaces an earlier row" : ""}
              </p>
            </div>
          </details>
        </div>
      ) : (
        <SilenceReceipt
          stance={
            position?.stance === "DECLINED_TO_STATE" ? "DECLINED_TO_STATE" : "NO_STATED_POSITION"
          }
          candidateName={candidate.fullName}
          issueName={issueName}
          sourcesRead={sourcesRead}
          {...(asOf ? { asOf } : {})}
        />
      )}
    </article>
  );
}

export function PageHeader({
  eyebrow,
  title,
  meta,
  back,
}: {
  eyebrow?: string;
  title: string;
  meta?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="pb-6 pt-6">
      {back ? (
        <Link
          href={back.href}
          className="mono mb-4 inline-flex min-h-[44px] items-center underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
        >
          ‹ {back.label}
        </Link>
      ) : null}
      {eyebrow ? <p className="mono mb-2">{eyebrow}</p> : null}
      <h1 className="max-w-measure font-serif text-display font-bold">{title}</h1>
      {meta ? <div className="mt-3">{meta}</div> : null}
    </header>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="inline-block">
      <span className="border-b-2 border-ink pb-0.5 text-[20px] font-semibold tracking-tight">
        Civic
      </span>
    </Link>
  );
}

export function SiteFooter({ stamp }: { stamp?: string }) {
  return (
    <footer className="mt-16 border-t border-rule py-8">
      <nav className="mono flex flex-wrap gap-x-4 gap-y-2">
        <Link href="/methodology" className="link">
          How we do this
        </Link>
        <Link href="/corrections" className="link">
          Corrections log
        </Link>
        <Link href="/methodology#ai" className="link">
          Our AI policy
        </Link>
      </nav>
      <p className="mono mt-4">{stamp ?? "Taxonomy 0003"}</p>
      <p className="mono mt-2 !normal-case !tracking-normal">
        Civic does not tell you how to vote, does not accept advertising, and stores nothing about
        you.
      </p>
    </footer>
  );
}
