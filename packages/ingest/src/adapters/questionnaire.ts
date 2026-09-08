/**
 * Questionnaire answers, entered by hand.
 *
 * WHY THIS IS A CSV AND NOT AN API. Vote411 (League of Women Voters) has no public
 * API — its ballot tool is a client-side app with obfuscated keys — and Vote Smart's
 * documented endpoints now return 404. Both were checked. Scraping Vote411 would also
 * be taking the League's own editorial work, which is not something to do quietly.
 *
 * So the path that actually works is the one CLAUDE.md already blesses for local
 * races: a CSV a person fills in, from a source they lawfully obtained — a
 * partnership feed, a newspaper questionnaire, a candidate's emailed reply, a forum
 * they attended.
 *
 * WHY THIS FITS WITHOUT A NEW MODEL. A questionnaire answer is already the shape this
 * product wants: a candidate answering one fixed question. It needs no extraction and
 * no verification, because there is nothing to infer — the candidate answered. What
 * it does need is the same evidence rule as everything else, so the CSV carries the
 * answer's verbatim text and the URL it can be read at, and a row without both is
 * refused rather than stored as an unsourced claim.
 */
import { parseCsv } from "./nc-sbe.js";

export const STANCES = [
  "STRONG_SUPPORT",
  "SUPPORT",
  "MIXED",
  "OPPOSE",
  "STRONG_OPPOSE",
  "NO_STATED_POSITION",
  "DECLINED_TO_STATE",
] as const;
export type Stance = (typeof STANCES)[number];

export interface QuestionnaireAnswer {
  candidateSlug: string;
  issueSlug: string;
  stance: Stance;
  /** The candidate's own words. Stored as evidence, checked against sourceText. */
  quote: string;
  /** Where a reader can see it. */
  sourceUrl: string;
  sourceTitle: string;
  publisher: string;
  answeredAt: string | null;
}

export interface ParseResult {
  answers: QuestionnaireAnswer[];
  /** Rows that could not be trusted, with the reason. Never silently dropped. */
  rejected: Array<{ row: number; why: string }>;
}

const REQUIRED = ["candidate_slug", "issue_slug", "stance", "quote", "source_url"];

/**
 * Read a questionnaire CSV.
 *
 * Strict on purpose. This is the one ingest path with no model between the file and a
 * published claim about a person, so every rule the extractor is held to is enforced
 * here instead — an unsourced answer, an unknown stance, or an absence carrying a
 * quote it cannot have are all refused.
 */
export function parseQuestionnaire(text: string): ParseResult {
  const rows = parseCsv(text);
  const answers: QuestionnaireAnswer[] = [];
  const rejected: ParseResult["rejected"] = [];

  if (rows.length === 0) return { answers, rejected: [{ row: 0, why: "file has no rows" }] };
  const missing = REQUIRED.filter((c) => !(c in rows[0]!));
  if (missing.length) {
    return { answers, rejected: [{ row: 0, why: `missing columns: ${missing.join(", ")}` }] };
  }

  rows.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const stance = (r.stance ?? "").trim().toUpperCase() as Stance;
    const quote = (r.quote ?? "").trim();
    const sourceUrl = (r.source_url ?? "").trim();
    const candidateSlug = (r.candidate_slug ?? "").trim();
    const issueSlug = (r.issue_slug ?? "").trim();

    if (!candidateSlug || !issueSlug) {
      rejected.push({ row: line, why: "candidate_slug and issue_slug are both required" });
      return;
    }
    if (!(STANCES as readonly string[]).includes(stance)) {
      rejected.push({ row: line, why: `"${r.stance}" is not a stance` });
      return;
    }

    const isAbsence = stance === "NO_STATED_POSITION" || stance === "DECLINED_TO_STATE";

    // An answer with no quote is an assertion about a person with nothing behind it.
    if (!isAbsence && !quote) {
      rejected.push({ row: line, why: "a stance needs the candidate's own words in `quote`" });
      return;
    }
    // An absence with a quote is a contradiction: the quote is the candidate saying
    // something, which is not what "no stated position" means.
    if (isAbsence && quote) {
      rejected.push({ row: line, why: `${stance} cannot carry a quote` });
      return;
    }
    if (!sourceUrl) {
      rejected.push({ row: line, why: "source_url is required — a reader must be able to check it" });
      return;
    }
    try {
      new URL(sourceUrl);
    } catch {
      rejected.push({ row: line, why: `source_url "${sourceUrl}" is not a URL` });
      return;
    }

    answers.push({
      candidateSlug,
      issueSlug,
      stance,
      quote,
      sourceUrl,
      sourceTitle: (r.source_title ?? "").trim() || "Candidate questionnaire",
      publisher: (r.publisher ?? "").trim() || "unknown",
      answeredAt: (r.answered_at ?? "").trim() || null,
    });
  });

  return { answers, rejected };
}

/** The header a person filling one of these in should start from. */
export const TEMPLATE_HEADER =
  "candidate_slug,issue_slug,stance,quote,source_url,source_title,publisher,answered_at";
