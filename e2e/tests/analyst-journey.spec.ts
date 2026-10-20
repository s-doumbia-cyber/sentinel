import { expect, test } from "@playwright/test";
import { seedDemoWorkspace, signIn, type DemoWorkspace } from "./support";

// The synthetic DEMO scenario: a port scan, then an SSH brute force from 10.0.0.66 against
// 10.0.0.20, with DHCP records for both hosts. No ML service runs: every alert comes from a rule.
let ws: DemoWorkspace;
test.beforeAll(async () => {
  ws = await seedDemoWorkspace();
});

test("analyst goes from an alert to a reported incident, and every step is recorded", async ({ page }) => {
  await signIn(page, ws);

  await test.step("tokens never reach web storage", async () => {
    const stored = await page.evaluate(() => {
      const dump = (s: Storage) => Array.from({ length: s.length }, (_, i) => `${s.key(i)}=${s.getItem(s.key(i) ?? "")}`);
      return [...dump(localStorage), ...dump(sessionStorage)];
    });
    for (const entry of stored) {
      expect(entry).not.toMatch(/token/i);
      expect(entry).not.toMatch(/eyJ[\w-]+\.[\w-]+\./); // a JWT
    }
    const refresh = (await page.context().cookies()).find((c) => c.name === "sentinel_rt");
    expect(refresh, "refresh cookie set at sign-in").toBeDefined();
    expect(refresh).toMatchObject({ httpOnly: true, secure: true, sameSite: "Strict" });
  });

  await test.step("the rule alerts are in the queue", async () => {
    await page.goto("/alerts");
    await expect(page.getByRole("cell", { name: "PortScan", exact: true })).toBeVisible();
    await page.getByRole("cell", { name: "SSHPatator", exact: true }).click();
  });

  const drawer = page.getByRole("dialog", { name: "SSHPatator alert" });
  await test.step("the alert separates observed, inferred and unknown", async () => {
    await expect(drawer.getByRole("region", { name: "Observed" })).toContainText("R-BRUTEFORCE-SSH-01");
    await expect(drawer.getByRole("region", { name: "Observed" })).toContainText("used for evaluation only, never for the verdict");
    await expect(drawer.getByRole("region", { name: "Inferred" })).toContainText("resembles SSHPatator");
    await expect(drawer.getByRole("region", { name: "Unknown" })).toContainText("Whether the attempt succeeded");
  });

  await test.step("attribution comes from the imported DHCP record, with its limits", async () => {
    await expect(drawer.getByText("medium confidence", { exact: true })).toBeVisible();
    await expect(drawer.getByText(/DHCP lease log · valid/)).toBeVisible();
    await expect(drawer.getByText(/An IP address alone does not identify a person/)).toBeVisible();
    await expect(drawer.getByText(/Several identities held this address/)).toHaveCount(0);
  });

  await test.step("triage is recorded in the alert history", async () => {
    await expect(drawer.getByText(/No analyst change yet/)).toBeVisible();
    await drawer.getByRole("button", { name: "True positive" }).click();
    await expect(drawer.getByRole("button", { name: "True positive" })).toHaveAttribute("aria-pressed", "true");
    await expect(drawer.getByText(/verdict: none → true_positive/)).toBeVisible();
  });

  await test.step("the alert belongs to a correlated incident labelled a hypothesis", async () => {
    await drawer.getByRole("link", { name: "Discovery → Credential access from 10.0.0.66" }).click();
    await expect(page).toHaveURL(new RegExp(`/incidents/${ws.incidentId}`));
    await expect(page.getByRole("heading", { level: 1, name: "Discovery → Credential access from 10.0.0.66" })).toBeVisible();
    await expect(page.getByText("Grouped by Sentinel (hypothesis)")).toBeVisible();
    await expect(page.getByText(/Grouping is a hypothesis to verify, not proof/)).toBeVisible();
  });

  await test.step("the attack timeline separates facts from hypotheses", async () => {
    await page.getByRole("tab", { name: "Attack timeline" }).click();
    await expect(page.getByText(/Sentinel raised a low PortScan alert for 10\.0\.0\.66/)).toBeVisible();
    await expect(page.getByText(/Sentinel raised a medium SSHPatator alert for 10\.0\.0\.66 → 10\.0\.0\.20 \(1 piece of evidence\)/)).toBeVisible();
    await expect(page.getByText("Possible progression: Discovery → Credential access.")).toBeVisible();
    await expect(page.getByText(/MITRE ATT&CK labels are suggested context, not proof/)).toBeVisible();
  });

  await test.step("response is simulated, never applied", async () => {
    await page.getByRole("tab", { name: "Response" }).click();
    await expect(page.getByText(/Sentinel has no enforcement integration/)).toBeVisible();
    const address = page.getByRole("checkbox", { name: /10\.0\.0\.66/ });
    // Internal addresses are not pre-selected: blocking one can cut off a legitimate host.
    await expect(address).not.toBeChecked();
    const generate = page.getByRole("button", { name: "Generate simulation" });
    await expect(generate).toBeDisabled();
    await address.check();
    await generate.click();
    await expect(page.getByText(/Simulation only: review and apply it yourself/)).toBeVisible();
    await expect(page.getByText(/10\.0\.0\.66 is an internal address/)).toBeVisible();
    await expect(page.getByLabel("Generated blocklist (not applied)")).toContainText("-s 10.0.0.66 -j DROP");
  });

  await test.step("the report states facts, hypotheses, identity and what Sentinel did not do", async () => {
    await page.getByRole("link", { name: "Report" }).click();
    await expect(page).toHaveURL(new RegExp(`/incidents/${ws.incidentId}/report`));
    const report = page.getByRole("article");
    await expect(report.getByRole("heading", { level: 1 })).toHaveText("Discovery → Credential access from 10.0.0.66");
    await expect(report.getByText(/UNMANAGED-66 \(DHCP lease log, medium confidence\)/)).toBeVisible();
    await expect(report.getByText("Sentinel did not block, isolate or change anything.", { exact: false })).toBeVisible();
    await expect(report.getByText("1 blocklist simulation(s) generated; none applied by Sentinel.")).toBeVisible();
    await expect(report.getByText(/Analyst verdict: true positive/)).toBeVisible();
  });

  await test.step("the investigation log lists who did what", async () => {
    await page.getByRole("link", { name: "Back to the incident" }).click();
    await page.getByRole("tab", { name: "Investigation log" }).click();
    await expect(page.getByText("Sentinel grouped alerts into this incident")).toBeVisible();
    await expect(page.getByText("Amira Analyst generated a blocklist simulation")).toBeVisible();
    await expect(page.getByText(/iptables for 10\.0\.0\.66 · not applied/)).toBeVisible();
    await expect(page.getByText("Amira Analyst generated a report")).toBeVisible();
  });

  await test.step("the trace links ingestion, detection, triage, response and report", async () => {
    await page.getByRole("tab", { name: "Trace" }).click();
    await expect(page.getByText(/Imported demo-scenario-flows\.csv: 585 flows tagged IMPORTED, sha256 [0-9a-f]{16}…/)).toBeVisible();
    await expect(page.getByText(/Raised a medium SSHPatator alert for 10\.0\.0\.66 → 10\.0\.0\.20 from rule R-BRUTEFORCE-SSH-01/)).toBeVisible();
    await expect(page.getByText(/Triaged the SSHPatator alert: .*verdict none → true_positive/)).toBeVisible();
    await expect(page.getByText(/Generated a blocklist simulation \(iptables\) for 10\.0\.0\.66; not applied/)).toBeVisible();
    await expect(page.getByText("Generated the incident report.")).toBeVisible();
    await expect(page.getByText(/Imported identity records demo-identity\.csv/)).toBeVisible();
  });

  await test.step("an account or device lookup shows the addresses it held and alerts in those windows", async () => {
    await page.goto("/identity?lookup=UNMANAGED-66");
    const held = page.getByRole("region", { name: "Addresses held" });
    await expect(held.getByRole("link", { name: "10.0.0.66" })).toBeVisible();
    await expect(held.getByRole("link", { name: "SSHPatator" })).toBeVisible();
    await expect(page.getByText(/not necessarily this account/)).toBeVisible();
  });

  await test.step("the asset keeps a history without scan noise", async () => {
    await page.goto("/assets/10.0.0.20");
    const history = page.locator("section").filter({ has: page.getByRole("heading", { name: "History", exact: true }) });
    await expect(history.getByText("First observed")).toBeVisible();
    await expect(history.getByText(/accepted TCP\/445, TCP\/22; estimated File-sharing host \(SMB\)/)).toBeVisible();
    await page.getByText("All identity records for this address").click();
    await expect(page.getByText("SRV-FILES-01").last()).toBeVisible();
  });
});
