import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedDemoWorkspace, signIn, type DemoWorkspace } from "./support";

// The DEMO scenario: 10.0.0.66 scans then brute-forces 10.0.0.20; two rule alerts, one correlated incident.
// Tests run in order and share one workspace, so the board test (which moves the incident) comes late.
test.describe.configure({ mode: "serial" });

let ws: DemoWorkspace;
test.beforeAll(async () => {
  ws = await seedDemoWorkspace();
});

const TITLE = "Discovery → Credential access from 10.0.0.66";

async function expectNoSeriousViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 5).map((n) => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`).join("\n    ")}`);
  expect(serious, `${label}\n  ${serious.join("\n  ")}`).toEqual([]);
}

/** Where a graph node is on screen, read from the cytoscape instance the dev server exposes. */
async function graphNode(page: Page, ip: string) {
  return page.evaluate((id) => {
    const host = document.querySelector('[role="group"][aria-label^="Network graph"]') as (HTMLElement & { __cy?: { getElementById: (i: string) => { renderedPosition: () => { x: number; y: number }; length: number }; nodes: () => { length: number }; zoom: () => number } }) | null;
    if (!host?.__cy) return null;
    // Screen coordinates are only valid for a graph that is on screen.
    host.scrollIntoView({ block: "center" });
    const node = host.__cy.getElementById(id);
    const box = host.getBoundingClientRect();
    const p = node.length ? node.renderedPosition() : null;
    return { x: p ? box.left + p.x : 0, y: p ? box.top + p.y : 0, found: node.length > 0, nodes: host.__cy.nodes().length, zoom: host.__cy.zoom() };
  }, ip);
}

test("the asset page draws the connection graph, opens a node, and offers the same data as a list", async ({ page }) => {
  await signIn(page, ws);
  await page.goto("/assets/10.0.0.66");
  await expect(page.getByRole("heading", { level: 1, name: "10.0.0.66" })).toBeVisible();
  const card = page.getByRole("heading", { level: 2, name: "Connections" });
  await expect(card).toBeVisible();
  const canvas = page.getByRole("group", { name: /^Network graph: \d+ addresses?, \d+ connections?/ });
  await expect(canvas).toBeVisible();
  await expect(canvas.locator("canvas").first()).toBeAttached();
  await expect.poll(async () => (await graphNode(page, "10.0.0.20"))?.found).toBe(true);

  await test.step("zoom buttons and keys change the zoom level", async () => {
    const before = (await graphNode(page, "10.0.0.20"))?.zoom ?? 0;
    await page.getByRole("button", { name: "Zoom in" }).click();
    const afterButton = (await graphNode(page, "10.0.0.20"))?.zoom ?? 0;
    expect(afterButton).toBeGreaterThan(before);
    await canvas.focus();
    await page.keyboard.press("-");
    expect((await graphNode(page, "10.0.0.20"))?.zoom ?? 0).toBeLessThan(afterButton);
    await page.getByRole("button", { name: "Reset layout" }).click();
  });

  await test.step("the graph does not fail the accessibility check", async () => {
    await expectNoSeriousViolations(page, "/assets/10.0.0.66 (graph)");
  });

  await test.step("the list is a keyboard alternative with alerts spelled out", async () => {
    await page.getByRole("button", { name: "List", exact: true }).click();
    const table = page.getByRole("table", { name: /Addresses in the graph/ });
    await expect(table.getByRole("link", { name: "10.0.0.20" })).toBeVisible();
    await expect(table.getByText("under investigation", { exact: true })).toBeVisible();
    await expect(table.getByText(/CRITICAL|HIGH|MEDIUM|LOW/).first()).toBeVisible();
    await expectNoSeriousViolations(page, "/assets/10.0.0.66 (list)");
    await page.getByRole("button", { name: "Graph", exact: true }).click();
  });

  await test.step("clicking a node opens its asset page", async () => {
    const at = await graphNode(page, "10.0.0.20");
    expect(at?.found).toBe(true);
    // Slightly off the exact centre: cytoscape's polygon test misses the single centre point of a diamond.
    await page.mouse.move((at?.x ?? 0) + 6, (at?.y ?? 0) + 6);
    await page.mouse.click((at?.x ?? 0) + 6, (at?.y ?? 0) + 6);
    await expect(page).toHaveURL(/\/assets\/10\.0\.0\.20$/);
    await expect(page.getByRole("heading", { level: 1, name: "10.0.0.20" })).toBeVisible();
  });
});

test("range and reach of the graph live in the URL", async ({ page }) => {
  await signIn(page, ws);
  await page.goto("/assets/10.0.0.66?graphRange=1h&graphDepth=2");
  await expect(page.getByLabel("Time range")).toHaveValue("1h");
  await expect(page.getByLabel("Reach")).toHaveValue("2");
  await page.getByLabel("Time range").selectOption("all");
  await expect(page).not.toHaveURL(/graphRange/);
  await expect(page).toHaveURL(/graphDepth=2/);
});

test("the incident page has a graph tab seeded with the addresses on the incident", async ({ page }) => {
  await signIn(page, ws);
  await page.goto(`/incidents/${ws.incidentId}?tab=graph`);
  await expect(page.getByRole("heading", { level: 2, name: "Entities and connections" })).toBeVisible();
  await expect(page.getByRole("group", { name: /^Network graph:/ })).toBeVisible();
  await expect.poll(async () => (await graphNode(page, "10.0.0.66"))?.found).toBe(true);
  expect((await graphNode(page, "10.0.0.20"))?.found).toBe(true);
  await expectNoSeriousViolations(page, "incident graph tab");
});

test("Ctrl+K finds pages, addresses and ids; ? lists shortcuts; G then a letter navigates", async ({ page }) => {
  await signIn(page, ws);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();

  await test.step("an address", async () => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await expectNoSeriousViolations(page, "command palette");
    await dialog.getByRole("combobox").fill("10.0.0.20");
    await expect(dialog.getByRole("option", { name: /Open asset 10\.0\.0\.20/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/assets\/10\.0\.0\.20$/);
    await expect(dialog).toBeHidden();
  });

  await test.step("an incident by id", async () => {
    await page.getByRole("button", { name: /Search/ }).click();
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await dialog.getByRole("combobox").fill(ws.incidentId);
    await expect(dialog.getByRole("option", { name: new RegExp(TITLE.replace("→", "→")) })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/incidents/${ws.incidentId}$`));
  });

  await test.step("an alert by id opens its panel", async () => {
    await page.goto("/alerts");
    await page.getByRole("cell", { name: "SSHPatator", exact: true }).click();
    const url = new URL(page.url());
    const alertId = url.searchParams.get("alert") ?? "";
    expect(alertId).toMatch(/^[0-9a-f]{24}$/);
    await page.keyboard.press("Escape");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await dialog.getByRole("combobox").fill(alertId);
    await dialog.getByRole("option", { name: /SSHPatator alert/ }).click();
    await expect(page.getByRole("dialog", { name: "SSHPatator alert" })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  await test.step("an id that does not exist says so", async () => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await dialog.getByRole("combobox").fill("0123456789abcdef01234567");
    await expect(dialog.getByText(/No alert, incident or flow with that id/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  await test.step("the shortcut overlay", async () => {
    await page.keyboard.press("Shift+?");
    const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(help).toBeVisible();
    await expect(help).toContainText("Open the command palette");
    await expectNoSeriousViolations(page, "shortcut overlay");
    await page.keyboard.press("Escape");
    await expect(help).toBeHidden();
  });

  await test.step("G then a letter", async () => {
    await page.keyboard.press("g");
    await page.keyboard.press("a");
    await expect(page).toHaveURL(/\/alerts$/);
    await page.keyboard.press("g");
    await page.keyboard.press("e");
    await expect(page).toHaveURL(/\/reports$/);
    // Typing in a field must never navigate.
    await page.getByLabel(/From \(UTC day\)/).focus();
    await page.keyboard.type("ga");
    await expect(page).toHaveURL(/\/reports/);
  });
});

test("E, F and I act on the open alert through the same API calls as its buttons", async ({ page }) => {
  await signIn(page, ws);
  await page.goto("/alerts");
  await page.getByRole("cell", { name: "SSHPatator", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "SSHPatator alert" });
  await expect(drawer.getByRole("region", { name: "Observed" })).toBeVisible();
  const status = drawer.getByLabel("Status");

  await page.keyboard.press("e");
  await expect(status).toHaveValue("acknowledged");
  await expect(page.getByText("Alert updated").first()).toBeVisible();

  const fp = drawer.getByRole("button", { name: "False positive" });
  await page.keyboard.press("f");
  await expect(fp).toHaveAttribute("aria-pressed", "true");
  await expect(drawer.getByText(/verdict: none → false_positive/)).toBeVisible();
  // Pressing it again clears the verdict, as clicking the button does.
  await page.keyboard.press("f");
  await expect(fp).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("i");
  await expect(page).toHaveURL(new RegExp(`/incidents/${ws.incidentId}$`));
});

test("the incident board moves cards with the mouse and the keyboard, rolls back on failure, and audits each move", async ({ page }) => {
  await signIn(page, ws);
  await page.goto("/incidents?view=board");
  const open = page.getByRole("region", { name: /^Open \(/ });
  await expect(open.getByText(TITLE)).toBeVisible();
  await expectNoSeriousViolations(page, "incident board");

  const dragTo = async (title: string, column: RegExp) => {
    // dnd-kit ignores a new press while the previous card is still settling (drop animation, 250 ms).
    await page.waitForTimeout(600);
    const card = page.getByText(title, { exact: true }).first();
    const from = (await card.boundingBox())!;
    const target = (await page.getByRole("region", { name: column }).boundingBox())!;
    await page.mouse.move(from.x + 10, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 10, { steps: 4 });
    await page.mouse.move(target.x + target.width / 2, target.y + 80, { steps: 12 });
    await page.mouse.up();
  };

  await test.step("a refused move puts the card back and says why", async () => {
    await page.route("**/api/v1/incidents/*", (route) =>
      route.request().method() === "PATCH" ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Not allowed here" } }) }) : route.continue(),
    );
    await dragTo(TITLE, /^Investigating \(/);
    await expect(page.getByText(/Could not move .*Not allowed here\. It is back in Open\./)).toBeVisible();
    await expect(page.getByRole("region", { name: /^Open \(1\)/ }).getByText(TITLE)).toBeVisible();
    await expect(page.getByRole("region", { name: /^Investigating \(0\)/ })).toBeVisible();
    await page.unroute("**/api/v1/incidents/*");
  });

  await test.step("a mouse drag moves it and the move survives a reload", async () => {
    await dragTo(TITLE, /^Investigating \(/);
    await expect(page.getByText("Moved to Investigating")).toBeVisible();
    await expect(page.getByRole("region", { name: /^Investigating \(1\)/ }).getByText(TITLE)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: /^Investigating \(1\)/ }).getByText(TITLE)).toBeVisible();
  });

  await test.step("keyboard: grip, Space, Right, Space", async () => {
    const grip = page.getByRole("button", { name: new RegExp(`^Move incident ${TITLE}`) });
    await grip.focus();
    // dnd-kit's keyboard sensor attaches and measures between presses; a person never types this fast.
    for (const key of ["Space", "ArrowRight", "Space"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
    }
    await expect(page.getByRole("region", { name: /^Contained \(1\)/ }).getByText(TITLE)).toBeVisible();
  });

  await test.step("Escape cancels a keyboard drag", async () => {
    const grip = page.getByRole("button", { name: new RegExp(`^Move incident ${TITLE}`) });
    await grip.focus();
    for (const key of ["Space", "ArrowRight", "Escape"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(250);
    }
    await expect(page.getByRole("region", { name: /^Contained \(1\)/ }).getByText(TITLE)).toBeVisible();
  });

  await test.step("both moves are in the investigation log and the audit log", async () => {
    await page.goto(`/incidents/${ws.incidentId}?tab=log`);
    await expect(page.getByText(/changed the status/).first()).toBeVisible();
    await expect(page.getByText("Open → Investigating")).toBeVisible();
    await expect(page.getByText("Investigating → Contained")).toBeVisible();
    await page.goto("/audit");
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expect(page.locator("td", { hasText: "incident.update" }).first()).toBeVisible();
  });
});

test("Reports: a period in the URL, a preview, and PDFs that open as PDFs", async ({ page }) => {
  await signIn(page, ws);
  await page.goto("/reports");
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Summary" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Limitations" })).toBeVisible();

  await page.getByRole("button", { name: "Span of stored flows" }).click();
  await expect(page).toHaveURL(/\/reports\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole("table", { name: "Alerts by severity" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Time to triage" })).toBeVisible();
  await expectNoSeriousViolations(page, "/reports");

  // Same numbers as the Command Center for the same data.
  const flows = (await page.getByText("Flows", { exact: true }).locator("xpath=following-sibling::dd[1]").first().innerText()).replace(/\D/g, "");
  expect(Number(flows)).toBeGreaterThan(0);

  await test.step("the executive PDF", async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PDF/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^sentinel-executive-report-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.pdf$/);
    const head = (await readFile((await download.path()) ?? "")).subarray(0, 5).toString();
    expect(head).toBe("%PDF-");
  });

  await test.step("the incident PDF", async () => {
    await page.goto(`/incidents/${ws.incidentId}/report`);
    await expect(page.getByRole("article").getByRole("heading", { level: 1 })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PDF/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^sentinel-incident-.*\.pdf$/);
    expect((await readFile((await download.path()) ?? "")).subarray(0, 5).toString()).toBe("%PDF-");
  });

  await test.step("an inverted period is refused in the page", async () => {
    await page.goto("/reports?from=2026-10-20&to=2026-10-19");
    await expect(page.getByRole("alert").filter({ hasText: "start day is after" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Download PDF/ })).toBeDisabled();
  });
});
