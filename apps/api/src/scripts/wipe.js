import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { NetworkFlow } from "../models/NetworkFlow.js";
import { Dataset } from "../models/Dataset.js";
import { Incident } from "../models/Incident.js";

// Usage: npm run wipe
// Clears imported flows/datasets/incidents so you can re-import cleanly
// (e.g. after the csvImporter header-trim fix). Does NOT touch user accounts.
async function run() {
  await connectDB();
  const flows = await NetworkFlow.deleteMany({});
  const datasets = await Dataset.deleteMany({});
  const incidents = await Incident.deleteMany({});
  console.log(`[wipe] Removed ${flows.deletedCount} flows, ${datasets.deletedCount} datasets, ${incidents.deletedCount} incidents.`);
  console.log("[wipe] User accounts were left untouched.");
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("[wipe] Failed:", err);
  process.exit(1);
});
