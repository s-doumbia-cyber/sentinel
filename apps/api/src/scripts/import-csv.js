import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { importCsvFile } from "../utils/csvImporter.js";

// Usage: npm run import -- "C:\path\to\Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv" [SourceType]
const filePath = process.argv[2];
const sourceType = process.argv[3] || "CICIDS2017";

if (!filePath) {
  console.error('Usage: npm run import -- "<path-to-csv>" [SourceType]');
  process.exit(1);
}
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

async function run() {
  await connectDB();
  console.log(`[import] Reading ${filePath} ...`);

  const { rowCount, insertedCount, skippedCount, skippedUnknownLabelCount, attackCount } = await importCsvFile(
    filePath,
    sourceType,
    undefined,
    (n) => process.stdout.write(`\r[import] Inserted ${n} rows...`)
  );

  console.log(
    `\n[import] Done. ${rowCount} rows read, ${insertedCount} inserted, ${skippedCount} skipped ` +
      `(${skippedUnknownLabelCount} unrecognized label), ${attackCount} attacks.`
  );
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("[import] Failed:", err);
  process.exit(1);
});
