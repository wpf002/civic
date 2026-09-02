import { prisma, JurisdictionLevel } from "./index.js";

const ALL = Object.values(JurisdictionLevel);
const LOCAL = [JurisdictionLevel.CITY, JurisdictionLevel.COUNTY, JurisdictionLevel.SCHOOL_DISTRICT];
const STATE_UP = [JurisdictionLevel.STATE, JurisdictionLevel.FEDERAL];

// Fixed issue taxonomy. Edit here, not in the admin UI.
const ISSUES = [
  ["economy-jobs", "Economy & Jobs", ALL],
  ["housing-cost-of-living", "Housing & Cost of Living", ALL],
  ["taxes-budget", "Taxes & Budget", ALL],
  ["education-k12", "K-12 Education", [...LOCAL, JurisdictionLevel.STATE]],
  ["higher-ed-student-debt", "Higher Ed & Student Debt", STATE_UP],
  ["healthcare", "Healthcare", STATE_UP],
  ["reproductive-rights", "Reproductive Rights", STATE_UP],
  ["public-safety-policing", "Public Safety & Policing", ALL],
  ["criminal-justice", "Criminal Justice", ALL],
  ["guns", "Gun Policy", STATE_UP],
  ["immigration", "Immigration", STATE_UP],
  ["climate-energy", "Climate & Energy", ALL],
  ["environment-water", "Environment & Water", ALL],
  ["transportation-infrastructure", "Transportation & Infrastructure", ALL],
  ["voting-elections", "Voting & Elections", ALL],
  ["lgbtq-rights", "LGBTQ+ Rights", ALL],
  ["civil-rights", "Civil Rights & Equality", ALL],
  ["tech-privacy-ai", "Technology, Privacy & AI", STATE_UP],
  ["foreign-policy-defense", "Foreign Policy & Defense", [JurisdictionLevel.FEDERAL]],
  ["local-development-zoning", "Development & Zoning", LOCAL],
] as const;

async function main() {
  for (const [i, [slug, name, levels]] of ISSUES.entries()) {
    await prisma.issue.upsert({
      where: { slug },
      update: { name, levels: [...levels], sortOrder: i },
      create: { slug, name, levels: [...levels], sortOrder: i, description: "" },
    });
  }
  for (const [name, abbreviation] of [
    ["Democratic", "D"], ["Republican", "R"], ["Libertarian", "L"], ["Green", "G"], ["Independent", "I"], ["Nonpartisan", "NP"],
  ] as const) {
    await prisma.party.upsert({ where: { abbreviation }, update: {}, create: { name, abbreviation } });
  }
  console.log(`seeded ${ISSUES.length} issues`);
}

main().finally(() => prisma.$disconnect());
