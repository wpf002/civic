/**
 * State offices below governor: statewide officers and the legislature.
 *
 * Races for these come from a state's own certified list, in a deliberate step
 * (`offices`) that a person runs and reads, and never as a side effect of ingesting a
 * roster. An adapter still never creates the race it fails to resolve; this is the
 * separate, reviewed act of adding offices the state says are on its ballot.
 */
import { stateByCode } from "@civic/core";
import type { OfficeSpec } from "./state-office-specs.js";
export * from "./state-office-specs.js";
import { JurisdictionLevel, prisma } from "@civic/db";

const TERM: Record<string, number> = { "State Senator": 4, "State Representative": 2 };

/** Create any missing District, Office and Race for these specs. Returns what it created. */
export async function ensureStateOffices(
  electionSlug: string,
  stateCode: string,
  specs: Map<string, OfficeSpec>,
): Promise<string[]> {
  const st = stateByCode(stateCode);
  if (!st) throw new Error(`unknown state ${stateCode}`);
  const election = await prisma.election.findUniqueOrThrow({ where: { slug: electionSlug } });
  const ocd = st.code === "DC" ? "ocd-division/country:us/district:dc" : `ocd-division/country:us/state:${st.code.toLowerCase()}`;
  const juris = await prisma.jurisdiction.findUniqueOrThrow({ where: { ocdId: ocd } });
  const created: string[] = [];

  for (const [raceKey, spec] of specs) {
    let districtId: string | null = null;
    if (spec.chamber) {
      const district = await prisma.district.upsert({
        where: { jurisdictionId_name: { jurisdictionId: juris.id, name: spec.seatLabel } },
        update: {},
        create: { jurisdictionId: juris.id, name: spec.seatLabel },
      });
      districtId = district.id;
    }
    let office = await prisma.office.findFirst({
      where: { jurisdictionId: juris.id, title: spec.title, seatLabel: spec.seatLabel, districtId },
    });
    if (!office) {
      office = await prisma.office.create({
        data: {
          jurisdictionId: juris.id,
          ...(districtId ? { districtId } : {}),
          title: spec.title,
          seatLabel: spec.seatLabel,
          ...(TERM[spec.title] ? { termYears: TERM[spec.title] } : {}),
        },
      });
    }
    const existing = await prisma.race.findUnique({
      where: { electionId_officeId: { electionId: election.id, officeId: office.id } },
    });
    if (!existing) {
      await prisma.race.create({ data: { electionId: election.id, officeId: office.id, isPartisan: true } });
      created.push(`${raceKey} (${spec.title}, ${spec.seatLabel})`);
    }
  }
  return created;
}

/** Resolve a state office to its race by title and seat label, never by a near match. */
export async function resolveStateOffice(electionSlug: string, spec: OfficeSpec): Promise<string | null> {
  const races = await prisma.race.findMany({
    where: {
      election: { slug: electionSlug },
      office: { title: spec.title, seatLabel: spec.seatLabel, jurisdiction: { level: JurisdictionLevel.STATE } },
    },
    select: { id: true },
  });
  return races.length === 1 ? races[0]!.id : null;
}
