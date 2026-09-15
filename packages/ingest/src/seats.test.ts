import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@civic/db";
import { federalSeatLabel, resolveCouncilSeat, resolveFederalSeat } from "./seats.js";

/**
 * The Place/District reconciliation, tested against the real fixture database.
 *
 * The behaviour worth protecting is the refusal: an unmapped seat must resolve to
 * nothing, because a roster written into the wrong race is invisible and a roster
 * that quarantines is not.
 */
const ELECTION = "2027-11-dallas";

describe("resolving a ballot Place to a race", () => {
  it("resolves through the seatLabel a person entered", async () => {
    const { raceId, reason } = await resolveCouncilSeat(ELECTION, "dallas-council-place-7");
    expect(reason).toBe("");
    expect(raceId).toBeTruthy();

    // And it is the District 7 council race — the mapping is real, not coincidental.
    const race = await prisma.race.findUniqueOrThrow({
      where: { id: raceId! },
      include: { office: { include: { district: true } } },
    });
    expect(race.office.district?.name).toBe("District 7");
    expect(race.office.seatLabel).toBe("Place 7");
  });

  it("refuses a place with no seatLabel rather than assuming Place N is District N", async () => {
    // District 5 exists in the fixture (the DISD trustee race). If resolution ever
    // falls back to matching a district number, this silently starts passing and a
    // council roster lands in a school-board race.
    const { raceId, reason } = await resolveCouncilSeat(ELECTION, "dallas-council-place-5");
    expect(raceId).toBeNull();
    expect(reason).toMatch(/no office .* carries seatLabel "Place 5"/i);
  });

  it("refuses the at-large mayoral place, which has no district at all", async () => {
    const { raceId } = await resolveCouncilSeat(ELECTION, "dallas-council-place-15");
    expect(raceId).toBeNull();
  });

  it("refuses a race key from another adapter", async () => {
    const { raceId, reason } = await resolveCouncilSeat(ELECTION, "disd-trustee-5");
    expect(raceId).toBeNull();
    expect(reason).toMatch(/not a Dallas council place key/);
  });

  it("refuses an ambiguous seat label instead of picking one", async () => {
    const race = await prisma.race.findFirstOrThrow({
      where: { election: { slug: ELECTION }, office: { seatLabel: "Place 7" } },
      include: { office: true },
    });
    const duplicate = await prisma.office.create({
      data: {
        jurisdictionId: race.office.jurisdictionId,
        title: "ZZ Seats Test Duplicate Office",
        seatLabel: "Place 7",
      },
    });
    const dupRace = await prisma.race.create({
      data: { electionId: race.electionId, officeId: duplicate.id, isPartisan: false },
    });
    try {
      const { raceId, reason } = await resolveCouncilSeat(ELECTION, "dallas-council-place-7");
      expect(raceId).toBeNull();
      expect(reason).toMatch(/must identify one race/);
    } finally {
      await prisma.race.delete({ where: { id: dupRace.id } });
      await prisma.office.delete({ where: { id: duplicate.id } });
    }
  });
});

describe("federal race keys to seat labels", () => {
  it("numbers ordinary districts", () => {
    expect(federalSeatLabel("us-house-tx-07")).toBe("District 7");
  });

  it("maps the FEC's district 00 to at-large and to DC's delegate", () => {
    expect(federalSeatLabel("us-house-wy-00")).toBe("At-Large");
    expect(federalSeatLabel("us-house-dc-00")).toBe("Delegate");
  });

  it("refuses a district a state does not have", () => {
    // A roster for a seat that does not exist must quarantine, never land somewhere.
    expect(federalSeatLabel("us-house-wy-02")).toBeNull();
    expect(federalSeatLabel("us-house-tx-00")).toBeNull();
    expect(federalSeatLabel("us-house-tx-39")).toBeNull();
  });

  it("uses the Senate class on the ballot, and nothing when no seat is up", () => {
    expect(federalSeatLabel("us-senate-tx")).toBe("Class II");
    expect(federalSeatLabel("us-senate-fl")).toBe("Class III");
    expect(federalSeatLabel("us-senate-ca")).toBeNull();
  });
});

describe("governor race keys", () => {
  it("only resolves where a governor is on the 2026 ballot", async () => {
    // North Carolina elects its governor in 2028: nothing to land in, so it quarantines.
    const nc = await resolveFederalSeat("2026-11-nc", "governor-nc");
    expect(nc.raceId).toBeNull();
  });
});

afterAll(async () => {
  await prisma.office.deleteMany({ where: { title: { startsWith: "ZZ Seats Test" } } });
  await prisma.$disconnect();
});
