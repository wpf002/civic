import { SiteFooter, Wordmark } from "@/components/record";

export const metadata = { title: "Report a problem — Civic" };

export default async function Report({
  searchParams,
}: {
  searchParams: Promise<{ target?: string; id?: string; self?: string }>;
}) {
  const { target = "candidate", id = "", self } = await searchParams;
  const isCandidate = self === "1";

  return (
    <div className="mx-auto max-w-2xl px-5">
      <div className="pt-8">
        <Wordmark />
      </div>
      <main id="main" className="pt-8">
        <h1 className="font-serif text-display font-bold">
          {isCandidate ? "Are you this candidate?" : "Report a problem"}
        </h1>
        <p className="mt-4 max-w-measure text-base">
          {isCandidate
            ? "Tell us what we got wrong, or send us a source we missed. We will not remove a position because you disagree with how it reads — but if the quote is wrong, the source is wrong, or you have stated a position we did not find, that is a correction and we will make it."
            : "Tell us what is wrong. Include a link if you have one."}
        </p>
        <p className="mono mt-4 max-w-measure !normal-case !tracking-normal">
          A correction never edits a published row. It publishes a new dated row, and the original
          stays visible in the corrections log. We do this so the record of what we got wrong is
          public rather than quietly erased.
        </p>

        <form action="/api/report" method="post" className="mt-8">
          <input type="hidden" name="targetType" value={target} />
          <input type="hidden" name="targetId" value={id} />
          <label htmlFor="message" className="block text-summary font-semibold">
            What is wrong?
          </label>
          <textarea
            id="message"
            name="message"
            required
            maxLength={1000}
            rows={6}
            className="mt-2 w-full rounded-[2px] border border-rule-strong bg-surface p-3 text-base text-ink"
          />
          <p className="mono mt-2 !normal-case !tracking-normal">
            We store your message and a one-way hash of your IP address for rate limiting. No
            account, no email, no cookie.
          </p>
          <button type="submit" className="btn btn-primary mt-4 w-full">
            Send
          </button>
        </form>
      </main>
      <SiteFooter />
    </div>
  );
}
