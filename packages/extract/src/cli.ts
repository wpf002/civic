import { Command } from "commander";

const program = new Command("civic-extract");
program
  .command("run")
  .option("--source <id>")
  .option("--candidate <id>")
  .option("--all-unprocessed")
  .action(async (o) => {
    console.log("TODO Phase 2: load sources, extractOnce x2, reconcile, write DRAFT positions + ReviewTasks", o);
  });
program.parseAsync();
