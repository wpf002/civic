import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Click a control on a client component and wait for it to take effect.
 *
 * A click issued before React hydrates lands on server-rendered markup and does
 * nothing, silently. Retrying until the expected element appears is the honest fix;
 * an arbitrary sleep is not.
 */
async function clickUntil(page: Page, button: Locator, appears: Locator, tries = 8) {
  for (let i = 0; i < tries; i++) {
    await button.click();
    try {
      await appears.waitFor({ state: "visible", timeout: 1500 });
      return;
    } catch {
      if (i === tries - 1) throw new Error("control never took effect — is the page hydrating?");
    }
  }
}

const ELECTION = "2027-11-dallas";

test("the honesty frame is above the fold, not in a footer", async ({ page }) => {
  await page.goto("/");
  const frame = page.locator("main");
  await expect(frame).toContainText("Civic does not tell you how to vote");
  await expect(frame).toContainText("If a candidate hasn't said, we say so");
  // Above the address input, the way Wahl-O-Mat places its disclaimer.
  // The same sentence also appears in the footer, so scope to the frame block.
  const disclaimerY = (await frame
    .getByText("Civic does not tell you how to vote.", { exact: true })
    .boundingBox())!.y;
  const inputY = (await page.locator("#address").boundingBox())!.y;
  expect(disclaimerY).toBeLessThan(inputY);
});

test("issue → candidate → source, in three taps", async ({ page }) => {
  await page.goto(`/e/${ELECTION}`);
  await expect(page.getByRole("heading", { name: /Dallas Municipal Election/ })).toBeVisible();

  await page.getByRole("link", { name: "Housing & Cost of Living" }).click();
  await expect(page).toHaveURL(/\/i\/housing-cost-of-living$/);

  // Ballot order is disclosed, and the page says so.
  await expect(page.getByText("Ballot order · Not ranked")).toBeVisible();

  // A stance carries its source one tap away.
  const evidence = page.locator("figure").first();
  await expect(evidence).toBeVisible();
  await expect(evidence.locator("mark")).toBeVisible();
  await expect(evidence.getByRole("link", { name: /↗/ })).toBeVisible();
});

test("silence renders as a finding, not a blank", async ({ page }) => {
  await page.goto(`/e/${ELECTION}/i/housing-cost-of-living`);
  const silent = page.getByText(/has not stated a position on housing/).first();
  await expect(silent).toBeVisible();

  // It is not greyed or shrunk: same size as body text.
  const size = await silent.evaluate((el) => getComputedStyle(el).fontSize);
  expect(parseFloat(size)).toBeGreaterThanOrEqual(16);

  // And it is accompanied by what we read.
  await expect(page.getByText(/We read \d+ source/).first()).toBeVisible();
});

test("a candidate with no sources says it is our gap, not their silence", async ({ page }) => {
  await page.goto("/c/roy-castellanos");
  await expect(
    page.getByText(/That is a gap in our coverage, not a statement about the candidate/).first(),
  ).toBeVisible();
});

test("coverage is stated before any position", async ({ page }) => {
  await page.goto("/c/marisela-ochoa");
  const meter = page.getByText(/We found positions on \d+ of the \d+ issues/);
  await expect(meter).toBeVisible();
  const meterY = (await meter.boundingBox())!.y;
  const firstStance = page.getByText(/Strongly supports|Supports|Opposes|Mixed/).first();
  expect(meterY).toBeLessThan((await firstStance.boundingBox())!.y);
});

test("the quiz scores on the device and never posts answers", async ({ page }) => {
  const posted: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posted.push(r.url());
  });

  await page.goto(`/e/${ELECTION}/quiz`);
  await expect(page.getByText("This is not a voting recommendation.")).toBeVisible();

  // Wait for hydration before driving the client component, or the first click
  // lands on server-rendered markup and silently does nothing.
  await clickUntil(page, page.getByRole("button", { name: "Start" }), page.locator("#q"));

  for (let i = 0; i < 20; i++) {
    await page.getByRole("button", { name: "Strongly agree" }).click();
    const next = page.getByRole("button", { name: /^Next/ });
    const label = (await next.textContent()) ?? "";
    await next.click();
    if (label.includes("what matters most")) break;
    await expect(page.locator("#q")).toBeVisible();
  }

  await expect(page.getByRole("heading", { name: /matter most/ })).toBeVisible();
  await page.getByRole("button", { name: "See results" }).click();

  await expect(page.getByRole("heading", { name: /Closest to your answers|Tied at the top/ })).toBeVisible();
  await expect(page.getByText(/computed on your device/)).toBeVisible();
  // Nothing was posted anywhere. This is the privacy claim, tested.
  expect(posted).toEqual([]);
});

test("the admin console is gated", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByLabel("Admin token")).toBeVisible();
  await expect(page.getByText(/not real authentication/)).toBeVisible();
});

test("methodology publishes an explicit AI policy", async ({ page }) => {
  await page.goto("/methodology");
  await expect(page.getByRole("heading", { name: "Our AI policy" })).toBeVisible();
  await expect(page.getByText(/Two different models read each source independently/)).toBeVisible();
});

test("no horizontal scroll on a phone", async ({ page }) => {
  for (const path of ["/", `/e/${ELECTION}`, `/e/${ELECTION}/i/housing-cost-of-living`, "/c/june-halvorsen"]) {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow on ${path}`).toBe(false);
  }
});
