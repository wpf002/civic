import { Command } from "commander";

const program = new Command("civic-ingest");
program
  .command("candidates")
  .requiredOption("--adapter <name>")
  .requiredOption("--state <usps>")
  .option("--election <iso-date>")
  .action(async (o) => {
    console.log("TODO: run adapter", o);
  });
program
  .command("documents")
  .requiredOption("--adapter <name>")
  .option("--candidate <id>")
  .action(async (o) => {
    console.log("TODO: fetch, hash, archive, upsert Source rows", o);
  });
program.parseAsync();
