import { parseWindow, type RuleDefinition, type RuleField } from "@sentinel/shared";

/** The flow fields a rule can read. */
export interface RuleFlow {
  id: string;
  timestamp: Date;
  sourceIp: string;
  destinationIp: string;
  sourcePort: number;
  destinationPort: number;
  protocol: string;
  totalPackets: number | null;
  flowDurationMs: number | null;
  features: Record<string, number | null> | null;
}

export interface RuleHit {
  ruleKey: string;
  /** Stable id of this hit: re-evaluating the same flows yields the same key (idempotent alerting). */
  hitKey: string;
  group: Partial<Record<RuleField, string | number>>;
  /** Flows (or distinct values) counted when the rule fired. */
  value: number;
  windowStart: Date;
  windowEnd: Date;
  flowCount: number;
  sampleFlowIds: string[];
}

const SAMPLE = 20;

export function matchesFilter(rule: RuleDefinition, f: RuleFlow): boolean {
  const flt = rule.filter;
  if (flt.protocol && f.protocol !== flt.protocol) return false;
  if (flt.destinationPorts && !flt.destinationPorts.includes(f.destinationPort)) return false;
  // Unknown values never satisfy a threshold: a missing count is not "small".
  if (flt.maxPacketsPerFlow !== undefined && (f.totalPackets === null || f.totalPackets > flt.maxPacketsPerFlow)) return false;
  if (flt.minPacketsPerFlow !== undefined && (f.totalPackets === null || f.totalPackets < flt.minPacketsPerFlow)) return false;
  if (flt.maxDurationMs !== undefined && (f.flowDurationMs === null || f.flowDurationMs > flt.maxDurationMs)) return false;
  if (flt.minDurationMs !== undefined && (f.flowDurationMs === null || f.flowDurationMs < flt.minDurationMs)) return false;
  for (const [name, min] of Object.entries(flt.featureGte ?? {})) {
    const v = f.features?.[name];
    if (typeof v !== "number" || v < min) return false;
  }
  for (const [name, max] of Object.entries(flt.featureLte ?? {})) {
    const v = f.features?.[name];
    if (typeof v !== "number" || v > max) return false;
  }
  return true;
}

interface Entry {
  ts: number;
  id: string;
  distinct: string | null;
}

interface GroupState {
  entries: Entry[];
  head: number;
  distinctCounts: Map<string, number>;
  /** After a hit, the group stays quiet until this time so one burst yields one hit per window. */
  quietUntil: number;
}

/**
 * Streaming sliding-window evaluator for one threshold rule. Flows must be
 * pushed in non-decreasing timestamp order (event time). Memory is bounded by
 * the flows inside one window per active group.
 */
export class RuleEvaluator {
  private readonly windowMs: number;
  private readonly groups = new Map<string, GroupState>();
  private lastTs = -Infinity;

  constructor(private readonly rule: RuleDefinition) {
    const ms = parseWindow(rule.window);
    if (ms === null) throw new Error(`Invalid window ${rule.window} in ${rule.key}`);
    this.windowMs = ms;
  }

  push(flow: RuleFlow): RuleHit | null {
    const ts = flow.timestamp.getTime();
    if (ts < this.lastTs) throw new Error("RuleEvaluator requires flows in timestamp order");
    this.lastTs = ts;
    if (!matchesFilter(this.rule, flow)) return null;

    const groupValues = Object.fromEntries(this.rule.groupBy.map((g) => [g, flow[g]])) as Partial<Record<RuleField, string | number>>;
    const groupKey = this.rule.groupBy.map((g) => String(flow[g])).join("|");
    let state = this.groups.get(groupKey);
    if (!state) {
      state = { entries: [], head: 0, distinctCounts: new Map(), quietUntil: -Infinity };
      this.groups.set(groupKey, state);
    }

    // Evict flows that fell out of the window (ts - window, ts].
    while (state.head < state.entries.length && (state.entries[state.head]?.ts ?? Infinity) <= ts - this.windowMs) {
      const old = state.entries[state.head++];
      if (old?.distinct !== null && old?.distinct !== undefined) {
        const n = (state.distinctCounts.get(old.distinct) ?? 1) - 1;
        if (n <= 0) state.distinctCounts.delete(old.distinct);
        else state.distinctCounts.set(old.distinct, n);
      }
    }
    if (state.head > 1024 && state.head * 2 > state.entries.length) {
      state.entries = state.entries.slice(state.head);
      state.head = 0;
    }

    const distinctField = this.rule.condition.distinct;
    const distinct = distinctField ? String(flow[distinctField]) : null;
    state.entries.push({ ts, id: flow.id, distinct });
    if (distinct !== null) state.distinctCounts.set(distinct, (state.distinctCounts.get(distinct) ?? 0) + 1);

    const live = state.entries.length - state.head;
    const value = distinctField ? state.distinctCounts.size : live;
    if (value < this.rule.condition.gte || ts < state.quietUntil) return null;

    const windowStart = state.entries[state.head]?.ts ?? ts;
    state.quietUntil = ts + this.windowMs;
    const window = state.entries.slice(state.head);
    return {
      ruleKey: this.rule.key,
      hitKey: `${this.rule.key}|${groupKey}|${windowStart}`,
      group: groupValues,
      value,
      windowStart: new Date(windowStart),
      windowEnd: new Date(ts),
      flowCount: live,
      sampleFlowIds: window.slice(-SAMPLE).map((e) => e.id),
    };
  }
}

/** Convenience for tests and the rule test endpoint: evaluates a sorted array. */
export function evaluateRule(rule: RuleDefinition, flows: Iterable<RuleFlow>): RuleHit[] {
  const ev = new RuleEvaluator(rule);
  const hits: RuleHit[] = [];
  for (const f of flows) {
    const hit = ev.push(f);
    if (hit) hits.push(hit);
  }
  return hits;
}
