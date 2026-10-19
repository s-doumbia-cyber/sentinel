#!/usr/bin/env node
/* eslint-disable no-console -- CLI output is the point of this script. */
// End-to-end smoke test against a running API + ML service.
//
//   node scripts/smoke.mjs [apiBaseUrl]       (default http://127.0.0.1:4000)
//
// It registers a throwaway user (with its own org), imports the CICIDS2017
// sample, activates the first cicids2017-v1 model, waits for scoring and
// prints what the system detected. Run it against a development database only.
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const BASE = `${(process.argv[2] ?? "http://127.0.0.1:4000").replace(/\/$/, "")}/api/v1`;
const SAMPLE = new URL("../data/samples/cicids2017-friday-ddos-sample.csv", import.meta.url);
let token = "";
let cookie = "";

async function call(method, path, body, extra = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie?.startsWith("sentinel_rt=")) cookie = setCookie.split(";")[0];
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeoutMs = 120_000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await sleep(500);
  }
}

const step = (msg) => console.log(`\n> ${msg}`);

step("Health");
console.log(await call("GET", "/healthz"), await call("GET", "/readyz"));

step("Register a throwaway user");
const email = `smoke-${randomBytes(4).toString("hex")}@example.com`;
const reg = await call("POST", "/auth/register", { name: "Smoke Test", email, password: `smoke-${randomBytes(12).toString("hex")}` });
token = reg.accessToken;
console.log(`user ${email}, org ${reg.orgs[0].name} (${reg.orgs[0].role}), refresh cookie set: ${Boolean(cookie)}`);

step("Rotate the refresh token");
const refreshed = await call("POST", "/auth/refresh", undefined, { cookie, "x-sentinel-csrf": "1" });
token = refreshed.accessToken;
console.log("new access token issued");

step("Import the CICIDS2017 sample");
const form = new FormData();
form.append("file", new Blob([await readFile(SAMPLE)], { type: "text/csv" }), "cicids2017-friday-ddos-sample.csv");
form.append("sourceType", "CICIDS2017");
const ds = await call("POST", "/imports/csv", form);
const done = await waitFor(async () => {
  const d = await call("GET", `/datasets/${ds.id}`);
  return d.status !== "Processing" && d;
}, "import");
console.log(`status ${done.status}: ${done.rowsInserted}/${done.rowsRead} rows, invalid ${done.skipped.invalidRow}, ground truth`, done.groundTruthCounts);

step("Before any model is active");
console.log((await call("GET", "/scoring/status")).schemas[0]);

step("Activate a model");
const models = await call("GET", "/models");
const model = models.items.find((m) => m.schema === "cicids2017-v1");
if (!model) throw new Error("No cicids2017-v1 model in the ML service. Train one: see services/ml/README.md");
console.log(`model ${model.version} (${model.algorithm}), test macro-F1 ${model.metrics.macroF1}, warnings: ${model.versionWarnings.length}`);
await call("POST", `/models/${model.version}/activate`);
const status = await waitFor(async () => {
  const s = (await call("GET", "/scoring/status")).schemas[0];
  return s.pending === 0 && s;
}, "scoring");
console.log(status);

step("What Sentinel detected (model verdicts)");
const overview = await call("GET", "/stats/overview");
console.log(overview);
console.log((await call("GET", "/stats/breakdown?by=verdict")).items);

step("Verdicts vs dataset ground truth (evaluation only)");
const ev = await call("GET", "/stats/evaluation");
console.log(`macro-F1 ${ev.macroF1?.toFixed(4)} on ${ev.evaluatedFlows} flows`);
for (const c of ev.perClass) console.log(`  ${c.label.padEnd(10)} P=${c.precision?.toFixed(3)} R=${c.recall?.toFixed(3)} F1=${c.f1?.toFixed(3)} support=${c.support}`);
const detail = await call("GET", `/models/${model.version}`);
if (detail.trainingOverlap.length) console.log("NOTE: this dataset was used to train the model; this evaluation is not independent.");

step("Why one flow was flagged");
const flagged = (await call("GET", "/flows?verdict=malicious&limit=1")).items[0];
if (flagged) {
  console.log(`${flagged.sourceIp} -> ${flagged.destinationIp}:${flagged.destinationPort} verdict ${flagged.scored.label} (${flagged.scored.confidence}) [${flagged.sourceKind}] ground truth ${flagged.groundTruthLabel}`);
  for (const f of flagged.scored.topFeatures) console.log(`  ${f.contribution >= 0 ? "+" : ""}${f.contribution.toFixed(4)}  ${f.name} = ${f.value}`);
}

step("Alerts raised by the model and the rules");
await waitFor(async () => (await call("GET", "/alerts")).items.length > 0, "alerts", 30_000).catch(() => null);
const raised = (await call("GET", "/alerts")).items;
if (!raised.length) console.log("no active alerts (expected only when nothing malicious was detected)");
for (const a of raised) console.log(`  ${a.severity.toUpperCase()} ${a.type} ${a.srcIp ?? "*"} -> ${a.dstIp ?? "*"} evidence=${a.count} status=${a.status} by ${a.sources.join(", ")}`);

step("Audit trail");
for (const e of (await call("GET", "/audit?limit=10")).items) console.log(`  ${e.ts} ${e.action} ${e.target.type}:${e.target.id ?? ""}`);

step("Clean up: delete the throwaway account and its workspace");
await call("DELETE", "/me");
console.log("\nSmoke test passed.");
