import { adminFetch, adminToken } from "@/lib/admin";
import { fmtDate } from "@/components/evidence";
import { StanceLine } from "@/components/stance";
import { Wordmark } from "@/components/record";
import { decidePosition, decideRoster, signIn, signOut } from "./actions";
import type { Stance } from "@civic/core";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review — Civic", robots: { index: false, follow: false } };

type Queue = {
  counts: { tasks: number; quarantinedDiffs: number; draftPositions: number };
  rosterDiffs: Array<{
    id: string;
    createdAt: string;
    added: string[];
    removed: string[];
    requiresArtifact: boolean;
    race: { office: string; district: string | null; election: string };
    before: number;
    after: number;
    sourceUrl: string;
    observedAt: string;
  }>;
  draftPositions: Array<{
    id: string;
    stance: Stance;
    summary: string;
    confidence: number;
    candidate: { slug: string; fullName: string };
    issue: { slug: string; name: string };
    evidence: Array<{
      id: string;
      quote: string;
      source: { url: string; title: string | null; capturedAt: string };
    }>;
  }>;
  recentRuns: Array<{
    id: string;
    adapter: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    changedCount: number;
  }>;
};

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;
  const token = await adminToken();
  if (!token) return <SignIn />;

  const res = await adminFetch<Queue>("/queue");
  if (!res.ok) return <SignIn error={`${res.status} — ${res.error}`} />;
  const q = res.data;

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24">
      <header className="flex items-baseline justify-between pt-8">
        <Wordmark />
        <form action={signOut}>
          <button className="mono underline decoration-rule-strong underline-offset-4">
            Sign out
          </button>
        </form>
      </header>

      <h1 className="mt-6 font-serif text-display font-bold">Review queue</h1>
      <p className="mono mt-2">
        {q.counts.quarantinedDiffs} roster changes held · {q.counts.draftPositions} draft positions
      </p>
      {actionError ? (
        <p className="mt-4 border-l-[3px] border-ink bg-sunk px-4 py-3 text-base text-ink">
          {actionError}
        </p>
      ) : null}

      <p className="mt-3 max-w-measure text-base text-ink-2">
        A roster change that removes a candidate is held here until someone attaches the document
        that justifies it. Nothing on this page deletes a row: a removal marks the candidacy
        withdrawn with the artifact recorded, and the history stays intact.
      </p>

      <section className="mt-10" aria-labelledby="rosters">
        <h2 id="rosters" className="font-serif text-title font-semibold">
          Roster changes held
        </h2>
        {q.rosterDiffs.length === 0 ? (
          <p className="record text-base">Nothing held. Every roster change so far was additive.</p>
        ) : (
          q.rosterDiffs.map((d) => (
            <article key={d.id} className="record">
              <p className="mono">
                {d.race.office}
                {d.race.district ? ` · ${d.race.district}` : ""} · {d.race.election} ·{" "}
                {fmtDate(d.observedAt)}
              </p>
              <p className="mt-2 text-summary">
                {d.before} → {d.after} candidates
              </p>

              {d.removed.length > 0 ? (
                <div className="mt-3 border-l-[3px] border-ink bg-sunk px-4 py-3">
                  <p className="mono !text-ink">Removed — needs a document</p>
                  <ul className="mt-1 text-base">
                    {d.removed.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {d.added.length > 0 ? (
                <p className="mt-2 text-base">Added: {d.added.join(", ")}</p>
              ) : null}

              <p className="mono mt-2">
                <a href={d.sourceUrl} target="_blank" rel="noopener" className="link">
                  Source as fetched ↗
                </a>
              </p>

              <form action={decideRoster} className="mt-4 space-y-3">
                <input type="hidden" name="id" value={d.id} />
                <div className="flex flex-wrap gap-3">
                  <label className="flex-1">
                    <span className="mono">Your name</span>
                    <input
                      name="reviewer"
                      required
                      className="mt-1 h-11 w-full rounded-[2px] border border-rule-strong bg-surface px-3"
                    />
                  </label>
                  <label className="flex-1">
                    <span className="mono">
                      Document URL {d.requiresArtifact ? "(required)" : "(optional)"}
                    </span>
                    <input
                      name="artifactUrl"
                      type="url"
                      required={d.requiresArtifact}
                      placeholder="https://…/certificate-of-withdrawal.pdf"
                      className="mt-1 h-11 w-full rounded-[2px] border border-rule-strong bg-surface px-3"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="mono">Note</span>
                  <input
                    name="note"
                    className="mt-1 h-11 w-full rounded-[2px] border border-rule-strong bg-surface px-3"
                  />
                </label>
                <div className="flex gap-3">
                  <button name="decision" value="accept" className="btn btn-primary flex-1">
                    Accept
                  </button>
                  <button name="decision" value="reject" className="btn flex-1">
                    Reject
                  </button>
                </div>
              </form>
            </article>
          ))
        )}
      </section>

      <section className="mt-14" aria-labelledby="positions">
        <h2 id="positions" className="font-serif text-title font-semibold">
          Draft positions
        </h2>
        {q.draftPositions.length === 0 ? (
          <p className="record text-base">No drafts waiting.</p>
        ) : (
          q.draftPositions.map((p) => (
            <article key={p.id} className="record">
              <p className="mono">
                {p.candidate.fullName} · {p.issue.name} · confidence {p.confidence}
              </p>
              <div className="mt-2">
                <StanceLine stance={p.stance} label={`${p.candidate.fullName} on ${p.issue.name}`} />
              </div>
              <p className="mt-2 max-w-measure text-summary">{p.summary}</p>
              {p.evidence.map((e) => (
                <figure key={e.id} className="mt-3 border-l-[3px] border-ink bg-sunk px-4 py-3">
                  <blockquote className="max-w-measure whitespace-pre-line font-serif text-quote">
                    {e.quote}
                  </blockquote>
                  <figcaption className="mono mt-2">
                    <a href={e.source.url} target="_blank" rel="noopener" className="link">
                      {e.source.title ?? e.source.url} ↗
                    </a>
                    <span> · captured {fmtDate(e.source.capturedAt)}</span>
                  </figcaption>
                </figure>
              ))}
              {p.evidence.length === 0 && p.stance !== "NO_STATED_POSITION" ? (
                <p className="mono mt-2 !text-ink">
                  No evidence attached — this cannot be published.
                </p>
              ) : null}

              <form action={decidePosition} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="id" value={p.id} />
                <label className="flex-1">
                  <span className="mono">Your name</span>
                  <input
                    name="reviewer"
                    required
                    className="mt-1 h-11 w-full rounded-[2px] border border-rule-strong bg-surface px-3"
                  />
                </label>
                <button name="decision" value="publish" className="btn btn-primary">
                  Publish
                </button>
                <button name="decision" value="reject" className="btn">
                  Reject
                </button>
              </form>
            </article>
          ))
        )}
      </section>

      <section className="mt-14" aria-labelledby="runs">
        <h2 id="runs" className="font-serif text-title font-semibold">
          Recent ingest runs
        </h2>
        <p className="mono mt-2 !normal-case !tracking-normal">
          A scheduled job that never fired produces no error anywhere else. If a row you expect is
          missing here, the job did not run.
        </p>
        {q.recentRuns.length === 0 ? (
          <p className="record text-base">No runs recorded yet.</p>
        ) : (
          <ul className="mt-2">
            {q.recentRuns.map((r) => (
              <li key={r.id} className="record !py-3">
                <p className="mono">
                  {fmtDate(r.startedAt)} · {r.adapter} · {r.status} · {r.changedCount} changed
                  {r.finishedAt ? "" : " · DID NOT FINISH"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SignIn({ error }: { error?: string }) {
  return (
    <div className="mx-auto max-w-md px-5">
      <div className="pt-8">
        <Wordmark />
      </div>
      <main className="pt-10">
        <h1 className="font-serif text-display font-bold">Review</h1>
        <p className="mt-3 max-w-measure text-base text-ink-2">
          Shared-secret access. This is not real authentication and has to be replaced before the
          pilot.
        </p>
        {error ? <p className="mono mt-4 !text-ink">{error}</p> : null}
        <form action={signIn} className="mt-6">
          <label htmlFor="token" className="mono">
            Admin token
          </label>
          <input
            id="token"
            name="token"
            type="password"
            autoComplete="off"
            className="mt-2 h-12 w-full rounded-[2px] border border-rule-strong bg-surface px-3"
          />
          <button className="btn btn-primary mt-4 w-full">Continue</button>
        </form>
      </main>
    </div>
  );
}
