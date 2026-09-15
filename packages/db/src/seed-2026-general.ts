/**
 * Every federal and governor race on the November 3 2026 ballot, in all 50 states and DC.
 *
 * Races only. No candidates: an adapter fills those from the FEC (who filed) and from
 * ballot data (who is actually on it). Seeding races is what lets an adapter resolve a
 * roster into a race without ever creating one, which is the rule in seats.ts.
 *
 * Idempotent, and consistent with the Texas and North Carolina seeds: the same titles,
 * seat labels and district names, so re-running it over those states changes nothing.
 *
 *   pnpm --filter @civic/db seed:2026
 */
import { US_STATES, houseSeatLabel, type UsState } from "@civic/core";
import { JurisdictionLevel, prisma } from "./index.js";

export const electionSlugFor = (stateCode: string) => `2026-11-${stateCode.toLowerCase()}`;

/** New Hampshire and Vermont elect governors every two years; everyone else, four. */
const GOVERNOR_TERM: Record<string, number> = { NH: 2, VT: 2 };

export async function seed2026General(states: readonly UsState[] = US_STATES) {
  const usa = await prisma.jurisdiction.upsert({
    where: { ocdId: "ocd-division/country:us" },
    update: {},
    create: { level: JurisdictionLevel.FEDERAL, name: "United States", ocdId: "ocd-division/country:us" },
  });

  const totals = { elections: 0, house: 0, senate: 0, governor: 0 };

  for (const st of states) {
    const code = st.code.toLowerCase();
    const ocd = st.code === "DC" ? "ocd-division/country:us/district:dc" : `ocd-division/country:us/state:${code}`;
    const juris = await prisma.jurisdiction.upsert({
      where: { ocdId: ocd },
      update: {},
      create: { level: JurisdictionLevel.STATE, name: st.name, ocdId: ocd, parentId: usa.id },
    });

    const slug = electionSlugFor(st.code);
    const election = await prisma.election.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        name: `${st.name} General Election, November 2026`,
        kind: "GENERAL",
        electionDate: new Date("2026-11-03"),
        state: st.code,
      },
    });
    totals.elections++;

    if (st.senate2026) {
      const office = await upsertOffice({ jurisdictionId: juris.id, title: "United States Senator", seatLabel: st.senate2026, termYears: 6 });
      await upsertRace(election.id, office.id);
      totals.senate++;
    }

    for (let d = 1; d <= st.houseSeats; d++) {
      const name = houseSeatLabel(st.code, d);
      const district = await prisma.district.upsert({
        where: { jurisdictionId_name: { jurisdictionId: juris.id, name } },
        update: {},
        create: {
          jurisdictionId: juris.id,
          name,
          // OCD ids number congressional districts; an at-large seat is the state itself.
          ocdId: name.startsWith("District ") ? `${ocd}/cd:${d}` : null,
        },
      });
      const office = await upsertOffice({
        jurisdictionId: juris.id,
        districtId: district.id,
        title: "United States Representative",
        seatLabel: name,
        termYears: 2,
      });
      await upsertRace(election.id, office.id);
      totals.house++;
    }

    if (st.governor2026) {
      const office = await upsertOffice({
        jurisdictionId: juris.id,
        title: "Governor",
        seatLabel: "Governor",
        termYears: GOVERNOR_TERM[st.code] ?? 4,
      });
      await upsertRace(election.id, office.id);
      totals.governor++;
    }
  }

  return totals;
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
  seed2026General()
    .then((t) => console.log(`${t.elections} elections · ${t.house} House · ${t.senate} Senate · ${t.governor} governor races`))
    .finally(() => prisma.$disconnect());
}
