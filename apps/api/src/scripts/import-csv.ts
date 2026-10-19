/* eslint-disable no-console -- CLI output is the point of this script. */
/**
 * Imports a CICIDS2017-style CSV from disk into an org, the same way the
 * upload endpoint does (large day-files are easier from the command line).
 *
 *   npm run import:csv -w @sentinel/api -- --org <slug> "<path-to.csv>"
 *   npm run import:csv -w @sentinel/api -- --org <slug> --demo "<path-to.csv>"
 *
 * --demo tags the flows DEMO instead of IMPORTED. Flows are stored unscored;
 * scoring runs from the API once a model is active for the org.
 */
import "dotenv/config";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { createLogger } from "../lib/logger.js";
import { Org } from "../models/identity.js";
import { checkCsvHeader, createDatasetRecord, runCsvImport } from "../modules/datasets/csv.importer.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const slug = arg("--org");
  const demo = process.argv.includes("--demo");
  const file = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--org").at(-1);
  if (!slug || !file) throw new Error('Usage: import:csv -- --org <slug> [--demo] "<path-to.csv>"');
  if (!existsSync(file)) throw new Error(`File not found: ${file}`);
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set (apps/api/.env)");

  await mongoose.connect(uri);
  const org = await Org.findOne({ slug }).lean();
  if (!org) throw new Error(`No org with slug "${slug}". Slugs are shown in Settings.`);

  const header = await checkCsvHeader(file, "cicids2017-v1");
  const input = {
    orgId: org._id,
    userId: null,
    filePath: file,
    name: path.basename(file),
    fileBytes: statSync(file).size,
    sourceType: "CICIDS2017" as const,
    sourceKind: demo ? ("DEMO" as const) : ("IMPORTED" as const),
  };
  const dataset = await createDatasetRecord(input);
  console.log(`Importing ${input.name} into "${org.name}" as ${input.sourceKind}...`);
  const counts = await runCsvImport(dataset._id, input, header, createLogger("warn"));
  console.table(counts);
  console.log("Flows are stored unscored. Activate a model and run scoring from the Models page.");
  await mongoose.disconnect();
}

main().catch(async (err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
