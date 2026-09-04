import { defineConfig } from "vitest/config";

/** Shares one Postgres with the other suites; run files serially. */
export default defineConfig({ test: { fileParallelism: false, sequence: { concurrent: false } } });
