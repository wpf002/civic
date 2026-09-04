import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { fmtDate } from "@/components/evidence";
import { CoverageMeter, PartyMark } from "@/components/coverage";
import { PositionRecord, SiteFooter, Wordmark } from "@/components/record";
import type { CandidateDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The candidate's whole record, with coverage stated before any position so that
 * sparsity reads as disclosure rather than as thin content.
 *
 * No photo hero, no bio, no endorsements, no donor totals. Nothing whose ordering
 * or inclusion could be argued about.
 */
export default async function CandidatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await apiOrNull<CandidateDetail>(`/v1/candidates/${slug}`);
  if (!c) notFound();

  const candidacy = c.candidacies[0];
  const surname = c.fullName.split(" ").slice(-1)[0] ?? c.fullName;
  const lastChecked = c.sourcesRead.map((s) => s.capturedAt).sort().at(-1);
  const byIssue = new Map(c.positions.map((p) => [p.issue.slug, p]));

  return (
    <div className="mx-auto max-w-2xl px-5">
      <div className="pt-8">
        <Wordmark />
      </div>

      <main id="main">
        <header className="pb-2 pt-6">
          {candidacy ? (
            <Link
              href={`/e/${candidacy.electionSlug}`}
              className="mono mb-4 inline-flex min-h-[44px] items-center underline decoration-rule-strong underline-offset-4 hover:decoration-ink"
            >
              ‹ {candidacy.electionName}
            </Link>
          ) : null}
          <h1 className="font-serif text-display font-bold">{c.fullName}</h1>
          {candidacy ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="text-[15px] text-ink-2">
                Candidate for {candidacy.office}
                {candidacy.district ? `, ${candidacy.district}` : ""}
              </span>
              {candidacy.party ? (
                <PartyMark
                  abbreviation={candidacy.party.abbreviation}
                  name={candidacy.party.name}
                />
              ) : null}
              {candidacy.isIncumbent ? (
                <span className="mono border border-rule-strong px-1.5 py-0.5">Incumbent</span>
              ) : null}
            </div>
          ) : null}
          {candidacy ? (
            <p className="mono mt-2">
              {candidacy.jurisdiction} · {fmtDate(candidacy.electionDate)}
              {candidacy.termYears ? ` · ${candidacy.termYears}-year term` : ""}
              {candidacy.ballotOrder ? ` · Ballot position ${candidacy.ballotOrder}` : ""}
            </p>
          ) : null}

          <CoverageMeter coverage={c.coverage} subject={surname} />
        </header>

        <section className="mt-10" aria-labelledby="positions">
          <h2 id="positions" className="font-serif text-title font-semibold">
            Where {surname} stands
          </h2>
          <div className="mt-2">
            {c.coverage.map((issue) => {
              const p = byIssue.get(issue.slug);
              if (issue.state === "unattempted") return null;
              return (
                <div key={issue.slug}>
                  <p className="mono mt-6">{issue.name}</p>
                  <PositionRecord
                    candidate={{ slug: c.slug, fullName: c.fullName, party: null }}
                    position={p ?? null}
                    sourcesRead={c.sourcesRead}
                    issueName={issue.name}
                    showHead={false}
                    {...(lastChecked ? { asOf: lastChecked } : {})}
                  />
                </div>
              );
            })}
          </div>
        </section>

        {c.votes.length > 0 ? (
          <section className="mt-12" aria-labelledby="votes">
            <h2 id="votes" className="font-serif text-title font-semibold">
              Voting record
            </h2>
            <p className="mono mt-2 border border-rule-strong px-2 py-1">
              Ingested from the official record · Not model-extracted
            </p>
            <ul className="mt-2">
              {c.votes.map((v) => (
                <li key={v.id} className="record">
                  <p className="mono">
                    {fmtDate(v.votedAt)} · {v.billId} · Voted {v.vote}
                  </p>
                  <p className="mt-1 max-w-measure text-base">{v.billTitle}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-12 border-t border-rule pt-6" aria-labelledby="corrections">
          <h2 id="corrections" className="mono !text-ink">
            Something wrong here?
          </h2>
          <p className="mt-2 max-w-measure text-base">
            A correction never edits a published row. It publishes a new one, dated, and the
            original stays visible in the{" "}
            <Link href="/corrections" className="underline decoration-rule-strong underline-offset-4">
              corrections log
            </Link>
            .
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`/report?target=candidate&id=${c.slug}`} className="btn">
              Report a problem
            </Link>
            <Link href={`/report?target=candidate&id=${c.slug}&self=1`} className="btn">
              Are you this candidate?
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
