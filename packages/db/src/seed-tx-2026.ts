/**
 * The November 3, 2026 Texas general election — the federal races.
 *
 * Real, not a fixture. Every office here exists; every district number is a real
 * Texas congressional district. What this file does NOT do is invent candidates:
 * those arrive from the FEC adapter and land as FILED, because the FEC does not know
 * who qualified for a ballot.
 *
 * Only US House and Senate. State offices (governor, legislature) and every municipal
 * race need a different source and are deliberately absent rather than stubbed, so
 * the completeness numbers stay honest about what is missing.
 */
import { JurisdictionLevel, prisma } from "./index.js";

export const TX_2026_SLUG = "2026-11-tx";

/** Texas has had 38 congressional districts since the 2021 apportionment. */
const HOUSE_DISTRICTS = 38;

export async function seedTexas2026() {
  const usa = await prisma.jurisdiction.upsert({
    where: { ocdId: "ocd-division/country:us" },
    update: {},
    create: {
      level: JurisdictionLevel.FEDERAL,
      name: "United States",
      ocdId: "ocd-division/country:us",
    },
  });

  const texas = await prisma.jurisdiction.upsert({
    where: { ocdId: "ocd-division/country:us/state:tx" },
    update: {},
    create: {
      level: JurisdictionLevel.STATE,
      name: "Texas",
      ocdId: "ocd-division/country:us/state:tx",
      parentId: usa.id,
    },
  });

  const election = await prisma.election.upsert({
    where: { slug: TX_2026_SLUG },
    update: {},
    create: {
      slug: TX_2026_SLUG,
      name: "Texas General Election, November 2026",
      kind: "GENERAL",
      electionDate: new Date("2026-11-03"),
      state: "TX",
    },
  });

  let races = 0;

  // The Senate seat that is up. Texas's other seat is on the 2030 cycle.
  const senate = await upsertOffice({
    jurisdictionId: texas.id,
    title: "United States Senator",
    seatLabel: "Class II",
    termYears: 6,
  });
  await upsertRace(election.id, senate.id);
  races++;

  for (let d = 1; d <= HOUSE_DISTRICTS; d++) {
    const name = `District ${d}`;
    const district = await prisma.district.upsert({
      where: { jurisdictionId_name: { jurisdictionId: texas.id, name } },
      update: {},
      create: {
        jurisdictionId: texas.id,
        name,
        ocdId: `ocd-division/country:us/state:tx/cd:${d}`,
      },
    });
    const office = await upsertOffice({
      jurisdictionId: texas.id,
      districtId: district.id,
      title: "United States Representative",
      // The ballot term for a congressional seat is the district itself.
      seatLabel: name,
      termYears: 2,
    });
    await upsertRace(election.id, office.id);
    races++;
  }

  return { electionSlug: TX_2026_SLUG, races };
}

async function upsertOffice(o: {
  jurisdictionId: string;
  districtId?: string;
  title: string;
  seatLabel: string;
  termYears: number;
}) {
  const found = await prisma.office.findFirst({
    where: {
      jurisdictionId: o.jurisdictionId,
      title: o.title,
      ...(o.districtId ? { districtId: o.districtId } : { districtId: null }),
    },
  });
  if (found) {
    return found.seatLabel === o.seatLabel
      ? found
      : prisma.office.update({ where: { id: found.id }, data: { seatLabel: o.seatLabel } });
  }
  return prisma.office.create({
    data: {
      jurisdictionId: o.jurisdictionId,
      ...(o.districtId ? { districtId: o.districtId } : {}),
      title: o.title,
      seatLabel: o.seatLabel,
      termYears: o.termYears,
    },
  });
}

async function upsertRace(electionId: string, officeId: string) {
  return prisma.race.upsert({
    where: { electionId_officeId: { electionId, officeId } },
    update: {},
    create: { electionId, officeId, isPartisan: true },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedTexas2026()
    .then((r) => console.log(`${r.electionSlug}: ${r.races} races (38 House + 1 Senate)`))
    .finally(() => prisma.$disconnect());
}
