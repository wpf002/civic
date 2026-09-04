import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke suite. Assumes the API and web servers are already running — CI starts
 * them, and locally `pnpm dev` does. Mobile viewport by default because that is
 * the product.
 */
const PORT = process.env.PORT ?? "3007";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: process.env.CIVIC_BASE_URL ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
});
