import Link from "next/link";
import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { fmtDate } from "@/components/evidence";
import { PageHeader, SiteFooter, Wordmark } from "@/components/record";
import type { ElectionDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ElectionPage({ params }: { params: Promise<{ election: string }> }) {
  const { election: slug } = await params;
  const e = await apiOrNull<ElectionDetail>(`/v1/elections/${slug}`);
  if (!e) notFound();

  const offices = [...new Set(e.races.map((r) => r.office.title))];

  return (
    <div className="mx-auto max-w-2xl px-5">
      <div className="pt-8">
        <Wordmark />
      </div>

      <main id="main">
        <PageHeader
          title={e.name}
          meta={
            <>
              <p className="mono">{fmtDate(e.electionDate)}</p>
              <p className="mt-3 max-w-measure text-base text-ink">
                {e.counts.candidates} candidates across {e.counts.races} races.{" "}
                {e.counts.positions - e.counts.silent} stated positions published, and{" "}
                {e.counts.silent} places where a candidate has not stated one.
              </p>
            </>
          }
        />

        <div className="flex flex-wrap gap-3">
          <Link href={`/e/${e.slug}#issues`} className="btn flex-1">
            Browse issues
          </Link>
          <Link href={`/e/${e.slug}/quiz`} className="btn flex-1">
            Take the quiz · 2 min
          </Link>
        </div>

        <section id="issues" className="mt-12" aria-labelledby="issues-h">
          <h2 id="issues-h" className="font-serif text-title font-semibold">
            Issues on this ballot
          </h2>
          <p className="mono mt-2 !normal-case !tracking-normal">
            Listed in our published taxonomy order, not by how much the candidates disagree —
            ordering by disagreement would put the candidates who talk most at the top. Offices:{" "}
            {offices.join(", ")}.
          </p>

          <ul className="mt-4">
            {e.issues.map((i) => (
              <li key={i.slug} className="record">
                <Link href={`/e/${e.slug}/i/${i.slug}`} className="group block">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-serif text-title group-hover:underline">{i.name}</span>
                    <span aria-hidden className="text-ink-2">
                      ›
                    </span>
                  </div>
                  <p className="mt-2 max-w-measure text-caption text-ink-2">{i.description}</p>
                  <p className="mono mt-2">
                    {i.stated > 0
                      ? `${i.stated} stated · ${i.silent} no stated position`
                      : `No candidate has stated a position yet · ${i.silent} searched`}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFooter stamp={`Taxonomy 0003 · Data through ${fmtDate(new Date())}`} />
    </div>
  );
}
