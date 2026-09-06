import { Command } from "commander";
import { prisma } from "@civic/db";
import { persistRun } from "./run.js";
import { novemberCalendar, mayCalendar, iso, deadlinesNeedingReview } from "./adapters/tx-uniform-dates.js";
import { resolveDistricts } from "./adapters/districts.js";
import { fetchIsdRoster } from "./adapters/dallas-isd.js";
import { fetchCouncilRoster } from "./adapters/dallas-city-secretary.js";
import { fetchFederalRosters, formatFecName } from "./adapters/fec.js";
import {
  fetchCongressMemberSite,
  fetchCongressMembers,
  fetchFecSites,
  fetchOpenStatesPeople,
  preferSite,
  siteFromOpenStatesLinks,
  type CandidateSite,
} from "./adapters/candidate-sites.js";
import { NOVEMBER_2026, fetchCertifiedRoster } from "./adapters/tx-sos.js";
import { resolveCouncilSeat, resolveFederalSeat } from "./seats.js";
import { diffRoster, nameKey } from "./roster.js";

const program = new Command("civic-ingest");

program
  .command("calendar")
  .description("Generate the Texas statutory election calendar for a year. No network.")
  .requiredOption("--year <yyyy>")
  .action((o) => {
    for (const c of [mayCalendar(Number(o.year)), novemberCalendar(Number(o.year))]) {
      console.log(`\n${c.kind} ${iso(c.electionDate)}`);
      console.log(`  filing opens        ${iso(c.filingOpensAt)}`);
      console.log(`  filing deadline     ${iso(c.filingDeadline)}`);
      console.log(`  write-in deadline   ${iso(c.writeInFilingDeadline)}`);
      console.log(`  withdrawal deadline ${iso(c.withdrawalDeadline)}`);
      const review = deadlinesNeedingReview(c);
      if (review.length) {
        console.log(
          `  NEEDS CONFIRMATION (weekend, §1.006 may roll it): ` +
            review.map((r) => `${r.name} ${iso(r.date)}`).join(", "),
        );
      }
      console.log(`  derived from: ${c.derivedFrom}`);
    }
  });

program
  .command("districts")
  .description("Resolve an address to its districts. The address is discarded.")
  .requiredOption("--address <addr>")
  .action(async (o) => {
    const r = await resolveDistricts(o.address);
    if (!r) return console.log("no match");
    console.log(`matched: ${r.matchedAddress}`);
    for (const p of r.provenance) console.log(`  ${p.value.padEnd(38)} ${p.layer}`);
  });

program
  .command("roster")
  .description("Fetch a roster and diff it. Never writes; prints the verdict.")
  .requiredOption("--adapter <name>", "dallas-isd")
  .requiredOption("--election <yyyy-mm-dd>")
  .action(async (o) => {
    if (o.adapter !== "dallas-isd") throw new Error(`unknown adapter ${o.adapter}`);
    const run = await fetchIsdRoster(o.election, new Date());
    console.log(`page: ${run.page.url}`);
    console.log(`documents that could justify a removal: ${run.documents.length}`);
    for (const r of run.rosters) {
      const d = diffRoster(null, r);
      console.log(`\n${r.raceKey}  ${d.verdict}`);
      for (const e of r.entries) console.log(`  - ${e.name}`);
      for (const reason of d.reasons) console.log(`  ! ${reason}`);
    }
  });

program
  .command("ingest")
  .description("Fetch a roster and PERSIST it: snapshot, diff, and apply if additive.")
  .requiredOption("--adapter <name>", "dallas-isd | dallas-city-secretary | fec | tx-sos")
  .option("--sos-election <id>", "Texas SOS election id (default: 2026 November general)")
  .requiredOption("--election <slug>", "e.g. 2027-11-dallas")
  .requiredOption("--date <yyyy-mm-dd>", "the election date the source must match")
  .option("--dry-run")
  .action(async (o) => {
    // An adapter never creates a Race. Unresolvable rosters quarantine instead.
    let rosters;
    let basis: "FILED" | "CERTIFIED" = "FILED";
    let resolve: (raceKey: string) => Promise<string | null>;

    if (o.adapter === "dallas-isd") {
      rosters = (await fetchIsdRoster(o.date, new Date())).rosters;
      resolve = async (raceKey: string) => {
        const m = raceKey.match(/^disd-trustee-(\d+)$/);
        if (!m) return null;
        const race = await prisma.race.findFirst({
          where: {
            election: { slug: o.election },
            office: { title: { contains: "Trustee" }, district: { name: `District ${m[1]}` } },
          },
        });
        return race?.id ?? null;
      };
    } else if (o.adapter === "dallas-city-secretary") {
      const year = Number(String(o.date).slice(0, 4));
      const run = await fetchCouncilRoster(year, new Date());
      rosters = run.rosters;
      console.log(`basis: ${run.basis} (${run.sourceUrl})`);
      // Filed-vs-certified differences are printed, never merged into the roster.
      for (const r of run.reconciliation) {
        const notes = [
          r.filedOnly.length ? `filed but not on ballot: ${r.filedOnly.join(", ")}` : "",
          r.certifiedOnly.length ? `on ballot but never filed: ${r.certifiedOnly.join(", ")}` : "",
          ...r.probableRespellings.map((x) => `possible respelling: ${x.filed} / ${x.certified}`),
          r.placeholders ? `${r.placeholders} unnamed ballot line(s)` : "",
        ].filter(Boolean);
        if (notes.length) console.log(`  Place ${r.place}: ${notes.join("; ")}`);
      }
      resolve = async (raceKey: string) => {
        const { raceId, reason } = await resolveCouncilSeat(o.election, raceKey);
        if (!raceId) console.log(`  ! ${raceKey}: ${reason}`);
        return raceId;
      };
    } else if (o.adapter === "fec") {
      const cycle = Number(String(o.date).slice(0, 4));
      const run = await fetchFederalRosters("TX", cycle, new Date());
      rosters = run.rosters;
      console.log(
        `basis: ${run.basis} — ${run.candidateCount} statutory candidates across ` +
          `${run.rosters.length} races. FILED is not the ballot: the FEC does not know ` +
          `who qualified, so primary losers and inactive filers are included.`,
      );
      for (const m of run.merged) {
        console.log(`  merged ${m.raceKey}: ${m.name} held ${m.candidateIds.length} FEC ids (${m.candidateIds.join(", ")})`);
      }
      resolve = async (raceKey: string) => {
        const { raceId, reason } = await resolveFederalSeat(o.election, raceKey);
        if (!raceId) console.log(`  ! ${raceKey}: ${reason}`);
        return raceId;
      };
    } else if (o.adapter === "tx-sos") {
      const run = await fetchCertifiedRoster(Number(o.sosElection ?? NOVEMBER_2026), new Date());
      rosters = run.rosters;
      basis = "CERTIFIED";
      console.log(
        `basis: ${run.basis} — ${run.candidateCount} candidates in ${run.rosters.length} modelled races. ` +
          `This is the ballot, not the filers.`,
      );
      const unmappedTotal = run.unmapped.reduce((n, u) => n + u.count, 0);
      console.log(
        `  ${unmappedTotal} certified candidates are in ${run.unmapped.length} offices this product ` +
          `does not model yet (top: ${run.unmapped.slice(0, 3).map((u) => `${u.officeName} x${u.count}`).join(", ")})`,
      );
      resolve = async (raceKey: string) => {
        const { raceId, reason } = await resolveFederalSeat(o.election, raceKey);
        if (!raceId) console.log(`  ! ${raceKey}: ${reason}`);
        return raceId;
      };
    } else {
      throw new Error(`unknown adapter ${o.adapter}`);
    }

    const out = await persistRun(
      { adapter: o.adapter, electionSlug: o.election, basis, dryRun: !!o.dryRun },
      rosters,
      resolve,
    );
    for (const r of out.races) {
      console.log(`${r.raceKey.padEnd(20)} ${r.verdict}${r.applied ? " (applied)" : ""}`);
      if (r.added.length) console.log(`  + ${r.added.join(", ")}`);
      if (r.removed.length) console.log(`  - ${r.removed.join(", ")}`);
      for (const reason of r.reasons) console.log(`  ! ${reason}`);
    }
    await prisma.$disconnect();
  });

program
  .command("sites")
  .description("Find campaign websites for candidates, from FEC Form 1, OpenStates and Congress.gov.")
  .requiredOption("--election <slug>")
  .option("--state <xx>", "two-letter state", "TX")
  .option("--cycle <yyyy>", "FEC election year", (v) => Number(v), 2026)
  .option("--congress <n>", "Congress number for the official-site lookup", (v) => Number(v), 119)
  .option("--only-missing", "look up only candidates that have no website yet")
  .option("--dry-run")
  .action(async (o) => {
    const found = new Map<string, CandidateSite>();

    // Candidates already in this election, with whatever ids the ingest recorded.
    // Deliberately NOT refetching the roster to recover FEC ids: the first version of
    // this command did that and spent an entire hourly quota rediscovering ids that
    // were already stored.
    const candidates = await prisma.candidate.findMany({
      where: { candidacies: { some: { race: { election: { slug: o.election } } } } },
      select: { id: true, slug: true, fullName: true, websiteUrl: true, externalIds: true },
    });

    // 1. FEC Form 1. The campaign told the government its own address, which is the
    //    most direct assertion available and covers about half of filers.
    const nameByFecId = new Map<string, string>();
    for (const c of candidates) {
      const fec = (c.externalIds as { fec?: string } | null)?.fec;
      if (fec) nameByFecId.set(fec, c.fullName);
    }
    // A partial run leaves failed lookups behind. Re-running the whole state to
    // recover them costs another full quota, so --only-missing narrows to candidates
    // that still have no website. Failures and genuine absences are indistinguishable
    // from here, which is fine: looking again at both is exactly what is wanted.
    const needed = o.onlyMissing ? candidates.filter((c) => !c.websiteUrl) : candidates;
    const neededFec = new Set(
      needed.map((c) => (c.externalIds as { fec?: string } | null)?.fec).filter(Boolean) as string[],
    );
    const fecIds = [...nameByFecId.keys()].filter((id) => neededFec.has(id));
    if (o.onlyMissing) {
      console.log(`only-missing: ${needed.length} of ${candidates.length} candidates still have no website`);
    }
    const { sites: byFecId, failed: fecFailed } = await fetchFecSites(fecIds);
    for (const [id, site] of byFecId) {
      const name = nameByFecId.get(id);
      if (name) found.set(nameKey(name), site);
    }
    console.log(
      `FEC Form 1:    ${byFecId.size} of ${fecIds.length} federal candidates` +
        (fecFailed.length ? `  (${fecFailed.length} lookups FAILED — not the same as no website)` : ""),
    );

    // 2. Congress.gov, for sitting members. An official .gov site, tiered lower.
    let congressHits = 0;
    for (const m of await fetchCongressMembers(o.state, o.congress)) {
      const site = await fetchCongressMemberSite(m.bioguideId);
      if (!site) continue;
      congressHits++;
      const key = nameKey(formatFecName(m.name));
      found.set(key, preferSite(found.get(key) ?? null, site)!);
    }
    console.log(`Congress.gov:  ${congressHits} sitting members`);

    // 3. OpenStates, for sitting state legislators. Officeholders, never candidates —
    //    there is no candidate endpoint, so this adds no state roster.
    let osHits = 0;
    const people = await fetchOpenStatesPeople("Texas");
    for (const p of people) {
      const site = siteFromOpenStatesLinks(p.links ?? [], p.openstates_url);
      if (!site) continue;
      osHits++;
      const key = nameKey(p.name);
      found.set(key, preferSite(found.get(key) ?? null, site)!);
    }
    console.log(`OpenStates:    ${osHits} of ${people.length} sitting state legislators`);

    let wrote = 0;
    let already = 0;
    for (const c of candidates) {
      const site = found.get(nameKey(c.fullName));
      if (!site) continue;
      if (c.websiteUrl === site.url) {
        already++;
        continue;
      }
      if (!o.dryRun) {
        await prisma.candidate.update({ where: { id: c.id }, data: { websiteUrl: site.url } });
      }
      wrote++;
    }

    // Report the state of the database, not the contents of this run's lookup map.
    // With --only-missing the map covers a narrowed set, and computing coverage from
    // it printed "27 of 241 (11%)" for a database that was 67% covered. A number whose
    // meaning changes with the flags is worse than no number.
    const total = await prisma.candidate.count({
      where: { candidacies: { some: { race: { election: { slug: o.election } } } } },
    });
    const withSite = await prisma.candidate.count({
      where: {
        candidacies: { some: { race: { election: { slug: o.election } } } },
        NOT: { websiteUrl: null },
      },
    });

    console.log(
      `\nthis run: ${wrote} written, ${already} already current` +
        (o.dryRun ? "  (dry run, nothing written)" : ""),
    );
    console.log(
      `${o.election}: ${withSite} of ${total} candidates have a website ` +
        `(${Math.round((100 * withSite) / Math.max(total, 1))}%)`,
    );
    console.log(
      `${total - withSite} have none recorded. That is recorded as none, not guessed at — ` +
        `a wrong website attributes one candidate's words to another.`,
    );
    if (fecFailed.length) {
      console.log(
        `${fecFailed.length} FEC lookups did not complete. Those are not absences; ` +
          `re-run with --only-missing to retry just them.`,
      );
    }
    await prisma.$disconnect();
  });

program
  .command("heartbeat")
  .description("Assert every scheduled job ran recently. Railway documents no cron retry.")
  .option("--within-hours <n>", "expected max age of the newest run", (v) => Number(v), 26)
  .action(async (o) => {
    const expected = ["dallas-isd", "dallas-city-secretary"];
    const cutoff = new Date(Date.now() - o.withinHours * 3600_000);
    let bad = 0;
    for (const adapter of expected) {
      const last = await prisma.ingestRun.findFirst({
        where: { adapter },
        orderBy: { startedAt: "desc" },
      });
      if (!last) {
        console.log(`MISSING  ${adapter} — has never run`);
        bad++;
      } else if (last.startedAt < cutoff) {
        console.log(`STALE    ${adapter} — last ran ${last.startedAt.toISOString()}`);
        bad++;
      } else if (!last.finishedAt) {
        console.log(`HUNG     ${adapter} — started ${last.startedAt.toISOString()}, never finished`);
        bad++;
      } else {
        console.log(`ok       ${adapter} — ${last.startedAt.toISOString()} ${last.status}`);
      }
    }
    await prisma.$disconnect();
    // A job that never fires produces no error anywhere else. This is the error.
    if (bad > 0) process.exit(1);
  });

program.parseAsync();
