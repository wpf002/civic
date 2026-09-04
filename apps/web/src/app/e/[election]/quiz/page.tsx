import { notFound } from "next/navigation";
import { apiOrNull } from "@/lib/api";
import { SiteFooter, Wordmark } from "@/components/record";
import { Quiz } from "./quiz";
import type { QuizPayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function QuizPage({ params }: { params: Promise<{ election: string }> }) {
  const { election } = await params;
  const data = await apiOrNull<QuizPayload>(`/v1/elections/${election}/quiz`);
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-2xl px-5">
      <div className="pt-8">
        <Wordmark />
      </div>
      <main id="main" className="pt-8">
        <Quiz data={data} />
      </main>
      <SiteFooter />
    </div>
  );
}
