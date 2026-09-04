import Link from "next/link";
import { api } from "@/lib/api";
import { fmtDate } from "@/components/evidence";
import { SiteFooter, Wordmark } from "@/components/record";
import type { ElectionSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The honesty frame goes above the fold and above the input, not in a footer —
 * Wahl-O-Mat puts "keine Wahlempfehlung" above the Start button for 26 million
 * users, and burying it is how a neutral product stops reading as one.
 */
const FRAME = [
  "Civic does not tell you how to vote.",
  "Every stance links to the candidate's own words in an archived source.",
  "If a candidate hasn't said, we say so.",
];

export default async function Home() {
  const elections = await api<ElectionSummary[]>("/v1/elections").catch(() => []);

  return (
    <div className="mx-auto max-w-2xl px-5">
      <header className="pt-8">
        <Wordmark />
        <p className="mono mt-3">Issue-first voter guide · Dallas County, TX</p>
      </header>

      <main id="main">
        <h1 className="mt-8 max-w-measure font-serif text-display font-bold">
          See what they actually said. With the quote and the link.
        </h1>

        <ul className="mt-8 space-y-3">
          {FRAME.map((line) => (
            <li key={line} className="flex gap-3 text-base text-ink">
              <span aria-hidden className="mt-[0.7em] h-px w-4 shrink-0 bg-ink" />
              <span className="max-w-measure">{line}</span>
            </li>
          ))}
        </ul>

        <form action="/e/2027-11-dallas" className="mt-10">
          <label htmlFor="address" className="block text-summary font-semibold">
            Where do you vote?
          </label>
          <input
            id="address"
            name="address"
            type="text"
            autoComplete="street-address"
            placeholder=""
            className="mt-2 h-14 w-full rounded-[2px] border border-rule-strong bg-surface px-4 text-[17px] text-ink"
          />
          <p className="mono mt-2 !normal-case !tracking-normal">
            We turn your address into a district and discard it. Nothing is stored.
          </p>
          <button type="submit" className="btn btn-primary mt-4 w-full">
            Find my ballot
          </button>
        </form>

        <section className="mt-12" aria-labelledby="elections">
          <h2 id="elections" className="mono !text-ink">
            Or browse without an address
          </h2>
          {elections.length === 0 ? (
            <p className="record max-w-measure text-base">
              No election has published data yet. An election appears here only once positions have
              been reviewed and published — we would rather show nothing than show a guess.
            </p>
          ) : (
            <ul>
              {elections.map((e) => (
                <li key={e.slug} className="record">
                  <Link href={`/e/${e.slug}`} className="group block">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-serif text-title group-hover:underline">{e.name}</span>
                      <span aria-hidden className="text-ink-2">
                        ›
                      </span>
                    </div>
                    <p className="mono mt-2">{fmtDate(e.electionDate)}</p>
                    <p className="mono mt-1 !normal-case !tracking-normal">
                      {e.counts.races} races · {e.counts.candidates} candidates ·{" "}
                      {e.counts.stated} stated positions · {e.counts.silent} with none
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
