import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Existence claims never come from a model.
 *
 * A model will produce plausible names for a District 7 field it has never seen, and
 * plausible is indistinguishable from correct until someone votes. Roster rows come
 * from a fetched artifact or from a human who read one. Models are for Position,
 * which is reviewed and quote-gated.
 *
 * Enforced the same way the vendor-SDK rule is: structurally, not by convention.
 */
const SRC = join(fileURLToPath(new URL(".", import.meta.url)));

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "__fixtures__") continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) tsFiles(full, acc);
    else if (/\.tsx?$/.test(e)) acc.push(full);
  }
  return acc;
}

describe("ingest cannot invent a candidate", () => {
  it("never imports the extraction package or an AI vendor SDK", () => {
    const offenders = tsFiles(SRC)
      .filter((f) => !f.endsWith("no-model-rosters.test.ts"))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return src
          .split("\n")
          .some(
            (l) =>
              /^\s*(import|export).*from\s+["']/.test(l) &&
              /@civic\/extract|@anthropic-ai\/|openai|@google\/gen/.test(l),
          );
      })
      .map((f) => f.slice(SRC.length));

    expect(offenders).toEqual([]);
  });
});
