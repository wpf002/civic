import Link from "next/link";
import { SiteFooter, Wordmark } from "@/components/record";

export default function Thanks() {
  return (
    <div className="mx-auto max-w-2xl px-5">
      <div className="pt-8">
        <Wordmark />
      </div>
      <main id="main" className="pt-8">
        <h1 className="font-serif text-display font-bold">Got it.</h1>
        <p className="mt-4 max-w-measure text-base">
          A person reads every report. If it results in a change, the correction will appear in the{" "}
          <Link href="/corrections" className="link">
            corrections log
          </Link>{" "}
          with the date and the row it replaced.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
