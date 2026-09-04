import Link from "next/link";
import { api } from "@/lib/api";
import { fmtDate } from "@/components/evidence";
import { SiteFooter, Wordmark } from "@/components/record";
import { STANCE_WORD } from "@/components/stance";
import type { Stance } from "@civic/core";

export const dynamic = "force-dynamic";
export const metadata = { title: "Corrections log — Civic" };

type Correction = {
  id: string;
  stance: Stance;
  summary: string;
  capturedAt: string;
  candidate: { slug: string; fullName: string };
  issue: { slug: string; name: string };
  supersededBy: { id: string; stance: Stance; summary: string; publishedAt: string | null } | null;
};

export default async function Corrections() {
  const rows = await api<Correction[]>("/v1/corrections").catch(() => []);

  return (
    <div className="mx-auto max-w-2xl px-5">
      <div className="pt-8">
        <Wordmark />
      </div>
      <main id="main" className="pt-8">
        <h1 className="font-serif text-display font-bold">Corrections</h1>
        <p className="mt-3 max-w-measure text-base">
          A published position is never edited. When we get something wrong, a new dated row
          replaces it and the original stays here.
        </p>

        {rows.length === 0 ? (
          <p className="record mt-8 max-w-measure text-base">
            No corrections yet. This page exists before it is needed, because a corrections log that
            appears only after the first mistake is not a policy.
          </p>
        ) : (
          <ul className="mt-8">
            {rows.map((r) => (
              <li key={r.id} className="record">
                <p className="mono">{fmtDate(r.capturedAt)}</p>
                <p className="mt-1 text-summary font-semibold">
                  <Link href={`/c/${r.candidate.slug}`} className="underline underline-offset-4">
                    {r.candidate.fullName}
                  </Link>{" "}
                  · {r.issue.name}
                </p>
                <p className="mt-2 max-w-measure text-base text-ink-2 line-through">
                  {STANCE_WORD[r.stance]} — {r.summary}
                </p>
                {r.supersededBy ? (
                  <p className="mt-1 max-w-measure text-base">
                    {STANCE_WORD[r.supersededBy.stance]} — {r.supersededBy.summary}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
