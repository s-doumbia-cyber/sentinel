import { randomBytes } from "node:crypto";
import { expect, request, test } from "@playwright/test";
import { generate } from "otplib";
import { API_URL } from "./env";
import { signIn, type DemoWorkspace } from "./support";

/** A fresh Owner with an empty org (no demo data needed for team and account flows). */
async function newOwner(): Promise<DemoWorkspace> {
  const api = await request.newContext({ baseURL: `${API_URL}/` });
  const email = `owner-${randomBytes(4).toString("hex")}@example.com`;
  const password = `e2e-${randomBytes(12).toString("hex")}`;
  const res = await api.post("auth/register", { data: { name: "Omar Owner", email, password, orgName: "E2E Team" } });
  expect(res.ok()).toBeTruthy();
  await api.dispose();
  return { email, password, incidentId: "" };
}

test("an Owner invites an analyst, who joins with the link and turns on two-factor sign-in", async ({ page, browser }) => {
  const owner = await newOwner();
  await signIn(page, owner);
  await page.goto("/team");
  await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();

  const email = `analyst-${randomBytes(4).toString("hex")}@example.com`;
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Role", { exact: true }).selectOption("Analyst");
  await page.getByRole("button", { name: "Create link" }).click();
  const link = await page.getByLabel("Invitation link", { exact: true }).inputValue();
  expect(new URL(link).pathname).toBe("/accept-invite");
  expect(new URL(link).hash).toMatch(/^#[A-Za-z0-9_-]{43}$/);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("region", { name: "Invitations" }).getByText(email)).toBeVisible();

  // The invited person, in another browser profile.
  const guest = await browser.newContext();
  const p2 = await guest.newPage();
  await p2.goto(link);
  await expect(p2.getByRole("heading", { level: 1, name: "Join E2E Team" })).toBeVisible();
  await expect(p2.getByLabel("Email")).toHaveValue(email);
  const password = `e2e-${randomBytes(12).toString("hex")}`;
  await p2.getByLabel("Full name").fill("Ana Analyst");
  await p2.getByLabel("Password").fill(password);
  await p2.getByRole("button", { name: "Create account and join" }).click();
  await expect(p2).toHaveURL(/\/$/);

  // The same link cannot be used twice.
  const again = await browser.newContext();
  const p3 = await again.newPage();
  await p3.goto(link);
  await expect(p3.getByRole("heading", { level: 1, name: "Invitation unavailable" })).toBeVisible();
  await again.close();

  // Two-factor authentication from Settings → Security.
  await p2.goto("/settings");
  await p2.getByRole("tab", { name: "Security" }).click();
  await p2.getByRole("button", { name: "Turn on" }).click();
  const confirm = p2.getByRole("dialog");
  await confirm.getByLabel("Password").fill(password);
  await confirm.getByRole("button", { name: "Continue" }).click();
  const setup = p2.getByRole("dialog", { name: "Scan with your authenticator app" });
  await expect(setup.getByRole("img", { name: /QR code/ })).toBeVisible();
  const secret = ((await setup.locator("code").textContent()) ?? "").trim();
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
  await setup.getByLabel("Code from the app").fill(await generate({ secret }));
  await setup.getByRole("button", { name: "Turn on" }).click();
  const codes = p2.getByRole("dialog", { name: "Save your recovery codes" });
  await expect(codes.getByRole("list", { name: "Recovery codes" }).getByRole("listitem")).toHaveCount(10);
  await codes.getByRole("button", { name: "I saved them" }).click();
  await expect(p2.getByText("On since")).toBeVisible();
  await guest.close();

  // Signing in now takes a second step; the code from the next 30 s window is accepted.
  const later = await browser.newContext();
  const p4 = await later.newPage();
  await p4.goto("/login");
  await p4.getByLabel("Email").fill(email);
  await p4.getByLabel("Password", { exact: true }).fill(password);
  await p4.getByRole("button", { name: "Sign in" }).click();
  await expect(p4.getByRole("heading", { level: 1, name: "Two-factor check" })).toBeVisible();
  await p4.getByLabel("Authentication code").fill(await generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 }));
  await p4.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(p4).toHaveURL(/\/$/);
  await later.close();

  // The Owner sees the new member, with the 2FA badge.
  await page.reload();
  const row = page.getByRole("row", { name: /Ana Analyst/ });
  await expect(row.getByText("2FA")).toBeVisible();
});

test("the System page shows health, jobs and retention to an Owner", async ({ page }) => {
  const owner = await newOwner();
  await signIn(page, owner);
  await page.goto("/system");
  await expect(page.getByRole("heading", { level: 1, name: "System" })).toBeVisible();
  await expect(page.getByText("In-process (jobs do not survive a restart)")).toBeVisible();
  await expect(page.getByText("No failed jobs")).toBeVisible();
  await expect(page.getByText("Keep everything (no automatic purge)")).toBeVisible();
  await page.getByLabel("Retention period (days)").fill("90");
  await page.getByRole("button", { name: "Preview (dry run)" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Nothing was deleted" })).toBeVisible();
});
