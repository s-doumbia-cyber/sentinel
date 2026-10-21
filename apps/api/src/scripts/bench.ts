/* eslint-disable no-console -- CLI output is the point of this script. */
/**
 * Times the dashboard and list endpoints against a THROWAWAY MongoDB filled with
 * synthetic flows, before and after building the rollups.
 *
 *   npm run bench -w @sentinel/api -- --flows 3000000 --dbpath D:\sentinel-bench --port 27118
 *
 * Safety: it starts its own mongod (mongodb-memory-server binary) on --port (never 27017)
 * with its own --dbpath, refuses a non-empty --dbpath, and deletes that directory at the
 * end unless --keep is given. It never reads .env and never connects anywhere else.
 *
 * The flows are synthetic (deterministic generator below): realistic shapes and
 * proportions, no CICIDS rows, and no feature vectors (stats endpoints do not read
 * them). Numbers measure query cost, not detection quality.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { type Types } from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { loadConfig } from "../config/index.js";
import { InProcessJobQueue } from "../lib/jobs.js";
import { createLogger } from "../lib/logger.js";
import { RollupState } from "../models/rollups.js";
import { Flow } from "../models/tenant.js";
import { rebuildRollups } from "../modules/stats/rollup.service.js";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : (process.argv[i + 1] ?? fallback);
}

const FLOWS = Number(arg("--flows", "3000000"));
const PORT = Number(arg("--port", "27118"));
const RUNS = Number(arg("--runs", "15"));
const DBPATH = path.resolve(arg("--dbpath", path.join(tmpdir(), `sentinel-bench-${process.pid}`)));
const OUT = arg("--out", "");
const KEEP = process.argv.includes("--keep");
/** Skip the (slow) raw-flow timings, e.g. when only the rollup path changed since a full run. */
const ROLLUP_ONLY = process.argv.includes("--rollup-only");

/** Small deterministic PRNG (mulberry32): the same data on every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ATTACKS = [
  { label: "DDoS", share: 0.07, sources: ["172.16.0.1"], ports: [80] },
  { label: "PortScan", share: 0.06, sources: ["172.16.0.1"], ports: Array.from({ length: 1000 }, (_, i) => i + 1) },
  { label: "DoSHulk", share: 0.05, sources: ["172.16.0.1"], ports: [80] },
  { label: "SSHPatator", share: 0.01, sources: ["172.16.0.1", "205.174.165.73"], ports: [22] },
  { label: "FTPPatator", share: 0.01, sources: ["205.174.165.73"], ports: [21] },
] as const;
const BENIGN_PORTS = [443, 80, 53, 123, 445, 8080, 22, 3389];

function* generate(orgId: Types.ObjectId, datasets: Types.ObjectId[], total: number) {
  const r = rng(42);
  const start = Date.UTC(2017, 6, 3, 8); // five working days of 8 hours, like CICIDS2017
  for (let i = 0; i < total; i++) {
    const day = Math.floor((i / total) * 5);
    const ts = new Date(start + day * 86_400_000 + Math.floor(r() * 8 * 3_600_000));
    let pick = r();
    let attack: (typeof ATTACKS)[number] | null = null;
    for (const a of ATTACKS) {
      if (pick < a.share) {
        attack = a;
        break;
      }
      pick -= a.share;
    }
    const pending = r() < 0.05;
    // The synthetic "model" is right 97% of the time: some attacks look Normal, some benign flows do not.
    const wrong = r() < 0.03;
    const truth = attack ? attack.label : "Normal";
    const predicted = wrong ? (attack ? "Normal" : "PortScan") : truth;
    const confidence = 0.5 + r() * 0.5;
    yield {
      orgId,
      datasetId: datasets[day],
      sourceKind: "IMPORTED",
      timestamp: ts,
      sourceIp: attack ? attack.sources[Math.floor(r() * attack.sources.length)] : `192.168.10.${1 + Math.floor(r() * 250)}`,
      destinationIp: attack ? `192.168.10.${50 + Math.floor(r() * 3)}` : `10.0.${Math.floor(r() * 4)}.${1 + Math.floor(r() * 250)}`,
      sourcePort: 1024 + Math.floor(r() * 60000),
      destinationPort: attack ? attack.ports[Math.floor(r() * attack.ports.length)] : BENIGN_PORTS[Math.floor(r() * BENIGN_PORTS.length)],
      protocol: r() < 0.85 ? "TCP" : "UDP",
      featureSchema: "cicids2017-v1",
      groundTruthLabel: truth,
      scoreStatus: pending ? "pending" : "scored",
      scored: pending
        ? null
        : {
            modelVersion: "bench-model",
            label: predicted,
            confidence,
            severity: predicted === "Normal" ? "info" : "high",
            needsReview: confidence < 0.6,
            topFeatures: [],
            scoredAt: ts,
          },
      alertedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
}

async function main() {
  if (PORT === 27017) throw new Error("Refusing port 27017: that is where a developer MongoDB usually runs");
  if (existsSync(DBPATH) && readdirSync(DBPATH).length) throw new Error(`--dbpath ${DBPATH} is not empty; give an empty or new directory`);
  mkdirSync(DBPATH, { recursive: true });
  console.log(`Throwaway mongod on 127.0.0.1:${PORT}, data in ${DBPATH}`);
  // A bounded cache keeps the laptop usable and the run repeatable (MongoDB's default is half the RAM).
  const mongod = await MongoMemoryServer.create({
    instance: { port: PORT, ip: "127.0.0.1", dbPath: DBPATH, storageEngine: "wiredTiger", args: ["--wiredTigerCacheSizeGB", "2"] },
  });
  try {
    await mongoose.connect(mongod.getUri("sentinel_bench"));
    const config = loadConfig({
      NODE_ENV: "test",
      MONGO_URI: "mongodb://unused",
      JWT_ACCESS_SECRET: "bench-only-secret-0123456789abcdefghijkl",
      CORS_ORIGINS: "http://localhost:5310",
    });
    const logger = createLogger("silent");
    // Jobs are not run: the raw timings must not overlap with a rollup rebuild started by a read.
    const queue = new InProcessJobQueue(logger, { attempts: 1, backoffMs: 1 }, async () => undefined);
    const sa = createApp({ config, logger, queue });
    for (const kind of ["import", "score", "detect", "assets", "rollup", "retention"] as const) queue.register(kind, async () => undefined);

    const reg = await request(sa.app).post("/api/v1/auth/register").send({ name: "Bench", email: "bench@bench.test", password: "bench-password-123" });
    let token = reg.body.accessToken as string;
    // Raw timings can outlast the 15-minute access token: sign in again before each endpoint (not timed).
    const freshToken = async () => {
      const res = await request(sa.app).post("/api/v1/auth/login").send({ email: "bench@bench.test", password: "bench-password-123" });
      token = res.body.accessToken as string;
    };
    const orgId = new mongoose.Types.ObjectId(reg.body.orgs[0].id as string);
    const datasets = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());

    console.log(`Inserting ${FLOWS.toLocaleString("en")} synthetic flows...`);
    const t0 = Date.now();
    let batch: unknown[] = [];
    let done = 0;
    for (const doc of generate(orgId, datasets, FLOWS)) {
      batch.push(doc);
      if (batch.length === 20_000) {
        // Raw driver on purpose: bulk speed, and the rollup hooks are irrelevant here (no state yet).
        await Flow.collection.insertMany(batch as never[], { ordered: false });
        done += batch.length;
        batch = [];
        if (done % 500_000 === 0) console.log(`  ${done.toLocaleString("en")} (${Math.round((Date.now() - t0) / 1000)} s)`);
      }
    }
    if (batch.length) await Flow.collection.insertMany(batch as never[], { ordered: false });
    const insertS = (Date.now() - t0) / 1000;
    const t1 = Date.now();
    await Flow.syncIndexes();
    const indexS = (Date.now() - t1) / 1000;
    console.log(`Inserted in ${insertS.toFixed(0)} s, indexes built in ${indexS.toFixed(0)} s`);

    const endpoints: [string, string][] = [
      ["Overview KPIs", "/stats/overview"],
      ["Overview, one day (partial minutes)", "/stats/overview?from=2017-07-04T08:00:30.000Z&to=2017-07-05T07:59:30.000Z"],
      ["Verdict breakdown", "/stats/breakdown?by=verdict"],
      ["Ground-truth breakdown", "/stats/breakdown?by=groundTruth"],
      ["Timeseries", "/stats/timeseries"],
      ["Top attackers", "/stats/top?kind=attackers&limit=10"],
      ["Top ports", "/stats/top?kind=ports&limit=10"],
      ["Top subnets", "/stats/top?kind=subnets&limit=10"],
      ["Evaluation (confusion matrix)", "/stats/evaluation"],
      ["Flow list, first page", "/flows?limit=50"],
      ["Flow list, malicious, first page", "/flows?limit=50&verdict=malicious"],
      ["Scoring status", "/scoring/status"],
    ];

    const measure = async (label: string) => {
      const out: { name: string; p50: number; p95: number; source: string }[] = [];
      for (const [name, url] of endpoints) {
        await freshToken();
        const times: number[] = [];
        let source = "-";
        for (let i = 0; i < RUNS; i++) {
          const s = process.hrtime.bigint();
          const res = await request(sa.app).get(`/api/v1${url}`).set("Authorization", `Bearer ${token}`);
          times.push(Number(process.hrtime.bigint() - s) / 1e6);
          if (res.status !== 200) throw new Error(`${url} answered ${res.status}: ${JSON.stringify(res.body)}`);
          source = (res.headers["x-sentinel-stats-source"] as string | undefined) ?? "-";
        }
        times.sort((a, b) => a - b);
        out.push({ name, p50: percentile(times, 50), p95: percentile(times, 95), source });
        console.log(`  [${label}] ${name}: p50 ${percentile(times, 50).toFixed(0)} ms, p95 ${percentile(times, 95).toFixed(0)} ms (${source})`);
      }
      return out;
    };

    console.log(ROLLUP_ONLY ? "Skipping raw timings (--rollup-only)" : "Measuring without rollups (raw flows)...");
    const raw = ROLLUP_ONLY ? endpoints.map(([name]) => ({ name, p50: NaN, p95: NaN, source: "-" })) : await measure("raw");
    console.log("Building rollups...");
    await RollupState.updateOne({ _id: orgId }, { $inc: { version: 1 } }, { upsert: true });
    const t2 = Date.now();
    await rebuildRollups(orgId);
    const rebuildS = (Date.now() - t2) / 1000;
    const state = await RollupState.findById(orgId).lean();
    console.log(`Rollups built in ${rebuildS.toFixed(1)} s (${state?.rows.toLocaleString("en")} rows)`);
    console.log("Measuring with rollups...");
    const rolled = await measure("rollup");

    const lines = [
      `| Endpoint | Raw p50 | Raw p95 | Rollup p50 | Rollup p95 | Answered from |`,
      `|---|---|---|---|---|---|`,
      ...raw.map((r, i) => {
        const o = rolled[i];
        const ms = (v: number) => (Number.isNaN(v) ? "not run" : `${v.toFixed(0)} ms`);
        return `| ${r.name} | ${ms(r.p50)} | ${ms(r.p95)} | ${o?.p50.toFixed(0)} ms | ${o?.p95.toFixed(0)} ms | ${o?.source === "-" ? "raw (not a stats endpoint)" : o?.source} |`;
      }),
    ];
    const summary = [
      `Flows: ${FLOWS.toLocaleString("en")} synthetic; runs per endpoint: ${RUNS}; insert ${insertS.toFixed(0)} s; index build ${indexS.toFixed(0)} s; rollup rebuild ${rebuildS.toFixed(1)} s (${state?.rows.toLocaleString("en")} rows).`,
      `MongoDB ${(await mongoose.connection.db?.admin().serverInfo())?.version ?? "?"} (mongodb-memory-server binary, WiredTiger), Node ${process.version}, ${process.platform}.`,
      "",
      ...lines,
    ].join("\n");
    console.log(`\n${summary}`);
    if (OUT) writeFileSync(OUT, `${summary}\n`);
  } finally {
    await mongoose.disconnect().catch(() => undefined);
    await mongod.stop({ doCleanup: !KEEP, force: !KEEP });
    if (!KEEP) rmSync(DBPATH, { recursive: true, force: true });
    console.log(KEEP ? `Kept ${DBPATH}` : `Stopped mongod and deleted ${DBPATH}`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
