import { defineConfig } from "vitest/config";

/**
 * These suites share one Postgres. Run their files serially: in parallel, one
 * file's fixture rows are visible to another's assertions, which showed up as the
 * ballot-ordering contract test failing for reasons that had nothing to do with it.
 */
export default defineConfig({
  test: { fileParallelism: false, sequence: { concurrent: false } },
});
