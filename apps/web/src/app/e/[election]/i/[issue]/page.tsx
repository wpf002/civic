import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { fmtDate } from "@/components/evidence";
import { PageHeader, PositionRecord, SiteFooter, Wordmark } from "@/components/record";
import { isOnTrack } from "@/components/stance";
import type { ElectionDetail, IssueComparison } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The product. Every candidate in the election on one issue.
 *
 * Ballot order, disclosed. Not alphabetical, not by coverage, not by how well they
 * match — occupying rank 1 is worth 2-6 points of vote probability on its own, so
 * ordering is an intervention rather than a presentation detail.
 */
export default async function IssuePage({
  params,
}: {
  params: Promise<{ election: string; issue: string }>;
}) {
  const { election: slug, issue: issueSlug } = await params;
  const [data, election] = await Promise.all([
    apiOrNull<IssueComparison>(`/v1/elections/${slug}/issues/${issueSlug}`),
    apiOrNull<ElectionDetail>(`/v1/elections/${slug}`),
  ]);
  if (!data || !election) notFound();

  const idx = election.issues.findIndex((i) => i.slug === issueSlug);
  const prev = idx > 0 ? election.issues[idx - 1] : undefined;
  const next = idx >= 0 && idx < election.issues.length - 1 ? election.issues[idx + 1] : undefined;

  const stated = data.candidates.filter((c) => c.position && isOnTrack(c.position.stance));
  const silent = data.candidates.length - stated.length;
  const sourcesRead = new Set(data.candidates.flatMap((c) => c.sourcesRead.map((s) => s.id))).size;
  const lastChecked = data.candidates
    .flatMap((c) => c.sourcesRead.map((s) => s.capturedAt))
    .sort()
    .at(-1);

  const byRace = data.races.map((r) => ({
    race: r,
    candidates: data.candidates.filter((c) => c.raceId === r.id),
  }));

  return (
    <div className="mx-auto max-w-2xl px-5">
      <div className="pt-8">
        <Wordmark />
      </div>

      <main id="main">
        <PageHeader
          back={{ href: `/e/${slug}`, label: election.name }}
          title={data.issue.name}
          meta={
            <>
              <p className="max-w-measure text-base text-ink-2">{data.issue.description}</p>
              <p className="mono mt-3">
                {sourcesRead} sources read
                {lastChecked ? ` · Last checked ${fmtDate(lastChecked)}` : ""}
              </p>
              <p className="mono mt-1">
                {stated.length} stated · {silent} no stated position
              </p>
            </>
          }
        />

        <p className="mono border-y border-rule py-3">Ballot order · Not ranked</p>

        {byRace.map(({ race, candidates }) => (
          <section key={race.id} className="mt-8" aria-labelledby={`race-${race.id}`}>
            <h2 id={`race-${race.id}`} className="font-serif text-title font-semibold">
              {race.office}
              {race.district ? `, ${race.district}` : ""}
            </h2>
            <p className="mono mt-1">{race.jurisdiction}</p>

            <div className="mt-2">
              {candidates.map((c) => (
                <PositionRecord
                  key={c.slug}
                  candidate={c}
                  position={c.position}
                  sourcesRead={c.sourcesRead}
                  issueName={data.issue.name}
                  {...(lastChecked ? { asOf: lastChecked } : {})}
                />
              ))}
            </div>
          </section>
        ))}

        <nav className="mt-12 flex flex-wrap justify-between gap-3 border-t border-rule pt-6">
          {prev ? (
            <Link href={`/e/${slug}/i/${prev.slug}`} className="btn flex-1">
              ‹ {prev.name}
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {next ? (
            <Link href={`/e/${slug}/i/${next.slug}`} className="btn flex-1">
              {next.name} ›
            </Link>
          ) : (
            <span className="flex-1" />
          )}
        </nav>
      </main>

      <SiteFooter />
    </div>
  );
}
