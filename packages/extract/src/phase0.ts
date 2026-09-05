/**
 * The Phase 0 fidelity harness.
 *
 * Runs the real extractor against the archived candidate pages in `docs/phase0/`
 * and scores it against one or more independently produced label sets.
 *
 * Three of the numbers it reports mean different things and should not be read as
 * one score:
 *
 *   quote validity   — fully mechanical. A quote either is a span of the archived
 *                      document or it is not. No judgment involved, no label set
 *                      needed, and this is the number the product's core promise
 *                      rests on.
 *   absence accuracy — mostly mechanical. Whether a page discusses an issue at all
 *                      is far less contestable than how strongly it comes down.
 *   stance agreement — judgment. It is only as good as the labels it is scored
 *                      against, and it inherits every bias in how those were made.
 *
 * Scoring against labels that a model wrote measures whether two independently
 * prompted readers converge. That is worth knowing and it is NOT the same as being
 * right. Where the label sets disagree with each other, neither is ground truth and
 * the row is reported as contested rather than scored.
 *
 * Writes nothing to the database.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "@civic/db";
import { MODEL_A, MODEL_B } from "./llm.js";
import { extractOnce, reconcile } from "./pipeline.js";

export const ABSENT = "NO_STATED_POSITION";

/**
 * Resolve a path against the repository root, not the current directory.
 *
 * pnpm runs a package script from that package's directory, so "docs/phase0" means
 * something different depending on where the command was typed. The archive has one
 * location; make the path mean one thing.
 */
export function fromRepoRoot(p: string): string {
  if (isAbsolute(p)) return p;
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) return resolve(p);
    dir = up;
  }
  return join(dir, p);
}

/** One reader's opinion of one candidate × issue. */
export interface Label {
  stance: string;
  quote?: string;
  /** The labeler's own hedge, when it recorded one. */
  confidence?: string;
}

/** slug → issueSlug → Label */
export type LabelSet = Map<string, Map<string, Label>>;

export interface ArchivedDoc {
  slug: string;
  candidate: string;
  url: string;
  text: string;
  chars: number;
}

/**
 * Load the archive and verify every hash.
 *
 * A fidelity test run against a document that changed since it was labeled is not
 * a fidelity test, so a mismatch is fatal rather than a warning.
 */
export function loadArchive(dir: string, slugs: string[]): ArchivedDoc[] {
  const root = fromRepoRoot(dir);
  const manifest = JSON.parse(readFileSync(join(root, "archive-manifest.json"), "utf8")) as Array<{
    slug: string;
    candidate: string;
    url: string;
    contentHash: string;
    chars: number;
  }>;

  return slugs.map((slug) => {
    const entry = manifest.find((m) => m.slug === slug);
    if (!entry) throw new Error(`${slug} is not in archive-manifest.json`);
    const text = readFileSync(join(root, `${slug}.txt`), "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    if (hash !== entry.contentHash) {
      throw new Error(
        `${slug}.txt no longer matches its recorded hash. The labels were written against ` +
          `a different document, so scoring against them would be meaningless.`,
      );
    }
    return { slug, candidate: entry.candidate, url: entry.url, text, chars: entry.chars };
  });
}

/** Read the worksheet's label file, which keys candidates by display name. */
export function loadProposedLabels(path: string, docs: ArchivedDoc[]): LabelSet {
  const raw = JSON.parse(readFileSync(fromRepoRoot(path), "utf8")) as Array<{
    candidate: string;
    labels: Array<{ issueSlug: string; stance: string; quote?: string; confidenceInLabel?: string }>;
  }>;
  const byName = new Map(docs.map((d) => [d.candidate, d.slug]));
  const out: LabelSet = new Map();
  for (const r of raw) {
    const slug = byName.get(r.candidate);
    if (!slug) continue;
    out.set(
      slug,
      new Map(
        r.labels.map((l) => [
          l.issueSlug,
          { stance: l.stance, ...(l.quote ? { quote: l.quote } : {}), ...(l.confidenceInLabel ? { confidence: l.confidenceInLabel } : {}) },
        ]),
      ),
    );
  }
  return out;
}

/** Read a label file already keyed by slug: [{candidate, labels:[...]}] */
export function loadLabelsBySlug(
  rows: Array<{ candidate: string; labels: Array<{ issueSlug: string; stance: string; quote?: string }> | null }>,
): LabelSet {
  const out: LabelSet = new Map();
  for (const r of rows) {
    if (!r.labels) continue;
    out.set(r.candidate, new Map(r.labels.map((l) => [l.issueSlug, { stance: l.stance, ...(l.quote ? { quote: l.quote } : {}) }])));
  }
  return out;
}

/** SUPPORT and STRONG_SUPPORT collapse to one direction. The strength boundary is the noisy part. */
export function direction(stance: string): string {
  if (stance === "STRONG_SUPPORT" || stance === "SUPPORT") return "SUPPORT";
  if (stance === "STRONG_OPPOSE" || stance === "OPPOSE") return "OPPOSE";
  return stance;
}

export interface Cell {
  slug: string;
  issueSlug: string;
  /** What each model said on its own. Absent from a model's output means silence. */
  a: string;
  b: string;
  /** What the two-model pipeline produced: a stance, or FLAGGED when they disagreed. */
  pipeline: string;
  quoteOk: boolean | null;
}

export interface ExtractionRun {
  cells: Cell[];
  costCents: number;
  /** Positions a model returned that were thrown out before anything was stored. */
  rejected: Array<{ slug: string; issueSlug: string; reason: string; quote: string }>;
  quotesOffered: number;
}

/** Run both models over every archived document. No database writes. */
export async function runExtractors(
  docs: ArchivedDoc[],
  issueSlugs: string[],
  modelA = MODEL_A,
  modelB = MODEL_B,
): Promise<ExtractionRun> {
  const cells: Cell[] = [];
  const rejected: ExtractionRun["rejected"] = [];
  let costCents = 0;
  let quotesOffered = 0;

  for (const doc of docs) {
    const input = { sourceText: doc.text, issueSlugs };
    const [a, b] = await Promise.all([
      extractOnce(input, modelA),
      extractOnce(input, modelB),
    ]);
    costCents += a.costCents + b.costCents;

    for (const [outcome] of [[a], [b]] as const) {
      quotesOffered += outcome.positions.filter((p) => p.stance !== ABSENT).length + outcome.rejected.length;
      for (const r of outcome.rejected) {
        rejected.push({
          slug: doc.slug,
          issueSlug: r.position.issueSlug,
          reason: r.reason,
          quote: r.position.quote ?? "",
        });
      }
    }

    const { agreed, flagged } = reconcile(a, b);
    const agreedBy = new Map(agreed.map((p) => [p.issueSlug, p]));
    const flaggedBy = new Set(flagged.map((f) => f.issueSlug));
    const aBy = new Map(a.positions.map((p) => [p.issueSlug, p]));
    const bBy = new Map(b.positions.map((p) => [p.issueSlug, p]));

    for (const issueSlug of issueSlugs) {
      // A model that returns nothing for an issue is saying the document is silent on it.
      const av = aBy.get(issueSlug)?.stance ?? ABSENT;
      const bv = bBy.get(issueSlug)?.stance ?? ABSENT;
      const hit = agreedBy.get(issueSlug);
      cells.push({
        slug: doc.slug,
        issueSlug,
        a: av,
        b: bv,
        pipeline: hit ? hit.stance : flaggedBy.has(issueSlug) ? "FLAGGED" : ABSENT,
        quoteOk: hit && hit.stance !== ABSENT ? true : null,
      });
    }
  }

  return { cells, costCents, rejected, quotesOffered };
}

export async function cityIssueSlugs(): Promise<string[]> {
  const issues = await prisma.issue.findMany({ orderBy: { sortOrder: "asc" } });
  return issues.filter((i) => (i.levels as string[]).includes("CITY")).map((i) => i.slug);
}

// ---------------------------------------------------------------- scoring

export interface Scored {
  slug: string;
  issueSlug: string;
  /** The stance every label set agreed on, or null when they did not agree. */
  consensus: string | null;
  labels: Record<string, string>;
  a: string;
  b: string;
  pipeline: string;
  exact: boolean | null;
  sameDirection: boolean | null;
}

export interface Report {
  rows: Scored[];
  scoredRows: number;
  contestedRows: number;
  exactAgreement: number;
  directionAgreement: number;
  modelAgreement: Record<string, number>;
  /** Of rows the readers agreed were silent, how often the pipeline agreed. */
  absenceAccuracy: number;
  absenceRows: number;
  /** Of rows the readers agreed carried a real stance, how often the pipeline said silence. */
  falseAbsence: number;
  statedRows: number;
  /**
   * Of rows the readers agreed were silent, how often the pipeline asserted a stance.
   *
   * The worst error this product can make. A missed position is a gap a voter can see;
   * an invented one is a claim about a candidate that the document does not support.
   */
  falsePresence: number;
  /** Rows the pipeline answered wrongly, as opposed to declining to answer. */
  wrongAnswers: number;
  /** Rows where the two models disagreed, so the pipeline produced no answer at all. */
  flaggedRows: number;
  /** Share of rows on which every label set gave the same stance. */
  unanimityRate: number;
}

export function score(cells: Cell[], labelSets: Map<string, LabelSet>): Report {
  const names = [...labelSets.keys()];
  const rows: Scored[] = [];

  for (const cell of cells) {
    const labels: Record<string, string> = {};
    for (const [name, set] of labelSets) {
      const l = set.get(cell.slug)?.get(cell.issueSlug);
      if (l) labels[name] = l.stance;
    }
    const values = Object.values(labels);
    const consensus =
      values.length === names.length && new Set(values).size === 1 ? values[0]! : null;

    rows.push({
      slug: cell.slug,
      issueSlug: cell.issueSlug,
      consensus,
      labels,
      a: cell.a,
      b: cell.b,
      pipeline: cell.pipeline,
      exact: consensus === null ? null : cell.pipeline === consensus,
      sameDirection:
        consensus === null
          ? null
          : cell.pipeline !== "FLAGGED" && direction(cell.pipeline) === direction(consensus),
    });
  }

  const scored = rows.filter((r) => r.consensus !== null);
  const pct = (n: number, d: number) => (d === 0 ? 0 : (100 * n) / d);

  const absence = scored.filter((r) => r.consensus === ABSENT);
  const stated = scored.filter((r) => r.consensus !== ABSENT);

  const modelAgreement: Record<string, number> = {
    [MODEL_A]: pct(scored.filter((r) => r.a === r.consensus).length, scored.length),
    [MODEL_B]: pct(scored.filter((r) => r.b === r.consensus).length, scored.length),
  };

  // How often the readers all landed on the same stance. This is the ceiling: the
  // extractor cannot be scored more precisely than the readers agree with each other.
  const unanimityRate = pct(scored.length, rows.length);

  return {
    rows,
    scoredRows: scored.length,
    contestedRows: rows.length - scored.length,
    exactAgreement: pct(scored.filter((r) => r.exact).length, scored.length),
    directionAgreement: pct(scored.filter((r) => r.sameDirection).length, scored.length),
    modelAgreement,
    absenceAccuracy: pct(absence.filter((r) => r.pipeline === ABSENT).length, absence.length),
    absenceRows: absence.length,
    falseAbsence: pct(stated.filter((r) => r.pipeline === ABSENT).length, stated.length),
    statedRows: stated.length,
    falsePresence: pct(
      absence.filter((r) => r.pipeline !== ABSENT && r.pipeline !== "FLAGGED").length,
      absence.length,
    ),
    wrongAnswers: scored.filter((r) => !r.exact && r.pipeline !== "FLAGGED").length,
    flaggedRows: rows.filter((r) => r.pipeline === "FLAGGED").length,
    unanimityRate,
  };
}
