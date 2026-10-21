import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, request, type APIRequestContext, type Page } from "@playwright/test";
import { API_URL } from "./env";

const DEMO_DIR = new URL("../../data/demo/", import.meta.url);

export interface DemoWorkspace {
  email: string;
  password: string;
  incidentId: string;
}

async function json<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} -> ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

/**
 * Registers a throwaway user (with its own org) on the e2e API and loads the synthetic DEMO
 * scenario through the same endpoints the UI uses: flows CSV, then identity records. Waits until
 * the rules have raised their two alerts and Sentinel has grouped them into one incident.
 */
export async function seedDemoWorkspace(who: { name?: string; orgName?: string } = {}): Promise<DemoWorkspace> {
  const api = await request.newContext({ baseURL: `${API_URL}/` });
  const email = `e2e-${randomBytes(4).toString("hex")}@example.com`;
  const password = `e2e-${randomBytes(12).toString("hex")}`;
  const reg = await json<{ accessToken: string }>(await api.post("auth/register", { data: { name: who.name ?? "Amira Analyst", email, password, orgName: who.orgName ?? "E2E SOC" } }));
  const headers = { Authorization: `Bearer ${reg.accessToken}` };

  const flows = await readFile(new URL("demo-scenario-flows.csv", DEMO_DIR));
  const ds = await json<{ id: string }>(
    await api.post("imports/csv", { headers, multipart: { file: { name: "demo-scenario-flows.csv", mimeType: "text/csv", buffer: flows }, sourceType: "CICIDS2017" } }),
  );
  await expect.poll(async () => (await json<{ status: string }>(await api.get(`datasets/${ds.id}`, { headers }))).status, { timeout: 60_000 }).toBe("Processed");

  const identity = await readFile(new URL("demo-identity.csv", DEMO_DIR));
  await json(await api.post("identity/imports", { headers, multipart: { file: { name: "demo-identity.csv", mimeType: "text/csv", buffer: identity } } }));

  await expect
    .poll(async () => (await json<{ items: { type: string }[] }>(await api.get("alerts", { headers }))).items.map((a) => a.type).sort(), { timeout: 60_000 })
    .toEqual(["PortScan", "SSHPatator"]);
  let incidentId = "";
  await expect
    .poll(
      async () => {
        const items = (await json<{ items: { id: string }[] }>(await api.get("incidents", { headers }))).items;
        incidentId = items[0]?.id ?? "";
        return items.length;
      },
      { timeout: 60_000 },
    )
    .toBe(1);
  await api.dispose();
  return { email, password, incidentId };
}

/** Signs in through the real login form (access token in memory, refresh token in an httpOnly cookie). */
export async function signIn(page: Page, ws: DemoWorkspace): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ws.email);
  await page.getByLabel("Password", { exact: true }).fill(ws.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}
