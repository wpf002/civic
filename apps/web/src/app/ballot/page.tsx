import Link from "next/link";
import { SiteFooter, Wordmark } from "@/components/record";
import { fmtDate } from "@/components/evidence";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your ballot — Civic" };

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface BallotResponse {
  matched: string;
  districts: Record<string, string | null>;
  ballot: Array<{
    election: { slug: string; name: string; electionDate: string };
    races: Array<{
      office: string;
      seat: string | null;
      candidates: Array<{
        slug: string;
        name: string;
        party: string | null;
        isWriteIn: boolean;
        publishedPositions: number;
      }>;
    }>;
  }>;
  notCovered: string[];
  coverageNote: string;
}

/**
 * The address is sent to the API and never held here.
 *
 * It arrives as a search param because a form GET is what a browser does, and the
 * page immediately trades it for districts. Nothing writes it down, and the page
 * renders the geocoder's normalisation rather than echoing what was typed.
 */
export default async function Ballot({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const { address } = await searchParams;
  if (!address) {
    return (
      <Shell>
        <p className="record max-w-measure text-base">
          No address given. <Link href="/" className="link">Start again</Link>.
        </p>
      </Shell>
    );
  }

  let data: BallotResponse | null = null;
  let error: string | null = null;
  try {
    const res = await fetch(`${BASE}/v1/ballot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
      cache: "no-store",
    });
    if (res.ok) data = (await res.json()) as BallotResponse;
    else error = ((await res.json()) as { why?: string }).why ?? `Lookup failed (${res.status}).`;
  } catch {
    error = "The lookup service did not respond.";
  }

  if (error || !data) {
    return (
      <Shell>
        <p className="record max-w-measure text-base">{error}</p>
        <p className="mt-4">
          <Link href="/" className="link">Try a different address</Link>
        </p>
      </Shell>
    );
  }

  const raceCount = data.ballot.reduce((n, e) => n + e.races.length, 0);

  return (
    <Shell>
      <p className="mono">{data.matched}</p>
      <h1 className="mt-3 max-w-measure font-serif text-display font-bold">
        {raceCount === 0 ? "We do not cover any race here yet" : `${raceCount} race${raceCount === 1 ? "" : "s"} we cover`}
      </h1>

      {/*
        The gaps go above the results, not below them. A list of three races with the
        missing four in a footnote reads as a complete ballot, and that is the single
        most damaging thing this page could imply.
      */}
      {data.notCovered.length > 0 ? (
        <div className="mt-6 border-l-[3px] border-ink bg-sunk px-4 py-4">
          <p className="mono !text-ink">Not your whole ballot</p>
          <p className="mt-2 max-w-measure text-base">
            You will also be voting in these, and we do not have them yet:
          </p>
          <ul className="mt-2 space-y-1 text-base">
            {data.notCovered.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.ballot.map((e) => (
        <section key={e.election.slug} className="mt-10" aria-labelledby={e.election.slug}>
          <h2 id={e.election.slug} className="font-serif text-title font-semibold">
            {e.election.name}
          </h2>
          <p className="mono mt-1">{fmtDate(e.election.electionDate)}</p>

          {e.races.map((r) => (
            <article key={`${r.office}-${r.seat}`} className="record">
              <p className="mono">
                {r.office}
                {r.seat ? ` · ${r.seat}` : ""}
              </p>
              <ul className="mt-3 space-y-2">
                {r.candidates.map((c) => (
                  <li key={c.slug} className="flex items-baseline justify-between gap-4">
                    <Link href={`/c/${c.slug}`} className="link text-summary">
                      {c.name}
                      {c.party ? <span className="mono ml-2">{c.party}</span> : null}
                      {c.isWriteIn ? <span className="mono ml-2">write-in</span> : null}
                    </Link>
                    <span className="mono shrink-0">
                      {/*
                        Zero is stated, not hidden. "No positions researched yet" is a
                        fact about our coverage; leaving it blank would read as the
                        candidate having said nothing.
                      */}
                      {c.publishedPositions === 0
                        ? "none researched yet"
                        : `${c.publishedPositions} position${c.publishedPositions === 1 ? "" : "s"}`}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ))}

      <p className="mono mt-10 !normal-case !tracking-normal max-w-measure">
        Your address was used to look up districts and was not stored. This page shows what the
        Census geocoder matched, not what you typed.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-5">
      <header className="pt-8">
        <Wordmark />
      </header>
      <main id="main" className="pt-6">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
