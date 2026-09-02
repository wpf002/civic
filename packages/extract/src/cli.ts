import { Command } from "commander";
import { MODEL_A, MODEL_B } from "./llm.js";

const program = new Command("civic-extract");
program
  .command("run")
  .option("--source <id>")
  .option("--candidate <id>")
  .option("--all-unprocessed")
  .option("--model-a <id>", "first extractor model", MODEL_A)
  .option("--model-b <id>", "second, independent extractor model", MODEL_B)
  .action(async (o) => {
    console.log("TODO Phase 2: load sources, extractOnce x2, reconcile, write DRAFT positions + ReviewTasks", o);
  });
program.parseAsync();
