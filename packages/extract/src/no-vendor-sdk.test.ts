import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const SEAM = "packages/extract/src/llm.ts";
const VENDOR = /@anthropic-ai\/|["'`]anthropic["'`]|openai|@google\/gen|@mistralai/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe("model seam", () => {
  // CLAUDE.md: all model calls go through packages/extract/src/llm.ts.
  // A vendor import anywhere else means provenance can be written by code that
  // never went through the refusal and cost accounting in the seam.
  it("is the only file importing an AI vendor SDK", () => {
    const offenders = sourceFiles(REPO)
      .filter((f) => !f.endsWith(SEAM.split("/").join("/")))
      .filter((f) => !f.endsWith("no-vendor-sdk.test.ts"))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return src.split("\n").some((l) => /^\s*(import|export).*from\s+["'].*["']/.test(l) && VENDOR.test(l));
      })
      .map((f) => f.slice(REPO.length + 1));

    expect(offenders).toEqual([]);
  });
});
