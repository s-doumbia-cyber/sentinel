#!/usr/bin/env node
/* eslint-disable no-console -- CLI output is the point of this script. */
// Writes the synthetic DEMO scenario files into data/demo/. It touches no database.
//
//   node scripts/demo-data.mjs            (or: npm run demo:data)
//
// Output (deterministic: same seed, same bytes):
//   data/demo/demo-scenario-flows.csv   CICIDS2017-shaped flows: benign office traffic,
//                                       a port scan, then an SSH brute force from one host
//   data/demo/demo-identity.csv         DHCP / auth records for the same addresses
//
// The flows are SYNTHETIC. Labels are ground truth for evaluation only; Sentinel's
// verdicts come from its rules and model. Import with the --demo flag so every flow is
// tagged DEMO (see data/demo/README.md).
import { mkdir, readFile, writeFile } from "node:fs/promises";

const SAMPLE = new URL("../data/samples/cicids2017-friday-ddos-sample.csv", import.meta.url);
const OUT = new URL("../data/demo/", import.meta.url);
const DAY = "2026-10-19";

// Small seeded PRNG (mulberry32) so the files are reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261019);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (xs) => xs[int(0, xs.length - 1)];
const at = (h, m, s) => `${DAY}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}Z`;

const header = (await readFile(SAMPLE, "utf8")).split(/\r?\n/, 1)[0].split(",");
const rows = [];

/** One flow; every feature not set here is 0. Durations are microseconds, as in CICIDS2017. */
function flow({ src, sport, dst, dport, proto, ts, durUs, fwd, bwd, fwdBytes, bwdBytes, syn = 0, ack = 0, label }) {
  const secs = Math.max(durUs, 1) / 1e6;
  const values = {
    "Flow ID": `${src}-${dst}-${sport}-${dport}-${proto}`,
    "Source IP": src,
    "Source Port": sport,
    "Destination IP": dst,
    "Destination Port": dport,
    Protocol: proto,
    Timestamp: ts,
    "Flow Duration": durUs,
    "Total Fwd Packets": fwd,
    "Total Backward Packets": bwd,
    "Total Length of Fwd Packets": fwdBytes,
    "Total Length of Bwd Packets": bwdBytes,
    "Fwd Packet Length Max": fwd ? Math.ceil(fwdBytes / fwd) : 0,
    "Fwd Packet Length Mean": fwd ? +(fwdBytes / fwd).toFixed(2) : 0,
    "Bwd Packet Length Max": bwd ? Math.ceil(bwdBytes / bwd) : 0,
    "Bwd Packet Length Mean": bwd ? +(bwdBytes / bwd).toFixed(2) : 0,
    "Flow Bytes/s": +((fwdBytes + bwdBytes) / secs).toFixed(3),
    "Flow Packets/s": +((fwd + bwd) / secs).toFixed(3),
    "Flow IAT Mean": fwd + bwd > 1 ? Math.round(durUs / (fwd + bwd - 1)) : 0,
    "Flow IAT Max": durUs,
    "SYN Flag Count": syn,
    "ACK Flag Count": ack,
    "Average Packet Size": fwd + bwd ? +((fwdBytes + bwdBytes) / (fwd + bwd)).toFixed(2) : 0,
    "Subflow Fwd Packets": fwd,
    "Subflow Fwd Bytes": fwdBytes,
    "Subflow Bwd Packets": bwd,
    "Subflow Bwd Bytes": bwdBytes,
    Label: label,
  };
  rows.push(header.map((h) => values[h] ?? 0).join(","));
}

const SERVER = "10.0.0.20";
const ATTACKER = "10.0.0.66";
const WORKSTATIONS = ["10.0.0.31", "10.0.0.32", "10.0.0.33"];
const DNS = "10.0.0.2";
const WEB = ["93.184.216.34", "151.101.1.69", "140.82.112.3"];

// 09:00-09:30 benign office traffic: file shares, DNS, HTTPS out, admin SSH.
for (let i = 0; i < 360; i++) {
  const m = int(0, 29);
  const s = int(0, 59);
  const ws = pick(WORKSTATIONS);
  const kind = rand();
  if (kind < 0.35) flow({ src: ws, sport: int(49152, 65535), dst: SERVER, dport: 445, proto: 6, ts: at(9, m, s), durUs: int(20_000, 4_000_000), fwd: int(6, 40), bwd: int(6, 60), fwdBytes: int(800, 20_000), bwdBytes: int(2_000, 400_000), syn: 1, ack: 1, label: "BENIGN" });
  else if (kind < 0.6) flow({ src: ws, sport: int(49152, 65535), dst: DNS, dport: 53, proto: 17, ts: at(9, m, s), durUs: int(300, 40_000), fwd: 1, bwd: 1, fwdBytes: int(30, 60), bwdBytes: int(60, 200), label: "BENIGN" });
  else if (kind < 0.95) flow({ src: ws, sport: int(49152, 65535), dst: pick(WEB), dport: 443, proto: 6, ts: at(9, m, s), durUs: int(50_000, 30_000_000), fwd: int(8, 120), bwd: int(8, 200), fwdBytes: int(1_000, 40_000), bwdBytes: int(5_000, 900_000), syn: 1, ack: 1, label: "BENIGN" });
  else flow({ src: "10.0.0.31", sport: int(49152, 65535), dst: SERVER, dport: 22, proto: 6, ts: at(9, m, s), durUs: int(60_000_000, 900_000_000), fwd: int(80, 600), bwd: int(80, 600), fwdBytes: int(6_000, 60_000), bwdBytes: int(10_000, 200_000), syn: 1, ack: 1, label: "BENIGN" });
}

// 09:10:00-09:10:50 port scan: one or two packets per port, 180 distinct ports.
const ports = new Set();
while (ports.size < 180) ports.add(int(1, 10_000));
let k = 0;
for (const port of ports) {
  const secs = Math.floor((k++ * 50) / 180);
  flow({ src: ATTACKER, sport: int(40000, 60000), dst: SERVER, dport: port, proto: 6, ts: at(9, 10, secs), durUs: int(20, 900), fwd: 1, bwd: rand() < 0.9 ? 1 : 0, fwdBytes: 0, bwdBytes: 0, syn: 1, label: "PortScan" });
}

// 09:14:00-09:14:55 SSH brute force: 45 short authentication attempts.
for (let i = 0; i < 45; i++) {
  flow({ src: ATTACKER, sport: int(40000, 60000), dst: SERVER, dport: 22, proto: 6, ts: at(9, 14, Math.floor(i * 1.2)), durUs: int(1_800_000, 6_000_000), fwd: int(10, 16), bwd: int(12, 20), fwdBytes: int(1_200, 2_200), bwdBytes: int(2_000, 3_400), syn: 1, ack: 1, label: "SSH-Patator" });
}

rows.sort((a, b) => a.split(",")[header.indexOf("Timestamp")].localeCompare(b.split(",")[header.indexOf("Timestamp")]));

const identity = [
  "ip,start,end,source,username,hostname,mac",
  `${SERVER},${DAY}T06:00:00Z,${DAY}T20:00:00Z,dhcp,,SRV-FILES-01,02:00:5e:10:00:20`,
  `10.0.0.31,${DAY}T08:41:00Z,${DAY}T17:30:00Z,dhcp,,WS-031,02:00:5e:10:00:31`,
  `10.0.0.31,${DAY}T08:45:00Z,${DAY}T12:00:00Z,auth,demo.user31,WS-031,`,
  `10.0.0.32,${DAY}T08:50:00Z,${DAY}T17:45:00Z,dhcp,,WS-032,02:00:5e:10:00:32`,
  `${ATTACKER},${DAY}T08:55:00Z,${DAY}T09:40:00Z,dhcp,,UNMANAGED-66,02:00:5e:10:00:66`,
];

await mkdir(OUT, { recursive: true });
await writeFile(new URL("demo-scenario-flows.csv", OUT), [header.join(","), ...rows].join("\n") + "\n");
await writeFile(new URL("demo-identity.csv", OUT), identity.join("\n") + "\n");
console.log(`Wrote ${rows.length} synthetic flows and ${identity.length - 1} identity records to data/demo/.`);
console.log("Import them with --demo (flows) and from the Identity sources page; see data/demo/README.md.");
