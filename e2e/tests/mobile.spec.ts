import { expect, test } from "@playwright/test";
import { seedDemoWorkspace, signIn, type DemoWorkspace } from "./support";

// Runs in the "mobile" project (375 × 812).
let ws: DemoWorkspace;
test.beforeAll(async () => {
  ws = await seedDemoWorkspace();
});

test("investigation pages fit a 375 px screen without horizontal scrolling", async ({ page }) => {
  await signIn(page, ws);
  const pages: [string, string][] = [
    [`/incidents/${ws.incidentId}`, "Discovery → Credential access from 10.0.0.66"],
    [`/incidents/${ws.incidentId}?tab=response`, "Discovery → Credential access from 10.0.0.66"],
    ["/assets/10.0.0.20", "10.0.0.20"],
    ["/identity", "Identity sources"],
    ["/validation", "Validation"],
    ["/alerts", "Alerts"],
  ];
  for (const [url, heading] of pages) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const overflow = await page.evaluate(() => {
      const main = document.querySelector("main");
      return {
        page: document.documentElement.scrollWidth - window.innerWidth,
        main: main ? main.scrollWidth - main.clientWidth : 0,
      };
    });
    expect(overflow, `horizontal overflow on ${url}`).toEqual({ page: 0, main: 0 });
  }
});

test("every page stays reachable from the mobile bottom bar", async ({ page }) => {
  await signIn(page, ws);
  const bar = page.getByRole("navigation", { name: "Main (mobile)" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "More pages" }).click();
  for (const name of ["Assets", "Rules", "Models", "Validation", "Datasets", "Identity sources", "Team", "Audit log", "Settings"]) {
    await expect(page.getByRole("menuitem", { name })).toBeVisible();
  }
  await page.getByRole("menuitem", { name: "Assets" }).click();
  await expect(page).toHaveURL(/\/assets$/);
  await expect(page.getByRole("heading", { level: 1, name: "Assets" })).toBeVisible();
});
