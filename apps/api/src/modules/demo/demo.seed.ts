import { randomBytes } from "node:crypto";
import { statSync } from "node:fs";
import type { Role } from "@sentinel/shared";
import { hashPassword } from "../../lib/crypto.js";
import type { Logger } from "../../lib/logger.js";
import { IdentityObservation } from "../../models/context.js";
import { Membership, Org, User } from "../../models/identity.js";
import { Alert, Flow, Incident } from "../../models/tenant.js";
import { AlertService } from "../alerts/alert.service.js";
import { refreshAssets } from "../assets/asset.service.js";
import { writeAudit } from "../audit/audit.service.js";
import { checkCsvHeader, createDatasetRecord, runCsvImport } from "../datasets/csv.importer.js";
import { importIdentityCsv } from "../identity/identity.service.js";
import { CorrelationService } from "../incidents/correlation.service.js";
import { RuleService } from "../rules/rule.service.js";

export const DEMO_ORG_SLUG = "sentinel-demo";
export const DEMO_ORG_NAME = "Sentinel Demo (synthetic data)";
// `.test` is reserved (RFC 2606): these addresses can never reach a real mailbox.
export const DEMO_USERS: { role: Role; name: string; email: string }[] = [
  { role: "Owner", name: "Demo Owner", email: "owner@sentinel-demo.test" },
  { role: "Analyst", name: "Demo Analyst", email: "analyst@sentinel-demo.test" },
  { role: "Viewer", name: "Demo Viewer", email: "viewer@sentinel-demo.test" },
];

export class DemoExistsError extends Error {}

/**
 * Safety guard for unattended runs (the Compose `demo-seed` service): when a
 * required host is given, refuse any other MongoDB, so the seed can never be
 * pointed at a database outside the stack by a stray environment variable.
 */
export function assertSeedHost(uri: string, requiredHost: string | undefined): void {
  if (!requiredHost) return;
  let host: string;
  try {
    host = new URL(uri).hostname;
  } catch {
    throw new Error("Refusing to seed: the MongoDB URI cannot be parsed, so its host cannot be checked.");
  }
  if (host !== requiredHost) throw new Error(`Refusing to seed: the database host is "${host}" but this run is limited to "${requiredHost}".`);
}

/** What a run would touch, read without writing anything. */
export async function inspectDemo(): Promise<{ orgExists: boolean; existingUsers: string[] }> {
  const [org, users] = await Promise.all([
    Org.exists({ slug: DEMO_ORG_SLUG }),
    User.find({ email: { $in: DEMO_USERS.map((u) => u.email) } }).select("email").lean(),
  ]);
  return { orgExists: Boolean(org), existingUsers: users.map((u) => u.email) };
}

export interface DemoSeedResult {
  orgId: string;
  credentials: { role: Role; email: string; password: string }[];
  counts: { flows: number; alerts: number; incidents: number; identityRecords: number };
}

/**
 * Creates an isolated demo organisation with three members and loads the
 * synthetic DEMO scenario (flows tagged DEMO, identity records), then runs the
 * same detection, correlation and inventory steps as an upload. It never
 * modifies existing data and refuses to run twice. Passwords are random and
 * returned once; they are not stored anywhere but as argon2id hashes.
 */
export async function seedDemo(opts: { flowsCsv: string; identityCsv: string; logger: Logger }): Promise<DemoSeedResult> {
  const before = await inspectDemo();
  if (before.orgExists || before.existingUsers.length) {
    throw new DemoExistsError(
      `The demo workspace already exists (${[before.orgExists ? `org "${DEMO_ORG_SLUG}"` : "", ...before.existingUsers].filter(Boolean).join(", ")}). ` +
        "Sign in with the credentials printed when it was created, or delete the demo accounts from Settings first.",
    );
  }

  const org = await Org.create({ name: DEMO_ORG_NAME, slug: DEMO_ORG_SLUG });
  const credentials: DemoSeedResult["credentials"] = [];
  let ownerId = null;
  for (const u of DEMO_USERS) {
    const password = randomBytes(18).toString("base64url");
    const user = await User.create({ name: u.name, email: u.email, passwordHash: await hashPassword(password) });
    await Membership.create({ orgId: org._id, userId: user._id, role: u.role });
    if (u.role === "Owner") ownerId = user._id;
    credentials.push({ role: u.role, email: u.email, password });
  }
  if (!ownerId) throw new Error("Demo owner was not created");
  await writeAudit(null, { orgId: org._id, actorId: null, action: "demo.seed", target: { type: "org", id: String(org._id) }, meta: { users: DEMO_USERS.map((u) => u.email) } });

  const input = {
    orgId: org._id,
    userId: null,
    filePath: opts.flowsCsv,
    name: "demo-scenario-flows.csv (synthetic)",
    fileBytes: statSync(opts.flowsCsv).size,
    sourceType: "CICIDS2017" as const,
    sourceKind: "DEMO" as const,
  };
  const header = await checkCsvHeader(opts.flowsCsv, "cicids2017-v1");
  const dataset = await createDatasetRecord(input);
  await runCsvImport(dataset._id, input, header, opts.logger);

  // Same steps as an upload, without the ML service: every alert here comes from a rule.
  const alerts = new AlertService();
  await new RuleService(alerts, opts.logger).run(org._id, { datasetId: dataset._id });
  await new CorrelationService(opts.logger).correlate(org._id);
  await refreshAssets(org._id, opts.logger);
  await importIdentityCsv(org._id, ownerId, opts.identityCsv, "demo-identity.csv (synthetic)");

  const [flows, alertCount, incidents, identityRecords] = await Promise.all([
    Flow.countDocuments({ orgId: org._id }),
    Alert.countDocuments({ orgId: org._id }),
    Incident.countDocuments({ orgId: org._id }),
    IdentityObservation.countDocuments({ orgId: org._id }),
  ]);
  return { orgId: String(org._id), credentials, counts: { flows, alerts: alertCount, incidents, identityRecords } };
}
