import Link from "next/link";
import { adminFetch, adminToken } from "@/lib/admin";
import { StanceLine } from "@/components/stance";
import { Wordmark } from "@/components/record";
import { publishRace } from "../actions";
import type { Stance } from "@civic/core";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review by race — Civic", robots: { index: false, follow: false } };

interface Queue {
  races: Array<{
    raceId: string;
    election: string;
    office: string;
    seat: string | null;
    certifiedCandidates: number;
    candidatesWithNoSource: number;
    pending: number;
    published: number;
    sample: Array<{
      id: string;
      candidate: string | null;
      issue: string;
      question: string | null;
      stance: Stance;
      summary: string;
      quote: string | null;
      sourceUrl: string | null;
    }>;
    batchIds: string[];
  }>;
  totals: { races: number; pending: number; published: number };
}

export default async function Review({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; published?: string; refused?: string }>;
}) {
  const { error, published, refused } = await searchParams;
  if (!(await adminToken())) {
    return (
      <Shell>
        <p className="record text-base">
          Not signed in. <Link href="/admin" className="link">Sign in</Link>.
        </p>
      </Shell>
    );
  }

  const res = await adminFetch<Queue>("/review/races?sample=4");
  if (!res.ok) {
    return (
      <Shell>
        <p className="record text-base">
          {res.status} — {res.error}
        </p>
      </Shell>
    );
  }
  const q = res.data;

  return (
    <Shell>
      <h1 className="font-serif text-display font-bold">Review by race</h1>
      <p className="mono mt-2">
        {q.totals.races} races · {q.totals.pending} waiting · {q.totals.published} live
      </p>

      <p className="mt-3 max-w-measure text-base text-ink-2">
        Read the sample. If those hold up, publish the race. The sample is drawn the same way every
        time you load this page — it does not reshuffle, so you cannot keep drawing until a batch
        looks good.
      </p>

      {error ? (
        <p className="mt-4 border-l-[3px] border-ink bg-sunk px-4 py-3 text-base">{error}</p>
      ) : null}
      {published ? (
        <p className="mt-4 border-l-[3px] border-ink bg-sunk px-4 py-3 text-base">
          Published {published}
          {refused ? ` · ${refused} refused and left unpublished` : ""}
        </p>
      ) : null}

      {q.races.filter((r) => r.pending > 0).length === 0 ? (
        <p className="record mt-8 text-base">
          Nothing waiting. Every verified position in these races is live.
        </p>
      ) : null}

      {q.races
        .filter((r) => r.pending > 0)
        .map((r) => (
          <article key={r.raceId} className="record">
            <p className="mono">
              {r.office}
              {r.seat ? ` · ${r.seat}` : ""} · {r.election}
            </p>
            <p className="mt-2 text-summary">
              {r.pending} waiting · {r.published} already live
            </p>

            {/*
              A race where candidates were never researched is not ready, however
              clean its sample reads. Said before the sample, not after it.
            */}
            {r.candidatesWithNoSource > 0 ? (
              <p className="mono mt-2 !text-ink">
                {r.candidatesWithNoSource} of {r.certifiedCandidates} candidates have nothing
                archived — publishing now leaves this race uneven
              </p>
            ) : null}

            <div className="mt-4 space-y-4">
              {r.sample.map((p) => (
                <div key={p.id} className="border-l-[3px] border-rule-strong pl-3">
                  <p className="mono">
                    {p.candidate} · {p.issue}
                  </p>
                  {p.question ? (
                    <p className="mt-1 max-w-measure text-base text-ink-2">{p.question}</p>
                  ) : null}
                  <div className="mt-2">
                    <StanceLine stance={p.stance} label={`${p.candidate} on ${p.issue}`} />
                  </div>
                  {p.quote ? (
                    <blockquote className="mt-2 max-w-measure whitespace-pre-line font-serif text-quote">
                      {p.quote}
                    </blockquote>
                  ) : null}
                  {p.sourceUrl ? (
                    <p className="mono mt-1">
                      <a href={p.sourceUrl} target="_blank" rel="noopener" className="link">
                        source ↗
                      </a>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>

            <form action={publishRace} className="mt-5 flex flex-wrap items-end gap-3">
              <input type="hidden" name="ids" value={r.batchIds.join(",")} />
              <label className="flex-1">
                <span className="mono">Your name</span>
                <input
                  name="reviewer"
                  required
                  className="mt-1 h-11 w-full rounded-[2px] border border-rule-strong bg-surface px-3"
                />
              </label>
              <button className="btn btn-primary">
                Publish all {r.pending}
              </button>
            </form>
          </article>
        ))}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-5 pb-24">
      <header className="flex items-baseline justify-between pt-8">
        <Wordmark />
        <Link href="/admin" className="mono underline decoration-rule-strong underline-offset-4">
          Queue
        </Link>
      </header>
      <main className="pt-6">{children}</main>
    </div>
  );
}
