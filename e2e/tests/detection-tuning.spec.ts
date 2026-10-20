import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedDemoWorkspace, signIn, type DemoWorkspace } from "./support";

let ws: DemoWorkspace;
test.beforeAll(async () => {
  ws = await seedDemoWorkspace();
});

test("an Owner tunes alert noise in Settings and the change persists", async ({ page }) => {
  await signIn(page, ws);
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Detection" }).click();

  const minConfidence = page.getByLabel("Minimum confidence in percent");
  await expect(minConfidence).toHaveValue("0");
  await expect(page.getByText("No trusted address yet.")).toBeVisible();

  await minConfidence.fill("70");
  await page.getByRole("button", { name: "Add an address or network" }).click();
  await page.getByLabel("Address or network 1").fill("10.0.0.5/24");
  await page.getByLabel("Reason 1").fill("Vulnerability scanner");
  await page.getByRole("button", { name: "Save detection settings" }).click();
  // Host bits outside the prefix are refused instead of guessed.
  await expect(page.getByText(/host bits must be zero/)).toBeVisible();

  await page.getByLabel("Address or network 1").fill("10.0.0.0/24");
  await page.getByRole("button", { name: "Save detection settings" }).click();
  await expect(page.getByText("Detection settings saved")).toBeVisible();
  await expect(page.getByText(/Added by Amira Analyst on/)).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  await page.reload();
  await page.getByRole("tab", { name: "Detection" }).click();
  await expect(page.getByLabel("Minimum confidence in percent")).toHaveValue("70");
  await expect(page.getByLabel("Address or network 1")).toHaveValue("10.0.0.0/24");

  await page.goto("/audit");
  await page.getByLabel("Action").selectOption("detection.settings_update");
  const row = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "detection.settings_update", exact: true }) });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Amira Analyst");
  await expect(row).toContainText('"allowlist":["10.0.0.0/24"]');
});
