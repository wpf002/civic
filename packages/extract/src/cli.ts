import { Command } from "commander";
import { prisma } from "@civic/db";
import { MODEL_A, MODEL_B } from "./llm.js";
import { runExtraction } from "./pipeline-db.js";

const program = new Command("civic-extract");

program
  .command("run")
  .description("Extract positions from archived sources. Writes DRAFTs; publishes nothing.")
  .option("--source <id>")
  .option("--candidate <slug>")
  .option("--limit <n>", "cap sources processed", (v) => Number(v))
  .option("--model-a <id>", "first extractor model", MODEL_A)
  .option("--model-b <id>", "second, independent extractor model", MODEL_B)
  .option("--dry-run", "report what would happen and write nothing")
  .action(async (o) => {
    const report = await runExtraction({
      ...(o.source ? { sourceId: o.source } : {}),
      ...(o.candidate ? { candidateSlug: o.candidate } : {}),
      ...(o.limit ? { limit: o.limit } : {}),
      modelA: o.modelA,
      modelB: o.modelB,
      dryRun: !!o.dryRun,
    });

    for (const d of report.details) {
      console.log(`\n${d.candidate ?? "(unlinked)"} — ${d.sourceUrl}`);
      if (d.error) console.log(`  ERROR ${d.error}`);
      if (d.agreed.length) console.log(`  draft:   ${d.agreed.join(", ")}`);
      if (d.flagged.length) console.log(`  review:  ${d.flagged.join(", ")}`);
      if (d.rejected.length) console.log(`  dropped: ${d.rejected.join(", ")}`);
    }

    console.log(
      `\n${report.sources} sources · ${report.drafts} drafts · ${report.flagged} to review · ` +
        `${report.rejectedQuotes} quotes dropped · ${report.refusals} refusals · ` +
        `${report.costCents.toFixed(2)}c` + (o.dryRun ? "  (dry run, nothing written)" : ""),
    );
    await prisma.$disconnect();
  });

program.parseAsync();
