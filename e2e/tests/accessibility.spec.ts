import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedDemoWorkspace, signIn, type DemoWorkspace } from "./support";

let ws: DemoWorkspace;
test.beforeAll(async () => {
  ws = await seedDemoWorkspace();
});

/** Fails on serious or critical WCAG 2.1 A/AA violations, listing each rule and the nodes involved. */
async function expectNoSeriousViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`).join("\n    ")}`);
  expect(serious, `${label}\n  ${serious.join("\n  ")}`).toEqual([]);
}

// Each page is checked once its real content has loaded, not while skeletons are showing.
const pages: { path: (id: string) => string; ready: string | RegExp }[] = [
  { path: () => "/", ready: "Command Center" },
  { path: () => "/alerts", ready: "Alerts" },
  { path: (id) => `/incidents/${id}`, ready: "Discovery → Credential access from 10.0.0.66" },
  { path: (id) => `/incidents/${id}?tab=timeline`, ready: "Discovery → Credential access from 10.0.0.66" },
  { path: (id) => `/incidents/${id}?tab=response`, ready: "Discovery → Credential access from 10.0.0.66" },
  { path: (id) => `/incidents/${id}?tab=log`, ready: "Discovery → Credential access from 10.0.0.66" },
  { path: () => "/assets", ready: "Assets" },
  { path: () => "/assets/10.0.0.20", ready: "10.0.0.20" },
  { path: () => "/identity", ready: "Identity sources" },
  { path: () => "/validation", ready: "Validation" },
  { path: () => "/rules", ready: "Rules" },
  { path: () => "/models", ready: "Models" },
  { path: () => "/datasets", ready: "Datasets" },
  { path: () => "/flows", ready: "Flows" },
  { path: () => "/team", ready: "Team" },
  { path: () => "/audit", ready: "Audit log" },
  { path: () => "/settings", ready: "Settings" },
];

test("the sign-in page has no serious accessibility violations", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expectNoSeriousViolations(page, "/login");
});

test("key pages have no serious accessibility violations", async ({ page }) => {
  await signIn(page, ws);
  for (const p of pages) {
    const url = p.path(ws.incidentId);
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: p.ready })).toBeVisible();
    await expect(page.locator('[role="status"][aria-label^="Loading"]')).toHaveCount(0);
    await expectNoSeriousViolations(page, url);
  }
});

test("the dark theme keeps the same guarantees", async ({ page }) => {
  await signIn(page, ws);
  for (const p of pages.slice(0, 10)) {
    const url = p.path(ws.incidentId);
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: p.ready })).toBeVisible();
    // Same switch the theme setting applies; not persisted, so other tests keep the light default.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(22, 24, 22)");
    // Let colour transitions (≤ 320 ms) settle before measuring contrast.
    await page.waitForTimeout(400);
    await expectNoSeriousViolations(page, `${url} (dark)`);
  }
});

test("the alert drawer and the report have no serious accessibility violations", async ({ page }) => {
  await signIn(page, ws);
  await page.goto("/alerts");
  await page.getByRole("cell", { name: "SSHPatator", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "SSHPatator alert" }).getByRole("region", { name: "Observed" })).toBeVisible();
  await expectNoSeriousViolations(page, "alert drawer");

  await page.goto(`/incidents/${ws.incidentId}/report`);
  await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoSeriousViolations(page, "incident report");
});
