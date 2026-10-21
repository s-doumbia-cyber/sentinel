import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedDemoWorkspace, signIn, type DemoWorkspace } from "./support";

let ws: DemoWorkspace;
test.beforeAll(async () => {
  ws = await seedDemoWorkspace();
});

test("choosing French in Settings translates the interface and follows the account", async ({ page }) => {
  await signIn(page, ws);
  await page.goto("/settings");
  await page.getByLabel("Language").selectOption("fr");

  await expect(page.getByRole("heading", { level: 1, name: "Paramètres" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  const nav = page.getByRole("navigation", { name: "Navigation principale" });
  await expect(nav.getByRole("link", { name: "Alertes" })).toBeVisible();
  // Pages not translated yet say so instead of pretending.
  await expect(page.getByText(/Les autres pages restent en anglais/)).toBeVisible();

  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);

  // Saved on the account: a reload (new session restore) keeps French.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Centre de commande" })).toBeVisible();

  // Back to English so the workspace is left as found.
  await page.goto("/settings");
  await page.getByLabel("Langue").selectOption("en");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});
