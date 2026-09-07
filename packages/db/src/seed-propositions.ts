/**
 * Load the propositions — the actual question each stance answers.
 *
 * Versioned, never edited in place. If a proposition's wording changes, this mints
 * version n+1, marks the old one retired, and leaves existing positions attached to
 * the wording they were judged against. A stance recorded against "allow apartments
 * in single-family neighborhoods" does not automatically mean the same thing under a
 * reworded question, and quietly carrying it over would put words in a candidate's
 * mouth.
 *
 * Source of truth is propositions.json, written by a drafting pass in which each
 * sentence was attacked by a progressive reviewer, a conservative reviewer and a
 * plain-language reader before it was accepted.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./index.js";

interface PropositionInput {
  slug: string;
  proposition: string;
  yesMeans: string;
  noMeans: string;
  scope: string;
}

export async function seedPropositions() {
  const here = dirname(fileURLToPath(import.meta.url));
  const input = JSON.parse(
    readFileSync(join(here, "propositions.json"), "utf8"),
  ) as PropositionInput[];

  // Two issues sharing a proposition means one of them has no question of its own,
  // and every candidate would be scored twice on the same thing.
  const texts = new Set(input.map((p) => p.proposition.trim().toLowerCase()));
  if (texts.size !== input.length) {
    throw new Error("two issues share a proposition; each issue needs its own question");
  }

  let created = 0;
  let unchanged = 0;
  let superseded = 0;

  for (const p of input) {
    const issue = await prisma.issue.findUnique({ where: { slug: p.slug } });
    if (!issue) throw new Error(`no issue "${p.slug}" — a proposition cannot invent one`);

    const current = await prisma.proposition.findFirst({
      where: { issueId: issue.id, isCurrent: true },
    });

    if (current && current.text === p.proposition && current.yesMeans === p.yesMeans && current.noMeans === p.noMeans) {
      unchanged++;
      continue;
    }

    if (current) {
      // Retire, never overwrite. The positions judged against the old wording keep
      // pointing at it, and they are not migrated to the new one.
      await prisma.proposition.update({
        where: { id: current.id },
        data: { isCurrent: false, retiredAt: new Date() },
      });
      superseded++;
    }

    await prisma.proposition.create({
      data: {
        issueId: issue.id,
        version: (current?.version ?? 0) + 1,
        text: p.proposition,
        yesMeans: p.yesMeans,
        noMeans: p.noMeans,
        scope: p.scope,
      },
    });
    created++;
  }

  return { created, unchanged, superseded, total: input.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedPropositions()
    .then((r) =>
      console.log(
        `${r.total} propositions: ${r.created} new, ${r.unchanged} unchanged, ${r.superseded} superseded`,
      ),
    )
    .finally(() => prisma.$disconnect());
}
