import { Command } from "commander";
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

program.parseAsync();
