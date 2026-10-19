import type {
  AttackType,
  DatasetSummary,
  Incident,
  IncidentPriority,
  IncidentStatus,
  KpiDefinition,
  ModelMetrics,
  NetworkFlow,
  Severity,
  ThreatSource,
} from "@/types";

// Seeded pseudo-random generator so the demo looks the same on every reload
// (nicer for screenshots / recruiter review) while still feeling "live" data.
let seed = 42;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

export const ATTACK_TYPES: AttackType[] = [
  "DDoS",
  "PortScan",
  "BruteForce",
  "Botnet",
  "SQLInjection",
  "XSS",
  "Heartbleed",
  "DoSHulk",
  "DoSSlowloris",
  "FTPPatator",
  "SSHPatator",
  "WebAttack",
  "Infiltration",
];

const ATTACK_SEVERITY: Record<AttackType, Severity> = {
  DDoS: "critical",
  Botnet: "critical",
  Heartbleed: "critical",
  SQLInjection: "high",
  Infiltration: "high",
  DoSHulk: "high",
  SSHPatator: "medium",
  FTPPatator: "medium",
  BruteForce: "medium",
  DoSSlowloris: "medium",
  PortScan: "low",
  XSS: "high",
  WebAttack: "high",
  Normal: "safe",
};

const COUNTRIES: { name: string; code: string; lat: number; lng: number }[] = [
  { name: "United States", code: "US", lat: 37.09, lng: -95.71 },
  { name: "China", code: "CN", lat: 35.86, lng: 104.19 },
  { name: "Russia", code: "RU", lat: 61.52, lng: 105.31 },
  { name: "Brazil", code: "BR", lat: -14.23, lng: -51.92 },
  { name: "India", code: "IN", lat: 20.59, lng: 78.96 },
  { name: "Germany", code: "DE", lat: 51.16, lng: 10.45 },
  { name: "Iran", code: "IR", lat: 32.42, lng: 53.68 },
  { name: "Vietnam", code: "VN", lat: 14.06, lng: 108.28 },
  { name: "Netherlands", code: "NL", lat: 52.13, lng: 5.29 },
  { name: "Ukraine", code: "UA", lat: 48.38, lng: 31.17 },
];

function randomIp(): string {
  return `${randInt(1, 223)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;
}

export function generateFlows(count = 500): NetworkFlow[] {
  const flows: NetworkFlow[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const isAttack = rand() > 0.62;
    const label: AttackType = isAttack ? pick(ATTACK_TYPES) : "Normal";
    const country = pick(COUNTRIES);
    flows.push({
      id: `flow-${i}`,
      timestamp: new Date(now - randInt(0, 1000 * 60 * 60 * 24 * 30)).toISOString(),
      sourceIp: randomIp(),
      destinationIp: randomIp(),
      sourcePort: randInt(1, 65535),
      destinationPort: pick([80, 443, 22, 21, 3389, 8080, 53, 3306]),
      protocol: pick(["TCP", "UDP", "ICMP"]),
      flowDurationMs: randInt(1, 12000),
      packetLength: randInt(40, 1500),
      label,
      prediction: rand() > 0.08 ? label : pick(ATTACK_TYPES), // ~92% model accuracy on the mock feed
      severity: ATTACK_SEVERITY[label],
      country: country.name,
      isAttack,
    });
  }
  return flows;
}

export const FLOWS = generateFlows(600);

export function buildKpis(flows: NetworkFlow[]): KpiDefinition[] {
  const total = flows.length;
  const attacks = flows.filter((f) => f.isAttack).length;
  const normal = total - attacks;
  const uniqueSrc = new Set(flows.map((f) => f.sourceIp)).size;
  const uniqueDst = new Set(flows.map((f) => f.destinationIp)).size;
  const avgPacket = Math.round(flows.reduce((s, f) => s + f.packetLength, 0) / total);
  const avgDuration = Math.round(flows.reduce((s, f) => s + f.flowDurationMs, 0) / total);
  const spark = (base: number) => Array.from({ length: 12 }, () => Math.max(1, Math.round(base * (0.7 + rand() * 0.6))));

  return [
    { id: "flows", label: "Total Network Flows", value: total, format: "number", trend: 4.2, sparkline: spark(total / 12), accent: "cyan" },
    { id: "attacks", label: "Total Attacks", value: attacks, format: "number", trend: 12.8, sparkline: spark(attacks / 12), accent: "pink" },
    { id: "normal", label: "Normal Traffic", value: normal, format: "number", trend: -2.1, sparkline: spark(normal / 12), accent: "cyan" },
    { id: "pct", label: "Attack Percentage", value: Math.round((attacks / total) * 1000) / 10, format: "percent", trend: 3.4, sparkline: spark(10), accent: "pink" },
    { id: "src", label: "Unique Source IPs", value: uniqueSrc, format: "number", trend: 1.6, sparkline: spark(uniqueSrc / 12), accent: "violet" },
    { id: "dst", label: "Unique Destination IPs", value: uniqueDst, format: "number", trend: 0.8, sparkline: spark(uniqueDst / 12), accent: "violet" },
    { id: "packet", label: "Avg Packet Size", value: avgPacket, format: "bytes", trend: -1.2, sparkline: spark(avgPacket / 12), accent: "cyan" },
    { id: "duration", label: "Avg Flow Duration", value: avgDuration, format: "ms", trend: 2.9, sparkline: spark(avgDuration / 12), accent: "violet" },
  ];
}

export function buildAttackTypeBreakdown(flows: NetworkFlow[]) {
  const counts = new Map<AttackType, number>();
  flows.filter((f) => f.isAttack).forEach((f) => counts.set(f.label, (counts.get(f.label) ?? 0) + 1));
  return Array.from(counts.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

export function buildTimeline(flows: NetworkFlow[]) {
  const buckets = new Map<string, { date: string; attacks: number; normal: number }>();
  flows.forEach((f) => {
    const date = f.timestamp.slice(0, 10);
    const bucket = buckets.get(date) ?? { date, attacks: 0, normal: 0 };
    if (f.isAttack) bucket.attacks += 1;
    else bucket.normal += 1;
    buckets.set(date, bucket);
  });
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function buildThreatSources(flows: NetworkFlow[]): ThreatSource[] {
  const counts = new Map<string, number>();
  flows.filter((f) => f.isAttack).forEach((f) => counts.set(f.country, (counts.get(f.country) ?? 0) + 1));
  return COUNTRIES.map((c) => ({
    country: c.name,
    countryCode: c.code,
    attacks: counts.get(c.name) ?? 0,
    lat: c.lat,
    lng: c.lng,
  })).sort((a, b) => b.attacks - a.attacks);
}

export function buildProtocolBreakdown(flows: NetworkFlow[]) {
  const counts = new Map<string, number>();
  flows.forEach((f) => counts.set(f.protocol, (counts.get(f.protocol) ?? 0) + 1));
  return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
}

export function buildTopPorts(flows: NetworkFlow[]) {
  const counts = new Map<number, number>();
  flows.filter((f) => f.isAttack).forEach((f) => counts.set(f.destinationPort, (counts.get(f.destinationPort) ?? 0) + 1));
  return Array.from(counts.entries())
    .map(([port, value]) => ({ port: String(port), value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

const ANALYST_NAMES = ["A. Kade", "M. Reyes", "S. Okafor", "J. Tran", "L. Novak", "Unassigned"];

export function generateIncidents(count = 24): Incident[] {
  const statuses: IncidentStatus[] = ["Open", "Investigating", "Resolved", "Closed"];
  const priorities: IncidentPriority[] = ["P1", "P2", "P3", "P4"];
  const incidents: Incident[] = [];
  for (let i = 0; i < count; i++) {
    const attackType = pick(ATTACK_TYPES);
    incidents.push({
      id: `INC-${1000 + i}`,
      title: `${attackType} activity detected from external host`,
      attackType,
      status: pick(statuses),
      priority: pick(priorities),
      severity: ATTACK_SEVERITY[attackType],
      assignee: pick(ANALYST_NAMES),
      createdAt: new Date(Date.now() - randInt(0, 1000 * 60 * 60 * 24 * 14)).toISOString(),
      sourceIp: randomIp(),
    });
  }
  return incidents;
}

export const INCIDENTS = generateIncidents();

export const DATASETS: DatasetSummary[] = [
  { id: "ds-1", name: "CICIDS2017_Wednesday.csv", rows: 692703, columns: 79, attackTypes: 7, uploadedAt: "2026-06-02", status: "Processed" },
  { id: "ds-2", name: "CICIDS2017_Friday_DDoS.csv", rows: 225745, columns: 79, attackTypes: 1, uploadedAt: "2026-06-04", status: "Processed" },
  { id: "ds-3", name: "UNSW-NB15_training.csv", rows: 175341, columns: 45, attackTypes: 9, uploadedAt: "2026-06-10", status: "Processed" },
  { id: "ds-4", name: "CSE-CIC-IDS2018_sample.csv", rows: 84532, columns: 80, attackTypes: 6, uploadedAt: "2026-07-01", status: "Processing" },
];

export const MODEL_METRICS: ModelMetrics = {
  accuracy: 0.947,
  precision: 0.932,
  recall: 0.918,
  f1: 0.925,
  confusionMatrix: [
    [5120, 143],
    [201, 4536],
  ],
  featureImportance: [
    { feature: "Flow Duration", importance: 0.182 },
    { feature: "Packet Length Mean", importance: 0.156 },
    { feature: "Destination Port", importance: 0.134 },
    { feature: "Total Fwd Packets", importance: 0.112 },
    { feature: "Flow Bytes/s", importance: 0.098 },
    { feature: "SYN Flag Count", importance: 0.081 },
  ],
  rocPoints: Array.from({ length: 11 }, (_, i) => {
    const fpr = i / 10;
    return { fpr, tpr: Math.min(1, Math.sqrt(fpr) * 0.97 + 0.03) };
  }),
};
