/**
 * Fixture: Dallas municipal election, November 2, 2027.
 *
 * SYNTHETIC. Every candidate here is invented. The offices, districts, election date
 * and issue taxonomy are real; the people and their words are not, and no row in this
 * file may ever be promoted to production data.
 *
 * It exists so the UI can be built and judged against a grid that looks like the real
 * one will: sparse, uneven between candidates in the same race, and full of silence.
 * A fixture where everyone has a position on everything would hide the two hardest
 * design problems in the product (absence, and unequal coverage between opponents).
 *
 *   pnpm --filter @civic/db seed:fixture
 */
import { findVerbatim } from "@civic/core";
import { prisma, JurisdictionLevel, SourceKind, SourceTier, Stance } from "../index.js";

export const ELECTION_SLUG = "2027-11-dallas";

type Doc = {
  key: string;
  kind: SourceKind;
  tier: SourceTier;
  url: string;
  title: string;
  publisher?: string;
  capturedAt: string;
  text: string;
};

type Pos = {
  issue: string;
  stance: Stance;
  summary: string;
  /** Must appear in the named document, whitespace-insensitively. Verified at seed time. */
  quote?: string;
  doc?: string;
  confidence: number;
};

type Person = {
  slug: string;
  fullName: string;
  party: string;
  ballotOrder: number;
  isIncumbent?: boolean;
  websiteUrl?: string;
  docs: Doc[];
  positions: Pos[];
};

// Hard-wrapped on purpose: real archived pages are, and the verbatim gate has to survive it.
const D7_MARISELA = `Marisela Ochoa for Dallas City Council, District 7

Housing. Rent in Pleasant Grove has outrun what people here earn, and the city's own
rules are part of why. I will vote to allow duplexes, triplexes and fourplexes on every
residential lot in District 7, and I will vote to end parking minimums citywide for
buildings under fifty units.

Streets. We have been promised sidewalk repair for a decade. I will move sidewalk and
street repair in District 7 ahead of any new downtown streetscape spending, and I will
say so in the budget vote, not in a press release.

Public safety. Response times east of the river are worse than the city average and
everyone here knows it. I support hiring to the department's authorized headcount, and I
support finishing the independent response-time audit before the council votes on any
expansion beyond that number.`;

const D7_BRANDT = `Elliot Brandt — Priorities for District 7

Taxes. Dallas homeowners are being taxed out of the neighborhoods they built. I will vote
against any increase in the property tax rate, and I will vote to raise the homestead
exemption to the maximum the state allows.

Development. Neighbors, not consultants, should decide what gets built on their block. I
oppose citywide zoning changes that override neighborhood input, and I will vote against
any blanket upzoning of District 7's single-family blocks.

Public safety. I will vote to hire more officers every year I am in office. I do not
support waiting on another study to do it.`;

const D7_BRANDT_FORUM = `Pleasant Grove Candidate Forum, transcript excerpt
Moderator: ... on the sidewalk repair backlog. Mr. Brandt, thirty seconds.

BRANDT: Everybody wants sidewalks. I want sidewalks. But I am not going to stand here and
promise you a number tonight when I have not seen the department's cost figures, and I
think you have been promised numbers before by people who had not seen them either. What
I will commit to is publishing what District 7 actually gets, every year, against what it
pays in.`;

const D7_NNAMDI = `Adaeze Nnamdi for District 7 — Where I Stand

Water and flooding. Five Mile Creek floods the same blocks every spring and the city
studies it every spring. I will vote to fund the drainage work in the 2028 bond and to
begin lead service line replacement in the oldest blocks of the district first, ahead of
the state deadline rather than against it.

Climate. I support requiring city facilities and city-funded projects to meet the
building energy code the council already adopted, and I will vote against the exemptions
the council keeps granting to it.`;

const DISD5_WHEELER = `Tabitha Wheeler for Dallas ISD Trustee, District 5

Start times. Our high schoolers are getting on buses before six in the morning. I will
vote to move high school start times to 8:30 or later, and to fund the extra bus routes
that requires rather than pretending it is free.

Books and curriculum. Decisions about which books a campus library carries belong with
librarians and the principal, with a written appeal any parent can file. I will vote
against removing a title from a library on the basis of a complaint that has not gone
through that process.

Funding. I will vote against any budget that closes a campus in this district while the
district holds more than sixty days of operating reserve.`;

const DISD5_OKONKWO = `Statement of Bernard Okonkwo, candidate for DISD District 5

I am running because families in this district have been told for years that their
concerns about what is taught are somebody else's business. They are not. I support a
parent review process for library materials with a published list of every title added
each year, and I will vote to give parents a decision, not a comment period.

On the budget: I will not vote for a tax rate increase. The district has to live inside
what it already collects before it asks for more.`;

const DISD5_HALVORSEN_Q = `Dallas Free Press candidate questionnaire — District 5

Q: Should DISD move high school start times later?
HALVORSEN: I have read the sleep research and I find it persuasive. I also represent a
district where a lot of parents leave for work at six, and moving the bell without solving
childcare moves the problem onto them. I am not prepared to commit either way until the
district publishes what the bus and childcare costs actually are.

Q: Should the district close under-enrolled campuses?
HALVORSEN: No. I will vote against closing any campus in District 5 during my term.`;

const PEOPLE_D7: Person[] = [
  {
    slug: "marisela-ochoa",
    fullName: "Marisela Ochoa",
    party: "NP",
    ballotOrder: 1,
    websiteUrl: "https://mariselaochoa.example.org",
    docs: [
      {
        key: "ochoa-site",
        kind: SourceKind.CANDIDATE_WEBSITE,
        tier: SourceTier.CAMPAIGN_PLATFORM,
        url: "https://mariselaochoa.example.org/priorities",
        title: "Priorities",
        capturedAt: "2027-08-14",
        text: D7_MARISELA,
      },
    ],
    positions: [
      {
        issue: "housing-cost-of-living",
        stance: Stance.STRONG_SUPPORT,
        summary:
          "Ochoa would allow duplexes, triplexes and fourplexes on every residential lot in District 7. She would also vote to end parking minimums citywide for buildings under fifty units.",
        quote:
          "I will vote to allow duplexes, triplexes and fourplexes on every residential lot in District 7",
        doc: "ochoa-site",
        confidence: 0.96,
      },
      {
        issue: "transportation-infrastructure",
        stance: Stance.SUPPORT,
        summary:
          "Ochoa would move sidewalk and street repair in District 7 ahead of new downtown streetscape spending.",
        quote:
          "I will move sidewalk and street repair in District 7 ahead of any new downtown streetscape spending",
        doc: "ochoa-site",
        confidence: 0.93,
      },
      {
        issue: "public-safety-policing",
        stance: Stance.MIXED,
        summary:
          "Ochoa supports hiring to the police department's authorized headcount. She would wait for an independent response-time audit before voting on any expansion beyond that number.",
        quote:
          "I support hiring to the department's authorized headcount, and I support finishing the independent response-time audit before the council votes on any expansion beyond that number.",
        doc: "ochoa-site",
        confidence: 0.9,
      },
      { issue: "taxes-budget", stance: Stance.NO_STATED_POSITION, summary: "", confidence: 0.9 },
      {
        issue: "local-development-zoning",
        stance: Stance.NO_STATED_POSITION,
        summary: "",
        confidence: 0.85,
      },
      { issue: "environment-water", stance: Stance.NO_STATED_POSITION, summary: "", confidence: 0.9 },
    ],
  },
  {
    slug: "elliot-brandt",
    fullName: "Elliot Brandt",
    party: "NP",
    ballotOrder: 2,
    isIncumbent: true,
    websiteUrl: "https://elliotbrandt.example.org",
    docs: [
      {
        key: "brandt-site",
        kind: SourceKind.CANDIDATE_WEBSITE,
        tier: SourceTier.CAMPAIGN_PLATFORM,
        url: "https://elliotbrandt.example.org/priorities",
        title: "Priorities for District 7",
        capturedAt: "2027-08-14",
        text: D7_BRANDT,
      },
      {
        key: "brandt-forum",
        kind: SourceKind.DEBATE_TRANSCRIPT,
        tier: SourceTier.CANDIDATE_SPEECH,
        url: "https://dallasfreepress.example.org/forum/pleasant-grove-2027",
        title: "Pleasant Grove Candidate Forum",
        publisher: "Dallas Free Press",
        capturedAt: "2027-09-02",
        text: D7_BRANDT_FORUM,
      },
    ],
    positions: [
      {
        issue: "taxes-budget",
        stance: Stance.STRONG_OPPOSE,
        summary:
          "Brandt would vote against any increase in the property tax rate. He would vote to raise the homestead exemption to the state maximum.",
        quote:
          "I will vote against any increase in the property tax rate, and I will vote to raise the homestead exemption to the maximum the state allows.",
        doc: "brandt-site",
        confidence: 0.95,
      },
      {
        issue: "local-development-zoning",
        stance: Stance.OPPOSE,
        summary:
          "Brandt opposes citywide zoning changes that override neighborhood input, and would vote against any blanket upzoning of District 7's single-family blocks.",
        quote:
          "I oppose citywide zoning changes that override neighborhood input, and I will vote against any blanket upzoning of District 7's single-family blocks.",
        doc: "brandt-site",
        confidence: 0.94,
      },
      {
        issue: "public-safety-policing",
        stance: Stance.STRONG_SUPPORT,
        summary:
          "Brandt would vote to hire more police officers every year he is in office. He would not wait for a further study before doing so.",
        quote: "I will vote to hire more officers every year I am in office.",
        doc: "brandt-site",
        confidence: 0.95,
      },
      {
        issue: "transportation-infrastructure",
        stance: Stance.MIXED,
        summary:
          "Brandt says he will not commit to a sidewalk repair figure before seeing the department's cost numbers. He commits to publishing what District 7 receives each year against what it pays in.",
        quote:
          "I am not going to stand here and promise you a number tonight when I have not seen the department's cost figures",
        doc: "brandt-forum",
        confidence: 0.82,
      },
      {
        issue: "housing-cost-of-living",
        stance: Stance.NO_STATED_POSITION,
        summary: "",
        confidence: 0.75,
      },
      { issue: "environment-water", stance: Stance.NO_STATED_POSITION, summary: "", confidence: 0.9 },
    ],
  },
  {
    slug: "adaeze-nnamdi",
    fullName: "Adaeze Nnamdi",
    party: "NP",
    ballotOrder: 3,
    websiteUrl: "https://adaezennamdi.example.org",
    docs: [
      {
        key: "nnamdi-site",
        kind: SourceKind.CANDIDATE_WEBSITE,
        tier: SourceTier.CAMPAIGN_PLATFORM,
        url: "https://adaezennamdi.example.org/where-i-stand",
        title: "Where I Stand",
        capturedAt: "2027-08-21",
        text: D7_NNAMDI,
      },
    ],
    positions: [
      {
        issue: "environment-water",
        stance: Stance.STRONG_SUPPORT,
        summary:
          "Nnamdi would fund Five Mile Creek drainage work in the 2028 bond. She would begin lead service line replacement in the district's oldest blocks ahead of the state deadline.",
        quote:
          "I will vote to fund the drainage work in the 2028 bond and to begin lead service line replacement in the oldest blocks of the district first",
        doc: "nnamdi-site",
        confidence: 0.94,
      },
      {
        issue: "climate-energy",
        stance: Stance.SUPPORT,
        summary:
          "Nnamdi supports requiring city facilities and city-funded projects to meet the building energy code the council has adopted, and would vote against further exemptions to it.",
        quote:
          "I support requiring city facilities and city-funded projects to meet the building energy code the council already adopted",
        doc: "nnamdi-site",
        confidence: 0.91,
      },
      {
        issue: "housing-cost-of-living",
        stance: Stance.NO_STATED_POSITION,
        summary: "",
        confidence: 0.88,
      },
      {
        issue: "public-safety-policing",
        stance: Stance.NO_STATED_POSITION,
        summary: "",
        confidence: 0.88,
      },
      { issue: "taxes-budget", stance: Stance.NO_STATED_POSITION, summary: "", confidence: 0.88 },
      {
        issue: "transportation-infrastructure",
        stance: Stance.NO_STATED_POSITION,
        summary: "",
        confidence: 0.88,
      },
      {
        issue: "local-development-zoning",
        stance: Stance.NO_STATED_POSITION,
        summary: "",
        confidence: 0.85,
      },
    ],
  },
  {
    // The candidate with no findable record. This is the case the product exists to be honest about.
    slug: "roy-castellanos",
    fullName: "Roy Castellanos",
    party: "NP",
    ballotOrder: 4,
    docs: [],
    positions: [
      {
        issue: "housing-cost-of-living",
        stance: Stance.NO_STATED_POSITION,
        summary: "",
        confidence: 0.6,
      },
      { issue: "taxes-budget", stance: Stance.NO_STATED_POSITION, summary: "", confidence: 0.6 },
      {
        issue: "public-safety-policing",
        stance: Stance.NO_STATED_POSITION,
        summary: "",
        confidence: 0.6,
      },
    ],
  },
];

const PEOPLE_DISD5: Person[] = [
  {
    slug: "tabitha-wheeler",
    fullName: "Tabitha Wheeler",
    party: "NP",
    ballotOrder: 1,
    websiteUrl: "https://tabithawheeler.example.org",
    docs: [
      {
        key: "wheeler-site",
        kind: SourceKind.CANDIDATE_WEBSITE,
        tier: SourceTier.CAMPAIGN_PLATFORM,
        url: "https://tabithawheeler.example.org/platform",
        title: "Platform",
        capturedAt: "2027-08-19",
        text: DISD5_WHEELER,
      },
    ],
    positions: [
      {
        issue: "education-k12",
        stance: Stance.STRONG_SUPPORT,
        summary:
          "Wheeler would move high school start times to 8:30 a.m. or later and fund the additional bus routes that requires. She would vote against removing a library title on a complaint that has not gone through a written appeal process.",
        quote:
          "I will vote to move high school start times to 8:30 or later, and to fund the extra bus routes that requires",
        doc: "wheeler-site",
        confidence: 0.95,
      },
      {
        issue: "taxes-budget",
        stance: Stance.OPPOSE,
        summary:
          "Wheeler would vote against any budget that closes a campus in the district while the district holds more than sixty days of operating reserve.",
        quote:
          "I will vote against any budget that closes a campus in this district while the district holds more than sixty days of operating reserve.",
        doc: "wheeler-site",
        confidence: 0.9,
      },
      { issue: "civil-rights", stance: Stance.NO_STATED_POSITION, summary: "", confidence: 0.85 },
    ],
  },
  {
    slug: "bernard-okonkwo",
    fullName: "Bernard Okonkwo",
    party: "NP",
    ballotOrder: 2,
    docs: [
      {
        key: "okonkwo-stmt",
        kind: SourceKind.PUBLIC_STATEMENT,
        tier: SourceTier.CANDIDATE_SPEECH,
        url: "https://okonkwofordisd.example.org/statement",
        title: "Statement of candidacy",
        capturedAt: "2027-08-30",
        text: DISD5_OKONKWO,
      },
    ],
    positions: [
      {
        issue: "education-k12",
        stance: Stance.OPPOSE,
        summary:
          "Okonkwo supports a parent review process for library materials with a published annual list of added titles. He would give parents a decision rather than a comment period.",
        quote:
          "I support a parent review process for library materials with a published list of every title added\neach year, and I will vote to give parents a decision, not a comment period.",
        doc: "okonkwo-stmt",
        confidence: 0.92,
      },
      {
        issue: "taxes-budget",
        stance: Stance.STRONG_OPPOSE,
        summary:
          "Okonkwo would not vote for a tax rate increase, saying the district must operate within what it already collects.",
        quote: "I will not vote for a tax rate increase.",
        doc: "okonkwo-stmt",
        confidence: 0.94,
      },
      { issue: "civil-rights", stance: Stance.NO_STATED_POSITION, summary: "", confidence: 0.8 },
    ],
  },
  {
    slug: "june-halvorsen",
    fullName: "June Halvorsen",
    party: "NP",
    ballotOrder: 3,
    isIncumbent: true,
    docs: [
      {
        key: "halvorsen-q",
        kind: SourceKind.QUESTIONNAIRE,
        tier: SourceTier.QUESTIONNAIRE,
        url: "https://dallasfreepress.example.org/questionnaire/disd-5",
        title: "Candidate questionnaire — District 5",
        publisher: "Dallas Free Press",
        capturedAt: "2027-09-06",
        text: DISD5_HALVORSEN_Q,
      },
    ],
    positions: [
      {
        issue: "education-k12",
        stance: Stance.MIXED,
        summary:
          "Halvorsen says she finds the sleep research on later start times persuasive but will not commit either way until the district publishes the bus and childcare costs. She would vote against closing any campus in District 5 during her term.",
        quote:
          "I am not prepared to commit either way until the district publishes what the bus and childcare costs actually are.",
        doc: "halvorsen-q",
        confidence: 0.93,
      },
      { issue: "taxes-budget", stance: Stance.NO_STATED_POSITION, summary: "", confidence: 0.85 },
      // Asked directly, refused to answer. Different data from silence, and shown differently.
      { issue: "civil-rights", stance: Stance.DECLINED_TO_STATE, summary: "", confidence: 0.99 },
    ],
  },
];

const QUIZ: Array<[string, string]> = [
  ["housing-cost-of-living", "Should the city allow apartments and duplexes in neighborhoods that now allow only single-family homes?"],
  ["local-development-zoning", "Should the city end the requirement that new buildings include a minimum number of parking spaces?"],
  ["public-safety-policing", "Should the city hire more police officers than its currently authorized headcount?"],
  ["taxes-budget", "Should the city raise the homestead exemption, which lowers property tax bills and city revenue together?"],
  ["transportation-infrastructure", "Should the city fund neighborhood sidewalk repair before new downtown street projects?"],
  ["environment-water", "Should the city pay to replace lead water service lines ahead of the state's deadline?"],
  ["climate-energy", "Should city-funded buildings be required to meet the energy code the council has adopted?"],
  ["education-k12", "Should Dallas ISD move high school start times to 8:30 a.m. or later?"],
];

async function upsertJurisdictions() {
  const tx = await prisma.jurisdiction.upsert({
    where: { ocdId: "ocd-division/country:us/state:tx" },
    update: {},
    create: { level: JurisdictionLevel.STATE, name: "Texas", ocdId: "ocd-division/country:us/state:tx" },
  });
  const county = await prisma.jurisdiction.upsert({
    where: { ocdId: "ocd-division/country:us/state:tx/county:dallas" },
    update: {},
    create: {
      level: JurisdictionLevel.COUNTY,
      name: "Dallas County",
      ocdId: "ocd-division/country:us/state:tx/county:dallas",
      parentId: tx.id,
    },
  });
  const city = await prisma.jurisdiction.upsert({
    where: { ocdId: "ocd-division/country:us/state:tx/place:dallas" },
    update: {},
    create: {
      level: JurisdictionLevel.CITY,
      name: "City of Dallas",
      ocdId: "ocd-division/country:us/state:tx/place:dallas",
      parentId: county.id,
    },
  });
  const disd = await prisma.jurisdiction.upsert({
    where: { ocdId: "ocd-division/country:us/state:tx/school_district:dallas" },
    update: {},
    create: {
      level: JurisdictionLevel.SCHOOL_DISTRICT,
      name: "Dallas ISD",
      ocdId: "ocd-division/country:us/state:tx/school_district:dallas",
      parentId: county.id,
    },
  });
  return { city, disd };
}

async function seedRace(opts: {
  jurisdictionId: string;
  districtName: string;
  officeTitle: string;
  termYears: number;
  electionId: string;
  people: Person[];
}) {
  const district = await prisma.district.upsert({
    where: { jurisdictionId_name: { jurisdictionId: opts.jurisdictionId, name: opts.districtName } },
    update: {},
    create: { jurisdictionId: opts.jurisdictionId, name: opts.districtName },
  });
  let office = await prisma.office.findFirst({
    where: { jurisdictionId: opts.jurisdictionId, districtId: district.id, title: opts.officeTitle },
  });
  office ??= await prisma.office.create({
    data: {
      jurisdictionId: opts.jurisdictionId,
      districtId: district.id,
      title: opts.officeTitle,
      termYears: opts.termYears,
    },
  });
  const race = await prisma.race.upsert({
    where: { electionId_officeId: { electionId: opts.electionId, officeId: office.id } },
    update: {},
    create: { electionId: opts.electionId, officeId: office.id, isPartisan: false },
  });

  const np = await prisma.party.findUniqueOrThrow({ where: { abbreviation: "NP" } });

  for (const p of opts.people) {
    const candidate = await prisma.candidate.upsert({
      where: { slug: p.slug },
      update: { fullName: p.fullName, ...(p.websiteUrl ? { websiteUrl: p.websiteUrl } : {}) },
      create: { slug: p.slug, fullName: p.fullName, ...(p.websiteUrl ? { websiteUrl: p.websiteUrl } : {}) },
    });
    await prisma.candidacy.upsert({
      where: { raceId_candidateId: { raceId: race.id, candidateId: candidate.id } },
      update: { ballotOrder: p.ballotOrder, isIncumbent: !!p.isIncumbent, isCertified: true },
      create: {
        raceId: race.id,
        candidateId: candidate.id,
        partyId: np.id,
        ballotOrder: p.ballotOrder,
        isIncumbent: !!p.isIncumbent,
        isCertified: true,
        status: "QUALIFIED",
      },
    });

    const { createHash } = await import("node:crypto");
    const docIds = new Map<string, string>();
    for (const d of p.docs) {
      const contentHash = createHash("sha256").update(d.text).digest("hex");
      const source = await prisma.source.upsert({
        where: { url_contentHash: { url: d.url, contentHash } },
        update: { candidateId: candidate.id },
        create: {
          kind: d.kind,
          tier: d.tier,
          url: d.url,
          title: d.title,
          ...(d.publisher ? { publisher: d.publisher } : {}),
          capturedAt: new Date(d.capturedAt),
          contentHash,
          text: d.text,
          candidateId: candidate.id,
        },
      });
      docIds.set(d.key, source.id);
    }

    for (const pos of p.positions) {
      const issue = await prisma.issue.findUniqueOrThrow({ where: { slug: pos.issue } });
      const existing = await prisma.position.findFirst({
        where: { candidateId: candidate.id, issueId: issue.id },
      });
      if (existing) continue;

      let evidenceId: string | undefined;
      if (pos.quote && pos.doc) {
        const doc = p.docs.find((d) => d.key === pos.doc)!;
        // The same gate the pipeline runs. A fixture that cannot pass it is a broken fixture.
        const m = findVerbatim(doc.text, pos.quote);
        if (!m) {
          throw new Error(`fixture quote not verbatim in ${pos.doc} for ${p.slug}/${pos.issue}`);
        }
        const ev = await prisma.evidence.create({
          data: {
            sourceId: docIds.get(pos.doc)!,
            quote: m.quote,
            startOffset: m.start,
            endOffset: m.end,
          },
        });
        evidenceId = ev.id;
      }

      await prisma.position.create({
        data: {
          candidateId: candidate.id,
          issueId: issue.id,
          stance: pos.stance,
          summary: pos.summary,
          confidence: pos.confidence,
          status: "PUBLISHED",
          publishedAt: new Date("2027-09-10"),
          reviewedBy: "fixture",
          reviewedAt: new Date("2027-09-10"),
          extractedBy: "fixture",
          ...(evidenceId ? { evidence: { connect: { id: evidenceId } } } : {}),
        },
      });
    }
  }
  return race;
}

export async function seedFixture() {
  const { city, disd } = await upsertJurisdictions();

  const election = await prisma.election.upsert({
    where: { slug: ELECTION_SLUG },
    update: {},
    create: {
      slug: ELECTION_SLUG,
      name: "Dallas Municipal Election, November 2027",
      kind: "MUNICIPAL",
      electionDate: new Date("2027-11-02"),
      state: "TX",
      regDeadline: new Date("2027-10-04"),
      earlyVoteFrom: new Date("2027-10-18"),
      earlyVoteTo: new Date("2027-10-29"),
    },
  });

  await seedRace({
    jurisdictionId: city.id,
    districtName: "District 7",
    officeTitle: "Dallas City Council Member",
    termYears: 4,
    electionId: election.id,
    people: PEOPLE_D7,
  });
  await seedRace({
    jurisdictionId: disd.id,
    districtName: "District 5",
    officeTitle: "Dallas ISD Trustee",
    termYears: 4,
    electionId: election.id,
    people: PEOPLE_DISD5,
  });

  for (const [i, [slug, prompt]] of QUIZ.entries()) {
    const issue = await prisma.issue.findUniqueOrThrow({ where: { slug } });
    const existing = await prisma.quizQuestion.findFirst({ where: { issueId: issue.id, prompt } });
    if (!existing) {
      await prisma.quizQuestion.create({ data: { issueId: issue.id, prompt, sortOrder: i } });
    }
  }

  const counts = {
    candidates: PEOPLE_D7.length + PEOPLE_DISD5.length,
    positions: await prisma.position.count({ where: { status: "PUBLISHED" } }),
    silent: await prisma.position.count({
      where: { status: "PUBLISHED", stance: { in: [Stance.NO_STATED_POSITION, Stance.DECLINED_TO_STATE] } },
    }),
    sources: await prisma.source.count(),
    questions: QUIZ.length,
  };
  return { electionId: election.id, ...counts };
}
