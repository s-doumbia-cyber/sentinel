/* eslint-disable no-console -- CLI output is the point of this script. */
/**
 * Creates the isolated demo workspace (synthetic DEMO data) in a MongoDB database.
 *
 *   npm run seed:demo                                  dry run: shows the target and what would be created
 *   npm run seed:demo -- --yes                         creates it in MONGO_URI (apps/api/.env)
 *   npm run seed:demo -- --mongo-uri <uri> --yes       creates it in another database
 *
 * It adds one organisation ("sentinel-demo") and three accounts (Owner, Analyst,
 * Viewer) with random passwords printed once, imports data/demo/*.csv tagged DEMO
 * and runs detection, correlation and the asset inventory. It never changes or
 * deletes existing data, and refuses to run if the demo already exists.
 */
import "dotenv/config";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { createLogger } from "../lib/logger.js";
import { DEMO_ORG_NAME, DEMO_ORG_SLUG, DEMO_USERS, DemoExistsError, inspectDemo, seedDemo } from "../modules/demo/demo.seed.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** host[:port]/database only: never print credentials embedded in the URI. */
function describeTarget(uri: string): string {
  try {
    const u = new URL(uri);
    return `${u.protocol}//${u.host}${u.pathname || "/"}`;
  } catch {
    return "(unparsable MongoDB URI)";
  }
}

async function main() {
  const uri = arg("--mongo-uri") ?? process.env.MONGO_URI;
  const apply = process.argv.includes("--yes");
  if (!uri) throw new Error("No database: pass --mongo-uri <uri> or set MONGO_URI in apps/api/.env");
  const flowsCsv = fileURLToPath(new URL("../../../../data/demo/demo-scenario-flows.csv", import.meta.url));
  const identityCsv = fileURLToPath(new URL("../../../../data/demo/demo-identity.csv", import.meta.url));
  if (!existsSync(flowsCsv) || !existsSync(identityCsv)) throw new Error("Demo files are missing: run `npm run demo:data` first.");

  console.log(`Target database: ${describeTarget(uri)}`);
  await mongoose.connect(uri);
  const state = await inspectDemo();
  if (state.orgExists || state.existingUsers.length) {
    console.log(`The demo workspace already exists; nothing to do.${state.existingUsers.length ? ` Existing accounts: ${state.existingUsers.join(", ")}.` : ""}`);
    console.log("Its passwords were printed when it was created and are not stored in clear anywhere.");
    await mongoose.disconnect();
    return;
  }
  if (!apply) {
    console.log("\nDry run (nothing written). With --yes this would create:");
    console.log(`  organisation "${DEMO_ORG_NAME}" (slug ${DEMO_ORG_SLUG})`);
    for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(8)} ${u.email}`);
    console.log("  585 synthetic flows tagged DEMO, rule alerts, a correlated incident, assets, 5 identity records");
    console.log("Existing data is never modified. Re-run with --yes to create it.");
    await mongoose.disconnect();
    return;
  }

  const result = await seedDemo({ flowsCsv, identityCsv, logger: createLogger("warn") });
  console.log(`\nDemo workspace created: ${result.counts.flows} flows (DEMO), ${result.counts.alerts} alerts, ${result.counts.incidents} incident(s), ${result.counts.identityRecords} identity records.`);
  console.log("\nSign-in details (shown once; store them now, they cannot be recovered):");
  for (const c of result.credentials) console.log(`  ${c.role.padEnd(8)} ${c.email}  ${c.password}`);
  console.log("\nNo ML service was involved: flows stay unscored until you activate a model on the Models page.");
  await mongoose.disconnect();
}

main().catch(async (err: unknown) => {
  console.error(err instanceof DemoExistsError || err instanceof Error ? err.message : String(err));
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
