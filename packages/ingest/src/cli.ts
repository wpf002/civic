import { Command } from "commander";
import { prisma } from "@civic/db";
import { persistRun } from "./run.js";
import { novemberCalendar, mayCalendar, iso, deadlinesNeedingReview } from "./adapters/tx-uniform-dates.js";
import { resolveDistricts } from "./adapters/districts.js";
import { fetchIsdRoster } from "./adapters/dallas-isd.js";
import { diffRoster } from "./roster.js";

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
  .requiredOption("--adapter <name>", "dallas-isd")
  .requiredOption("--election <slug>", "e.g. 2027-11-dallas")
  .requiredOption("--date <yyyy-mm-dd>", "the election date the source must match")
  .option("--dry-run")
  .action(async (o) => {
    if (o.adapter !== "dallas-isd") throw new Error(`unknown adapter ${o.adapter}`);
    const run = await fetchIsdRoster(o.date, new Date());

    // An adapter never creates a Race. Unresolvable rosters quarantine instead.
    const resolve = async (raceKey: string) => {
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

    const out = await persistRun(
      { adapter: o.adapter, electionSlug: o.election, dryRun: !!o.dryRun },
      run.rosters,
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
