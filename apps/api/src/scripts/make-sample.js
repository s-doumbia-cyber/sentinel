import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

// Usage: node src/scripts/make-sample.js "<path-to-a-full-CICIDS2017-csv>" [samplesPerLabel]
//
// Takes a stratified sample (a fixed number of rows per attack label) from a
// full CICIDS2017 CSV and writes it to backend/data/sample.csv — a small
// (typically a few MB) file that can be committed to the repo and imported
// with `npm run import -- data/sample.csv` with zero external downloads.
// Useful as a demo fallback if the full 271MB dataset isn't available on
// presentation day.

const SAMPLE_PER_LABEL = Number(process.argv[3]) || 500;
const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: node src/scripts/make-sample.js \"<path-to-csv>\" [samplesPerLabel]");
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`File not found: ${inputPath}`);
  process.exit(1);
}

console.log(`[sample] Reading ${inputPath} ...`);
const raw = fs.readFileSync(inputPath, "utf-8");
const records = parse(raw, {
  columns: (headerRow) => headerRow.map((h) => h.trim()),
  skip_empty_lines: true,
  trim: true,
  relax_column_count: true,
});
console.log(`[sample] Parsed ${records.length} rows.`);

const labelKey = Object.keys(records[0] || {}).find((k) => k.toLowerCase() === "label") || "Label";

const byLabel = {};
for (const r of records) {
  const label = r[labelKey] || "unknown";
  (byLabel[label] ??= []).push(r);
}

let sample = [];
for (const label in byLabel) {
  const taken = byLabel[label].slice(0, SAMPLE_PER_LABEL);
  sample = sample.concat(taken);
  console.log(`[sample]   ${label}: ${taken.length} / ${byLabel[label].length} rows`);
}

// Shuffle so the sample isn't one long run per label (nicer for a live demo
// scrolling through Attack Explorer).
for (let i = sample.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [sample[i], sample[j]] = [sample[j], sample[i]];
}

const headers = Object.keys(sample[0]);
const csvLines = [headers.join(","), ...sample.map((r) => headers.map((h) => csvEscape(r[h])).join(","))];

function csvEscape(value) {
  const v = value ?? "";
  return /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v;
}

const outDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "sample.csv");
fs.writeFileSync(outPath, csvLines.join("\n"));

console.log(`[sample] Wrote ${sample.length} rows (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB) to ${outPath}`);
