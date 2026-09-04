import { SiteFooter, Wordmark } from "@/components/record";

export const metadata = { title: "How Civic works — methodology" };

/**
 * Every credible product in this category publishes a dated, versioned methodology
 * with an explicit AI policy. Shipping a two-model LLM pipeline without one is the
 * trust comparison Civic loses by default.
 */
export default function Methodology() {
  return (
    <div className="mx-auto max-w-2xl px-5">
      <div className="pt-8">
        <Wordmark />
      </div>
      <main id="main" className="pt-8">
        <h1 className="font-serif text-display font-bold">How Civic works</h1>
        <p className="mono mt-3">Version 0.1 · September 4, 2026</p>

        <div className="mt-8 space-y-8">
          <section>
            <h2 className="font-serif text-title font-semibold">What a position is</h2>
            <p className="mt-2 max-w-measure text-base">
              One row per candidate per issue: a stance on a five-point scale, a two-sentence
              summary of what the candidate said, and a verbatim quote from an archived source with
              a link. If we could not find the words, there is no row asserting a stance.
            </p>
          </section>

          <section id="ai">
            <h2 className="font-serif text-title font-semibold">Our AI policy</h2>
            <ul className="mt-2 max-w-measure list-disc space-y-2 pl-5 text-base">
              <li>
                Two different models read each source independently. Where they agree on a stance,
                the row becomes a draft. Where they disagree, a person decides.
              </li>
              <li>
                No row is published without a person reviewing it.
              </li>
              <li>
                Every quote is checked against the archived source before storage. The check ignores
                differences in line wrapping and nothing else — changed words, reordered words or
                altered punctuation all fail, and a failed quote is discarded rather than corrected.
              </li>
              <li>
                What we store is the source&rsquo;s own text, not the model&rsquo;s copy of it. A
                published quote is a byte-exact span of the archived document.
              </li>
              <li>
                A model never decides that a candidate holds a position it could not quote, and
                never infers one from party, endorsements, donors or another candidate.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-title font-semibold">
              When we say &ldquo;no stated position&rdquo;
            </h2>
            <p className="mt-2 max-w-measure text-base">
              It means we searched the sources listed on that page, through the date shown, and the
              candidate has not addressed the issue. It is a finding, not a gap we failed to fill,
              and it is never quietly filled in from party or from what similar candidates say.
              Where a candidate was asked directly and declined, we say that instead — it is
              different information.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-title font-semibold">Order and equal effort</h2>
            <p className="mt-2 max-w-measure text-base">
              Candidates appear in ballot order, never alphabetically and never by how much we found
              about them. Every candidate in a covered race gets the same source-gathering checklist,
              and the coverage meter on each page shows where that effort came up empty.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-title font-semibold">Corrections</h2>
            <p className="mt-2 max-w-measure text-base">
              A published row is never edited. A correction publishes a new dated row and the
              original stays visible in the corrections log, so the record of what we got wrong is
              public.
            </p>
          </section>

          <section>
            <h2 className="font-serif text-title font-semibold">What we know about you</h2>
            <p className="mt-2 max-w-measure text-base">
              Nothing. There are no accounts. Quiz answers are scored in your browser and never
              sent to us. An address is turned into a district and discarded.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
