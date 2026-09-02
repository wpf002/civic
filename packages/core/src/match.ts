import { STANCE_VALUE, isScorable, type Stance } from "./stance.js";

export interface UserAnswer {
  issueSlug: string;
  value: -2 | -1 | 0 | 1 | 2; // same scale as STANCE_VALUE
  weight: 1 | 2 | 3;          // how much the user cares
}

export interface CandidatePositionInput {
  candidateId: string;
  issueSlug: string;
  stance: Stance;
}

export interface MatchResult {
  candidateId: string;
  score: number;      // 0..100, agreement over issues the candidate has a published stance on
  coverage: number;   // 0..1, share of the user's answered issues the candidate has a stance on
  scoredIssues: number;
  agreements: Array<{ issueSlug: string; agreement: number }>; // per-issue 0..1
}

const MAX_DISTANCE = 4; // |2 - (-2)|

/**
 * Deterministic. No model calls. Same inputs, same output.
 * Score only counts issues where the candidate has a scorable stance.
 * Coverage is reported separately so a candidate with one matching position
 * never outranks one with twelve on a technicality.
 */
export function matchCandidates(
  answers: UserAnswer[],
  positions: CandidatePositionInput[],
): MatchResult[] {
  const byCandidate = new Map<string, Map<string, Stance>>();
  for (const p of positions) {
    if (!byCandidate.has(p.candidateId)) byCandidate.set(p.candidateId, new Map());
    byCandidate.get(p.candidateId)!.set(p.issueSlug, p.stance);
  }

  const results: MatchResult[] = [];
  for (const [candidateId, stances] of byCandidate) {
    let weighted = 0;
    let weightTotal = 0;
    const agreements: MatchResult["agreements"] = [];
    for (const a of answers) {
      const s = stances.get(a.issueSlug);
      if (!s || !isScorable(s)) continue;
      const agreement = 1 - Math.abs(a.value - STANCE_VALUE[s]) / MAX_DISTANCE;
      agreements.push({ issueSlug: a.issueSlug, agreement });
      weighted += agreement * a.weight;
      weightTotal += a.weight;
    }
    results.push({
      candidateId,
      score: weightTotal === 0 ? 0 : Math.round((weighted / weightTotal) * 100),
      coverage: answers.length === 0 ? 0 : agreements.length / answers.length,
      scoredIssues: agreements.length,
      agreements,
    });
  }
  // Sort by score, then coverage, then id for stability.
  return results.sort(
    (a, b) => b.score - a.score || b.coverage - a.coverage || a.candidateId.localeCompare(b.candidateId),
  );
}
