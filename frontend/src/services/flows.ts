import { api } from "./api";
import type { Incident, NetworkFlow } from "@/types";

export interface KpiResponse {
  totalFlows: number;
  totalAttacks: number;
  normalTraffic: number;
  attackPercentage: number;
  uniqueSourceIps: number;
  uniqueDestinationIps: number;
  avgPacketSize: number;
  avgFlowDuration: number;
}

export interface FlowListParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  onlyAttacks?: boolean;
  attackType?: string;
  protocol?: string;
  severity?: string;
  sourceIp?: string;
  destinationIp?: string;
  port?: number;
  from?: string;
  to?: string;
}

export interface CommonFlowFilters {
  attackType?: string;
  protocol?: string;
  severity?: string;
  from?: string;
  to?: string;
}

export const flowsApi = {
  list: (params: FlowListParams) =>
    api
      .get<{ rows: (NetworkFlow & { _id: string })[]; total: number; page: number; pages: number }>("/flows", { params })
      .then((r) => ({ ...r.data, rows: r.data.rows.map((row) => ({ ...row, id: row._id })) })),
  kpis: (params: CommonFlowFilters = {}) => api.get<KpiResponse>("/flows/kpis", { params }).then((r) => r.data),
  attackBreakdown: (params: CommonFlowFilters = {}) =>
    api.get<{ name: string; value: number }[]>("/flows/attack-breakdown", { params }).then((r) => r.data),
  severityBreakdown: (params: CommonFlowFilters = {}) =>
    api.get<{ name: string; value: number }[]>("/flows/severity-breakdown", { params }).then((r) => r.data),
  timeline: (params: CommonFlowFilters = {}) =>
    api
      .get<{ _id: { date: string; isAttack: boolean }; count: number }[]>("/flows/timeline", { params })
      .then((r) => r.data),
  topPorts: (params: CommonFlowFilters = {}) =>
    api.get<{ port: string; value: number }[]>("/flows/top-ports", { params }).then((r) => r.data),
  topAttackers: (params: CommonFlowFilters = {}) =>
    api.get<{ sourceIp: string; attacks: number; types: string[] }[]>("/flows/top-attackers", { params }).then((r) => r.data),
  topSubnets: (params: CommonFlowFilters = {}) =>
    api.get<{ subnet: string; attacks: number }[]>("/flows/top-subnets", { params }).then((r) => r.data),
};

export const incidentsApi = {
  list: () =>
    api
      .get<(Incident & { _id: string })[]>("/incidents")
      .then((r) => r.data.map((inc) => ({ ...inc, id: inc._id }))),
  updateStatus: (id: string, status: string) => api.patch(`/incidents/${id}`, { status }).then((r) => r.data),
};

export interface DatasetResponse {
  _id: string;
  name: string;
  sourceType: string;
  rows: number;
  columns: number;
  attackTypesFound: string[];
  status: "Processing" | "Processed" | "Failed";
  createdAt: string;
}

export const datasetsApi = {
  list: () => api.get<DatasetResponse[]>("/datasets").then((r) => r.data),
  upload: (file: File, sourceType: string, onProgress: (pct: number) => void) => {
    const form = new FormData();
    form.append("file", file);
    form.append("sourceType", sourceType);
    return api.post("/datasets/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 10 * 60 * 1000,
      onUploadProgress: (evt) => {
        if (evt.total) onProgress(Math.round((evt.loaded / evt.total) * 100));
      },
    });
  },
};

/** Reshapes the backend's { _id: { date, isAttack }, count } timeline buckets into
 * the { date, attacks, normal } rows the trend chart expects. */
export function transformTimeline(raw: { _id: { date: string; isAttack: boolean }; count: number }[]) {
  const byDate = new Map<string, { date: string; attacks: number; normal: number }>();
  for (const row of raw) {
    const date = row._id.date;
    const bucket = byDate.get(date) ?? { date, attacks: 0, normal: 0 };
    if (row._id.isAttack) bucket.attacks += row.count;
    else bucket.normal += row.count;
    byDate.set(date, bucket);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Builds the 8 homepage KpiDefinition cards from the real /flows/kpis response,
 * using the real daily attack/normal counts as sparkline data (no fabricated trend). */
export function buildKpiCards(kpis: KpiResponse, timeline: { date: string; attacks: number; normal: number }[]) {
  const attackSpark = timeline.map((t) => t.attacks);
  const normalSpark = timeline.map((t) => t.normal);
  const totalSpark = timeline.map((t) => t.attacks + t.normal);
  const flat = (v: number) => Array.from({ length: Math.max(timeline.length, 1) }, () => v);

  return [
    { id: "flows", label: "Total Network Flows", value: kpis.totalFlows, format: "number" as const, trend: 0, sparkline: totalSpark.length ? totalSpark : flat(kpis.totalFlows), accent: "cyan" as const },
    { id: "attacks", label: "Total Attacks", value: kpis.totalAttacks, format: "number" as const, trend: 0, sparkline: attackSpark.length ? attackSpark : flat(kpis.totalAttacks), accent: "pink" as const },
    { id: "normal", label: "Normal Traffic", value: kpis.normalTraffic, format: "number" as const, trend: 0, sparkline: normalSpark.length ? normalSpark : flat(kpis.normalTraffic), accent: "cyan" as const },
    { id: "pct", label: "Attack Percentage", value: kpis.attackPercentage, format: "percent" as const, trend: 0, sparkline: flat(kpis.attackPercentage), accent: "pink" as const },
    { id: "src", label: "Unique Source IPs", value: kpis.uniqueSourceIps, format: "number" as const, trend: 0, sparkline: flat(kpis.uniqueSourceIps), accent: "violet" as const },
    { id: "dst", label: "Unique Destination IPs", value: kpis.uniqueDestinationIps, format: "number" as const, trend: 0, sparkline: flat(kpis.uniqueDestinationIps), accent: "violet" as const },
    { id: "packet", label: "Avg Packet Size", value: kpis.avgPacketSize, format: "bytes" as const, trend: 0, sparkline: flat(kpis.avgPacketSize), accent: "cyan" as const },
    { id: "duration", label: "Avg Flow Duration", value: kpis.avgFlowDuration, format: "ms" as const, trend: 0, sparkline: flat(kpis.avgFlowDuration), accent: "violet" as const },
  ];
}

export interface ModelComparisonMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ModelMetricsResponse {
  modelsCompared: Record<string, ModelComparisonMetrics>;
  bestModel: string;
  classes: string[];
  confusionMatrix: number[][];
  featureImportance: { feature: string; importance: number }[];
  trainedOn: { totalRows: number; trainRows: number; testRows: number; features: string[]; droppedClasses: string[] };
}

export const mlApi = {
  metrics: () => api.get<ModelMetricsResponse>("/ml/metrics").then((r) => r.data),
};
