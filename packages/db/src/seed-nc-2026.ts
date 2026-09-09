/**
 * North Carolina's federal races, November 3 2026.
 *
 * The second state to get races rather than just an adapter. Everything downstream
 * of ingest — extraction, verification, the ballot endpoint, the issue pages — has
 * only ever run against Texas, so a second state is what shows whether any of it was
 * accidentally Texas-shaped.
 *
 * Federal only, matching the Texas seed. NC's own file also carries county and
 * municipal contests, which the adapter reports as unmapped until offices exist for
 * them.
 */
import { JurisdictionLevel, prisma } from "./index.js";

export const NC_2026_SLUG = "2026-11-nc";

/** North Carolina has had 14 congressional districts since the 2021 apportionment. */
const HOUSE_DISTRICTS = 14;

export async function seedNorthCarolina2026() {
  const usa = await prisma.jurisdiction.upsert({
    where: { ocdId: "ocd-division/country:us" },
    update: {},
    create: { level: JurisdictionLevel.FEDERAL, name: "United States", ocdId: "ocd-division/country:us" },
  });

  const nc = await prisma.jurisdiction.upsert({
    where: { ocdId: "ocd-division/country:us/state:nc" },
    update: {},
    create: {
      level: JurisdictionLevel.STATE,
      name: "North Carolina",
      ocdId: "ocd-division/country:us/state:nc",
      parentId: usa.id,
    },
  });

  const election = await prisma.election.upsert({
    where: { slug: NC_2026_SLUG },
    update: {},
    create: {
      slug: NC_2026_SLUG,
      name: "North Carolina General Election, November 2026",
      kind: "GENERAL",
      electionDate: new Date("2026-11-03"),
      state: "NC",
    },
  });

  let races = 0;

  // The Senate seat on the ballot in 2026. North Carolina's other seat is on the
  // 2028 cycle.
  const senate = await upsertOffice({ jurisdictionId: nc.id, title: "United States Senator", seatLabel: "Class II", termYears: 6 });
  await upsertRace(election.id, senate.id);
  races++;

  for (let d = 1; d <= HOUSE_DISTRICTS; d++) {
    const name = `District ${d}`;
    const district = await prisma.district.upsert({
      where: { jurisdictionId_name: { jurisdictionId: nc.id, name } },
      update: {},
      create: { jurisdictionId: nc.id, name, ocdId: `ocd-division/country:us/state:nc/cd:${d}` },
    });
    const office = await upsertOffice({
      jurisdictionId: nc.id,
      districtId: district.id,
      title: "United States Representative",
      seatLabel: name,
      termYears: 2,
    });
    await upsertRace(election.id, office.id);
    races++;
  }

  return { electionSlug: NC_2026_SLUG, races };
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

const upsertRace = (electionId: string, officeId: string) =>
  prisma.race.upsert({
    where: { electionId_officeId: { electionId, officeId } },
    update: {},
    create: { electionId, officeId, isPartisan: true },
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  seedNorthCarolina2026()
    .then((r) => console.log(`${r.electionSlug}: ${r.races} races (14 House + 1 Senate)`))
    .finally(() => prisma.$disconnect());
}
