import { prisma, JurisdictionLevel } from "./index.js";

const ALL = Object.values(JurisdictionLevel);
const LOCAL = [JurisdictionLevel.CITY, JurisdictionLevel.COUNTY, JurisdictionLevel.SCHOOL_DISTRICT];
const STATE_UP = [JurisdictionLevel.STATE, JurisdictionLevel.FEDERAL];

/**
 * Fixed issue taxonomy. Edit here, not in the admin UI, and add a line to
 * docs/TAXONOMY_CHANGELOG.md for every add, rename, removal, or level-mask change.
 *
 * A description is shown to a first-time voter above the list of candidate stances for
 * that issue. It names the decisions in scope and asserts nothing about which answer is
 * right. Each one below was audited by a reader on the left and a reader on the right,
 * both hunting for framing that concedes the other side's premise. Read
 * docs/EDITORIAL_POLICY.md before editing one.
 */
const ISSUES: Array<{
  slug: string;
  name: string;
  levels: readonly JurisdictionLevel[];
  description: string;
}> = [
  {
    slug: "economy-jobs",
    name: "Economy & Jobs",
    levels: ALL,
    description:
      "Work and pay decisions sit in different offices: whether tax reductions or grants go to " +
      "particular companies; whether business rules and licenses are added, changed, or " +
      "dropped, and how they are enforced; how much public money goes to job training; what " +
      "public employees, including teachers, are paid and how that pay is negotiated; and " +
      "whether a minimum wage is set and how high it is.",
  },
  {
    slug: "housing-cost-of-living",
    name: "Housing & Cost of Living",
    levels: ALL,
    description:
      "Different offices control different pieces of housing cost: whether the rules allow more " +
      "homes or fewer; how much public money goes to subsidized or lower-priced homes and to " +
      "homeless shelters; whether housing conditions are inspected; property tax rates and the " +
      "exemptions that lower them; utility and trash rates; and any limits on rent increases or " +
      "evictions.",
  },
  {
    slug: "taxes-budget",
    name: "Taxes & Budget",
    levels: ALL,
    description:
      "Every office decides how much money it takes in and where it goes: whether tax rates and " +
      "the total amount collected rise, fall, or hold steady; who pays and who is exempt; " +
      "whether to borrow for big projects, including bonds put to voters; how much to hold in " +
      "reserve; and which services get more money and which get less.",
  },
  {
    slug: "education-k12",
    name: "K-12 Education",
    levels: [...LOCAL, JurisdictionLevel.STATE],
    description:
      "Several offices share control of public schools: how much money schools get and from " +
      "which taxes; what is taught and what is not; who decides which books libraries carry; " +
      "how teachers are hired and paid; how public money is split among districts, charter " +
      "schools, and private-school tuition; how schools are rated and when the state takes " +
      "over; and how discipline and safety are handled.",
  },
  {
    slug: "higher-ed-student-debt",
    name: "Higher Ed & Student Debt",
    levels: STATE_UP,
    description:
      "This covers college and job training after high school, and who pays for it: tuition at " +
      "public colleges; how much public money they get; who qualifies for grants and " +
      "scholarships; how much students may borrow and on what terms; what happens when a " +
      "borrower cannot repay; whether existing balances are canceled; and what rules apply to " +
      "colleges themselves.",
  },
  {
    slug: "healthcare",
    name: "Healthcare",
    levels: STATE_UP,
    description:
      "These are decisions about health coverage and what care costs: who qualifies for " +
      "government programs like Medicaid; rules for coverage people get through a job or buy " +
      "themselves; what plans must cover; what happens to people with no coverage or unpaid " +
      "medical bills; limits on drug and hospital prices; funding for public hospitals and " +
      "clinics; and whether coverage runs through government or private insurers.",
  },
  {
    slug: "reproductive-rights",
    name: "Reproductive Rights",
    levels: STATE_UP,
    description:
      "This is about abortion, contraception, and fertility treatment, which are separate " +
      "questions: whether and under what conditions abortion is legal; at what point in " +
      "pregnancy the rules change; whether the law gives legal status before birth; whether " +
      "penalties apply and to whom; how emergencies and travel across state lines are handled; " +
      "what public money may pay for; what role parents have for minors; and rules for IVF.",
  },
  {
    slug: "public-safety-policing",
    name: "Public Safety & Policing",
    levels: ALL,
    description:
      "These are decisions about what police do, how they are paid for, and what rules they " +
      "follow: how many officers are hired and at what pay; whether officers are assigned to " +
      "schools or public transportation; what equipment and surveillance tools are bought; the " +
      "rules for stops, searches, and use of force; who decides complaints against officers and " +
      "what discipline follows; and which calls other responders handle.",
  },
  {
    slug: "criminal-justice",
    name: "Criminal Justice",
    levels: ALL,
    description:
      "This is about what happens once someone is accused of a crime: which charges are filed; " +
      "whether a person is held or released before trial; fines and court fees; sentence length " +
      "and early release; what victims are owed; jail conditions; whether a case goes to " +
      "treatment; whether old records are cleared; whether schools refer misconduct to police; " +
      "and whether jails hold people for immigration agents.",
  },
  {
    slug: "guns",
    name: "Gun Policy",
    levels: STATE_UP,
    description:
      "These are the rules for buying, selling, owning, and carrying guns: what checks happen " +
      "before a sale and how they are enforced; whether a permit or training is required to " +
      "carry; which guns may be sold and how many rounds they hold; where guns may be carried " +
      "and by whom; how they must be stored; and when a court may take them away and on what " +
      "proof.",
  },
  {
    slug: "immigration",
    name: "Immigration",
    levels: STATE_UP,
    description:
      "This covers who may enter the country, who may stay, and how the rules are enforced: how " +
      "many people are admitted and on what basis; what happens to people living here without " +
      "legal status, including removal, work permits, or a path to legal status and " +
      "citizenship; how they are held while cases are decided; what enforcement and public " +
      "services cost; and whether local police assist federal agents.",
  },
  {
    slug: "climate-energy",
    name: "Climate & Energy",
    levels: ALL,
    description:
      "These are decisions about electricity and fuel: which power sources a utility buys; what " +
      "customers pay and what happens when a bill goes unpaid; how the grid is kept running in " +
      "a freeze or heat wave; where pipelines and power lines may be built, and whether " +
      "landowners must sell; what permits, building codes, and emissions rules apply; and " +
      "whether to fund flood and cooling projects.",
  },
  {
    slug: "environment-water",
    name: "Environment & Water",
    levels: ALL,
    description:
      "This covers water, land, and waste: where drinking water comes from; what it must be " +
      "tested for; what households and businesses pay for water and sewer; whether watering is " +
      "limited in a drought; how sewage and trash are handled; what a factory or landfill must " +
      "do to get a permit; whether building is allowed in a floodplain; and how replacing lead " +
      "pipes gets paid for.",
  },
  {
    slug: "transportation-infrastructure",
    name: "Transportation & Infrastructure",
    levels: ALL,
    description:
      "Each office controls part of how people and things move: how money is split among roads, " +
      "buses and trains, sidewalks, and bike lanes, and whether each gets more or less; repairs " +
      "or new construction; street design and speed limits; what riders pay in fares and " +
      "drivers pay in tolls and parking; school bus service; and whether projects are paid for " +
      "with debt or taxes.",
  },
  {
    slug: "voting-elections",
    name: "Voting & Elections",
    levels: ALL,
    description:
      "These are the rules for voting: who is eligible; how people get on and off the voter " +
      "list; how identity is confirmed at the polls; when and where polling places are open; " +
      "who may vote by mail and how ballots are returned and checked; how results are audited " +
      "and recounted; when local elections are held; how district lines are drawn; and what " +
      "campaigns and outside groups report.",
  },
  {
    slug: "lgbtq-rights",
    name: "LGBTQ+ Rights",
    levels: ALL,
    description:
      "This covers sexual orientation and gender identity: whether discrimination laws include " +
      "those characteristics in jobs, housing, and public services; when a religious objection " +
      "is an exception; which gender-related medical treatments are legal, at what age, and who " +
      "pays; which sports teams and restrooms students use; what schools teach and which books " +
      "they buy or restrict; what schools must tell parents; and how names and sex appear on " +
      "records.",
  },
  {
    slug: "civil-rights",
    name: "Civil Rights & Equality",
    levels: ALL,
    description:
      "This is about the laws against discrimination and how far they reach: which " +
      "characteristics are covered — race, sex, national origin, religion, disability, age — " +
      "and in what settings; how complaints are decided and what penalties apply; when " +
      "religious objections are exempt; whether governments and schools may consider race or " +
      "sex in hiring, contracting, or admissions; and what buildings and services must do for " +
      "people with disabilities.",
  },
  {
    slug: "tech-privacy-ai",
    name: "Technology, Privacy & AI",
    levels: STATE_UP,
    description:
      "This covers data and software: what companies may collect about a person and sell; " +
      "whether people can see or delete it; whether sites must verify a user's age; what " +
      "platforms must or may not remove; what police may use, including cameras, face " +
      "recognition, and data bought from brokers; what testing applies to AI used in hiring, " +
      "lending, or policing; and who answers if it causes harm.",
  },
  {
    slug: "foreign-policy-defense",
    name: "Foreign Policy & Defense",
    levels: [JurisdictionLevel.FEDERAL],
    description:
      "This is about how the United States deals with other countries: how much to spend on the " +
      "military and on what; when to send troops and who approves it; which alliances and " +
      "treaties to join or leave; whether to sell weapons or send aid to a given government and " +
      "under what conditions; when to use sanctions and tariffs; and who may enter as a refugee " +
      "or asylum seeker.",
  },
  {
    slug: "local-development-zoning",
    name: "Development & Zoning",
    levels: LOCAL,
    description:
      "Local offices decide what gets built where: which kinds of homes are allowed on a lot " +
      "and how tall buildings can be, and whether those rules tighten or loosen, area-wide or " +
      "one project at a time; whether parking requirements rise, fall, or end; where factories " +
      "and warehouses sit near homes; what an owner may build without approval; and where a " +
      "school district builds, closes, or sells campuses.",
  },
];

async function main() {
  for (const [i, issue] of ISSUES.entries()) {
    const data = {
      name: issue.name,
      levels: [...issue.levels],
      sortOrder: i,
      description: issue.description,
    };
    await prisma.issue.upsert({
      where: { slug: issue.slug },
      update: data,
      create: { slug: issue.slug, ...data },
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
