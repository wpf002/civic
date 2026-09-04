"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { matchCandidates, type Stance, type UserAnswer } from "@civic/core";
import { CoverageTicks } from "@/components/coverage";
import { StanceLine, StanceRule, stanceFromValue, isOnTrack } from "@/components/stance";
import type { QuizPayload } from "@/lib/types";

/**
 * The match runs HERE, in the browser, using the same deterministic matcher the API
 * would use. The published positions arrive with the page; the answers never leave
 * the device. That is a stronger version of "we don't store your answers" than a
 * stateless endpoint, because there is no request to inspect, log, or subpoena.
 */

type Value = -2 | -1 | 0 | 1 | 2;
type Weight = 1 | 2 | 3;

const OPTIONS: Array<{ value: Value; label: string }> = [
  { value: 2, label: "Strongly agree" },
  { value: 1, label: "Agree" },
  { value: 0, label: "Mixed — it depends" },
  { value: -1, label: "Disagree" },
  { value: -2, label: "Strongly disagree" },
];

const WEIGHTS: Array<{ w: Weight; label: string }> = [
  { w: 1, label: "Skip" },
  { w: 2, label: "Counts" },
  { w: 3, label: "Deal-breaker" },
];

type Phase = "intro" | "questions" | "weights" | "results";

export function Quiz({ data }: { data: QuizPayload }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Value>>({});
  const [weights, setWeights] = useState<Record<string, Weight>>({});

  const positionsByIssue = useMemo(() => {
    const m = new Map<string, typeof data.positions>();
    for (const p of data.positions) {
      const list = m.get(p.issueSlug) ?? [];
      list.push(p);
      m.set(p.issueSlug, list);
    }
    return m;
  }, [data.positions]);

  const nameOf = useMemo(
    () => new Map(data.candidates.map((c) => [c.slug, c.fullName])),
    [data.candidates],
  );

  const answered = Object.keys(answers).length;
  const q = data.questions[at];

  function answer(issueSlug: string, v: Value) {
    setAnswers((a) => ({ ...a, [issueSlug]: v }));
  }

  if (phase === "intro") {
    return (
      <section aria-labelledby="start">
        <h1 id="start" className="font-serif text-display font-bold">
          {data.election.name}
        </h1>
        <ul className="mt-8 space-y-4">
          {[
            "This is not a voting recommendation.",
            "Your answers stay on your phone. They are never sent anywhere, and no analytics event contains them.",
            `${data.questions.length} questions · about 2 minutes.`,
          ].map((line) => (
            <li key={line} className="flex gap-3 text-base text-ink">
              <span aria-hidden className="mt-[0.7em] h-px w-4 shrink-0 bg-ink" />
              <span className="max-w-measure">{line}</span>
            </li>
          ))}
        </ul>
        <button className="btn btn-primary mt-8 w-full" onClick={() => setPhase("questions")}>
          Start
        </button>
      </section>
    );
  }

  if (phase === "questions" && q) {
    const chosen = answers[q.issueSlug];
    const here = positionsByIssue.get(q.issueSlug) ?? [];

    return (
      <section aria-labelledby="q">
        <div className="flex items-center gap-3">
          <span className="mono">
            {String(at + 1).padStart(2, "0")} / {String(data.questions.length).padStart(2, "0")}
          </span>
          <CoverageTicks
            states={data.questions.map((qq, i) =>
              answers[qq.issueSlug] !== undefined ? "stated" : i === at ? "silent" : "unattempted",
            )}
            label={`Question ${at + 1} of ${data.questions.length}`}
          />
        </div>

        <h1 id="q" className="mt-6 max-w-measure font-serif text-question font-semibold">
          {q.prompt}
        </h1>

        <details className="mt-3">
          <summary className="mono inline-flex min-h-[44px] items-center underline decoration-rule-strong underline-offset-4">
            What this means
          </summary>
          <p className="mt-2 max-w-measure text-caption text-ink-2">{q.issueDescription}</p>
        </details>

        <div className="mt-6 space-y-2">
          {OPTIONS.map((o) => {
            const isChosen = chosen === o.value;
            const holders = here.filter(
              (p) => isOnTrack(p.stance as Stance) && stanceOf(p.stance as Stance) === o.value,
            );
            return (
              <div key={o.value}>
                <button
                  onClick={() => answer(q.issueSlug, o.value)}
                  aria-pressed={isChosen}
                  className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[2px] border px-4 py-2 text-left ${
                    isChosen ? "border-ink border-l-[3px] bg-surface" : "border-rule-strong"
                  }`}
                >
                  <span className={isChosen ? "font-semibold" : ""}>{o.label}</span>
                  <StanceRule
                    stance={stanceFromValue(o.value)}
                    label={o.label}
                    size="sm"
                  />
                </button>
                {/* Answer-then-reveal: every option opens, not just the chosen one. The
                    ~60% who abandon partway still get the comparison. */}
                {chosen !== undefined ? (
                  <p className="mono mt-1 px-1 !normal-case !tracking-normal">
                    {holders.length === 0
                      ? "No candidate on this ballot has said this."
                      : holders.map((h) => nameOf.get(h.candidateSlug) ?? h.candidateSlug).join(", ")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <button
          className="btn mt-4 w-full"
          onClick={() => {
            setAnswers((a) => {
              const { [q.issueSlug]: _drop, ...rest } = a;
              return rest;
            });
            advance();
          }}
        >
          Skip — this one doesn&rsquo;t matter to me
        </button>

        <div className="mt-6 flex gap-3">
          <button className="btn flex-1" disabled={at === 0} onClick={() => setAt((i) => i - 1)}>
            ‹ Back
          </button>
          <button className="btn btn-primary flex-1" onClick={advance}>
            {at === data.questions.length - 1 ? "Next: what matters most" : "Next ›"}
          </button>
        </div>
      </section>
    );

    function advance() {
      if (at === data.questions.length - 1) setPhase("weights");
      else setAt((i) => i + 1);
    }
  }

  if (phase === "weights") {
    return (
      <section aria-labelledby="weights-h">
        <h1 id="weights-h" className="font-serif text-question font-semibold">
          Which of these matter most to you?
        </h1>
        <p className="mono mt-2 !normal-case !tracking-normal">
          Everything starts at &ldquo;Counts&rdquo;. Change only the ones you feel strongly about.
        </p>
        <ul className="mt-6">
          {data.questions
            .filter((qq) => answers[qq.issueSlug] !== undefined)
            .map((qq) => (
              <li key={qq.id} className="record">
                <p className="max-w-measure text-base">{qq.prompt}</p>
                {/* Three tap targets, no slider: WCAG 2.2 SC 2.5.7 forbids drag-only controls. */}
                <div className="mt-3 flex gap-2" role="group" aria-label={qq.issueName}>
                  {WEIGHTS.map((w) => (
                    <button
                      key={w.w}
                      aria-pressed={(weights[qq.issueSlug] ?? 2) === w.w}
                      onClick={() => setWeights((x) => ({ ...x, [qq.issueSlug]: w.w }))}
                      className="btn flex-1 !px-2 !text-[14px]"
                    >
                      {w.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
        </ul>
        <button className="btn btn-primary mt-8 w-full" onClick={() => setPhase("results")}>
          See results
        </button>
      </section>
    );
  }

  // ---- results ----
  const userAnswers: UserAnswer[] = Object.entries(answers).map(([issueSlug, value]) => ({
    issueSlug,
    value,
    weight: (weights[issueSlug] ?? 2) as Weight,
  }));

  const results = matchCandidates(
    userAnswers,
    data.positions.map((p) => ({
      candidateId: p.candidateSlug,
      issueSlug: p.issueSlug,
      stance: p.stance,
    })),
  );

  const top = results[0]?.score ?? 0;
  const tied = results.filter((r) => r.score === top);

  return (
    <section aria-labelledby="results-h">
      <h1 id="results-h" className="font-serif text-display font-bold">
        {tied.length > 1 ? "Tied at the top" : "Closest to your answers"}
      </h1>
      <p className="mt-3 max-w-measure text-base">
        {tied.map((t) => nameOf.get(t.candidateId)).join(", ")}
        {tied.length > 1 ? " are tied." : ""} Agreement is only counted on issues where a candidate
        has a published position.
      </p>

      <ul className="mt-8">
        {results.map((r) => {
          const cand = data.candidates.find((c) => c.slug === r.candidateId);
          const lowCoverage = r.coverage < 0.5;
          return (
            <li key={r.candidateId} className="record">
              <details>
                <summary className="flex min-h-[44px] items-center justify-between gap-4">
                  <span className="text-summary font-semibold">{cand?.fullName}</span>
                  <span className="mono !text-ink">{r.score}%</span>
                </summary>

                <p className="mono mt-2 !normal-case !tracking-normal">
                  {r.score}% agreement on {r.scoredIssues} of the {answered} issues you answered
                  {cand?.office ? ` · ${cand.office}` : ""}
                </p>
                {lowCoverage ? (
                  <p className="mt-2 max-w-measure text-base text-ink">
                    Low coverage — this number rests on {r.scoredIssues} of your {answered} answers.
                  </p>
                ) : null}

                <ul className="mt-4 space-y-4">
                  {r.agreements
                    .slice()
                    .sort((a, b) => b.agreement - a.agreement)
                    .map((a) => {
                      const theirs = data.positions.find(
                        (p) => p.candidateSlug === r.candidateId && p.issueSlug === a.issueSlug,
                      );
                      const mine = answers[a.issueSlug];
                      const q2 = data.questions.find((x) => x.issueSlug === a.issueSlug);
                      if (!theirs || mine === undefined) return null;
                      return (
                        <li key={a.issueSlug}>
                          <p className="mono">
                            {q2?.issueName} ·{" "}
                            {a.agreement === 1
                              ? "Agreed"
                              : a.agreement >= 0.5
                                ? "Partly agreed"
                                : "Disagreed"}
                          </p>
                          <div className="mt-2 space-y-1">
                            <div className="flex items-center gap-3">
                              <span className="mono w-12 shrink-0">You</span>
                              <StanceRule
                                stance={stanceFromValue(mine)}
                                label="your answer"
                                size="sm"
                              />
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="mono w-12 shrink-0">Them</span>
                              <StanceLine
                                stance={theirs.stance}
                                label={`${cand?.fullName} on ${q2?.issueName}`}
                                size="sm"
                              />
                            </div>
                          </div>
                          <Link
                            href={`/e/${data.election.slug}/i/${a.issueSlug}`}
                            className="mono mt-2 inline-flex min-h-[44px] items-center underline decoration-rule-strong underline-offset-4"
                          >
                            See the quote →
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>

      <p className="mono mt-8 !normal-case !tracking-normal">
        Ranked by agreement. Ties are shown as ties. This is not a voting recommendation, and your
        answers were never sent anywhere — this ranking was computed on your device.
      </p>
    </section>
  );
}

function stanceOf(s: Stance): Value {
  return { STRONG_OPPOSE: -2, OPPOSE: -1, MIXED: 0, SUPPORT: 1, STRONG_SUPPORT: 2 }[
    s as "STRONG_OPPOSE"
  ] as Value;
}
