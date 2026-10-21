import { expect, test, type Page } from "@playwright/test";
import { seedDemoWorkspace, signIn, type DemoWorkspace } from "../tests/support";

// Screenshots for README.md, taken from the synthetic DEMO scenario (data/demo) imported through the
// API. No ML service runs here, so every alert comes from a rule and the model card says so.
const OUT = new URL("../../docs/screenshots/", import.meta.url);

let ws: DemoWorkspace;
test.beforeAll(async () => {
  ws = await seedDemoWorkspace({ name: "Sam Analyst", orgName: "Demo SOC (synthetic data)" });
});

async function shot(page: Page, name: string) {
  // Let charts and the graph finish their first layout; the app animates nothing else.
  await page.waitForTimeout(600);
  await page.screenshot({ path: new URL(`${name}.png`, OUT).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
}

test("capture the README screenshots", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/login");
  await shot(page, "01-sign-in");
  await signIn(page, ws);

  await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
  await expect(page.getByText("Flow volume")).toBeVisible();
  // The model card settles once the (absent) ML service has answered.
  await expect(page.getByText(/No active model|ML service unreachable/)).toBeVisible({ timeout: 30_000 });
  await shot(page, "02-command-center");

  await page.goto("/alerts");
  await page.getByRole("cell", { name: "SSHPatator", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "SSHPatator alert" }).getByRole("region", { name: "Observed" })).toBeVisible();
  await shot(page, "03-alert-evidence");

  await page.goto(`/incidents/${ws.incidentId}`);
  await expect(page.getByText("Grouped by Sentinel (hypothesis)")).toBeVisible();
  await shot(page, "04-incident");

  await page.goto(`/incidents/${ws.incidentId}?tab=graph`);
  await expect(page.getByRole("group", { name: /^Network graph:/ })).toBeVisible();
  await page.waitForTimeout(1200);
  await shot(page, "05-incident-graph");

  await page.goto("/reports");
  await page.getByRole("button", { name: "Span of stored flows" }).click();
  await expect(page.getByRole("table", { name: "Alerts by severity" })).toBeVisible();
  await shot(page, "06-executive-report");

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("10.0.0.6");
  await expect(page.getByRole("dialog")).toBeVisible();
  await shot(page, "07-command-palette");
  await page.keyboard.press("Escape");

  await page.goto("/settings");
  await page.getByLabel("Language").selectOption("fr");
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Centre de commande" })).toBeVisible();
  await expect(page.getByText(/Aucun modèle actif|Service ML injoignable/)).toBeVisible({ timeout: 30_000 });
  await shot(page, "08-command-center-fr");
  await page.goto("/settings");
  await page.getByLabel("Langue").selectOption("en");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  await page.getByLabel("Theme").selectOption("dark");
  await page.goto("/alerts");
  await expect(page.getByRole("cell", { name: "PortScan", exact: true })).toBeVisible();
  await shot(page, "09-alerts-dark");
});
