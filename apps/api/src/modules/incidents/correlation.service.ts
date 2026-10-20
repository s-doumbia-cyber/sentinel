import type { Request } from "express";
import type { Types } from "mongoose";
import {
  SEVERITIES,
  STAGE_BY_CLASS,
  maxSeverity,
  severityRank,
  type AttackClass,
  type Severity,
  type Stage,
} from "@sentinel/shared";
import type { Logger } from "../../lib/logger.js";
import { Org } from "../../models/identity.js";
import { Alert, Incident, type AlertDoc } from "../../models/tenant.js";
import { recordIncidentEvent } from "./events.js";

const SEVERITY_BY_RANK = Object.fromEntries(SEVERITIES.map((s) => [severityRank(s), s])) as Record<number, Severity>;
const PRIORITY: Record<Severity, "P1" | "P2" | "P3" | "P4"> = { critical: "P1", high: "P2", medium: "P3", low: "P4", info: "P4" };
const ACTIVE_ALERT = ["open", "needs_review", "acknowledged"];
const CLOSED_INCIDENT = ["Resolved", "Closed"];

type AlertLite = Pick<AlertDoc, "_id" | "type" | "srcIp" | "dstIp" | "severityRank" | "firstSeen" | "lastSeen">;

export function stagesOf(alerts: Pick<AlertDoc, "type" | "firstSeen">[]): Stage[] {
  const seen: Stage[] = [];
  for (const a of [...alerts].sort((x, y) => x.firstSeen.getTime() - y.firstSeen.getTime())) {
    const s = STAGE_BY_CLASS[a.type as AttackClass];
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen;
}

/**
 * Hybrid incident severity: the highest alert severity, raised one level when
 * the alerts span two or more distinct kill-chain stages (F5 escalation).
 */
export function incidentSeverity(alerts: Pick<AlertDoc, "type" | "severityRank" | "firstSeen">[]): { severity: Severity; escalated: boolean } {
  const base = Math.max(...alerts.map((a) => a.severityRank), 0);
  const escalated = stagesOf(alerts).length >= 2 && base < severityRank("critical");
  return { severity: SEVERITY_BY_RANK[escalated ? base + 1 : base] ?? "info", escalated };
}

/**
 * Recomputes an incident's derived fields from its alerts. Severity is never
 * lowered below what an analyst set.
 */
export async function recomputeIncident(orgId: Types.ObjectId, incidentId: Types.ObjectId): Promise<void> {
  const incident = await Incident.findOne({ orgId, _id: incidentId }).lean();
  if (!incident) return;
  const alerts = await Alert.find({ orgId, incidentId }).select("type srcIp dstIp severityRank firstSeen lastSeen").lean<AlertLite[]>();
  if (!alerts.length) return;
  const { severity } = incidentSeverity(alerts);
  const entities = new Map<string, { type: "ip"; value: string; role: "source" | "target" }>();
  for (const a of alerts) {
    if (a.srcIp) entities.set(`s:${a.srcIp}`, { type: "ip", value: a.srcIp, role: "source" });
    if (a.dstIp) entities.set(`t:${a.dstIp}`, { type: "ip", value: a.dstIp, role: "target" });
  }
  await Incident.updateOne(
    { orgId, _id: incidentId },
    {
      $set: {
        severity: maxSeverity(severity, incident.severity as Severity),
        firstSeen: new Date(Math.min(...alerts.map((a) => a.firstSeen.getTime()))),
        lastSeen: new Date(Math.max(...alerts.map((a) => a.lastSeen.getTime()))),
        entities: [...entities.values()].slice(0, 50),
        alertIds: alerts.map((a) => a._id),
      },
    },
  );
}

/** Links alerts to an incident and records why. Alerts already in another incident are skipped. */
export async function linkAlerts(
  req: Request | null,
  orgId: Types.ObjectId,
  incidentId: Types.ObjectId,
  alertIds: Types.ObjectId[],
  basis: string,
): Promise<number> {
  const res = await Alert.updateMany({ orgId, _id: { $in: alertIds }, incidentId: null }, { $set: { incidentId } });
  if (res.modifiedCount) {
    await recomputeIncident(orgId, incidentId);
    await recordIncidentEvent(req, orgId, incidentId, "alerts_linked", { alertIds: alertIds.map(String), count: res.modifiedCount, basis });
  }
  return res.modifiedCount;
}

/**
 * Groups unlinked active alerts into incidents (ROADMAP 3.2). Criterion: same
 * source address and each alert starting within the org's correlation window
 * of the previous one. A lone alert stays an alert; an alert matching an
 * active incident with that source joins it. This is a grouping heuristic:
 * the incident says so, and it is not proof of a single actor.
 */
export class CorrelationService {
  private readonly running = new Map<string, Promise<{ created: number; linked: number }>>();
  private readonly rerun = new Set<string>();

  constructor(private readonly logger?: Logger) {}

  /**
   * One pass at a time per org: concurrent callers (scoring and detection jobs)
   * would otherwise both create an incident for the same cluster. A call made
   * during a pass schedules exactly one more pass afterwards.
   */
  async correlate(orgId: Types.ObjectId): Promise<{ created: number; linked: number }> {
    const key = String(orgId);
    const current = this.running.get(key);
    if (current) {
      this.rerun.add(key);
      return current;
    }
    const run = (async () => {
      let total = { created: 0, linked: 0 };
      do {
        this.rerun.delete(key);
        const r = await this.correlateOnce(orgId);
        total = { created: total.created + r.created, linked: total.linked + r.linked };
      } while (this.rerun.has(key));
      return total;
    })().finally(() => this.running.delete(key));
    this.running.set(key, run);
    return run;
  }

  private async correlateOnce(orgId: Types.ObjectId): Promise<{ created: number; linked: number }> {
    const org = await Org.findById(orgId).lean();
    const windowMin = org?.settings?.correlationWindowMinutes ?? 15;
    const windowMs = windowMin * 60_000;
    const alerts = await Alert.find({ orgId, incidentId: null, srcIp: { $ne: null }, status: { $in: ACTIVE_ALERT } })
      .select("type srcIp dstIp severityRank firstSeen lastSeen")
      .sort({ firstSeen: 1 })
      .limit(5000)
      .lean<AlertLite[]>();
    const bySource = new Map<string, AlertLite[]>();
    for (const a of alerts) if (a.srcIp) bySource.set(a.srcIp, [...(bySource.get(a.srcIp) ?? []), a]);

    let created = 0;
    let linked = 0;
    for (const [src, list] of bySource) {
      let cluster: AlertLite[] = [];
      const flush = async () => {
        if (!cluster.length) return;
        const first = cluster[0];
        if (!first) return;
        const existing = await Incident.findOne({
          orgId,
          "entities.value": src,
          status: { $nin: CLOSED_INCIDENT },
          lastSeen: { $gte: new Date(first.firstSeen.getTime() - windowMs) },
        })
          .sort({ lastSeen: -1 })
          .lean();
        const basis = `Same source address ${src}; each alert started within ${windowMin} minutes of the previous one`;
        if (existing) {
          linked += await linkAlerts(null, orgId, existing._id, cluster.map((c) => c._id), basis);
        } else if (cluster.length >= 2) {
          const stages = stagesOf(cluster);
          const { severity } = incidentSeverity(cluster);
          const top = [...cluster].sort((a, b) => b.severityRank - a.severityRank)[0] ?? first;
          const incident = await Incident.create({
            orgId,
            title: `${stages.length ? stages.join(" → ") : top.type} from ${src}`,
            description:
              `Grouped automatically by Sentinel: ${cluster.length} alerts from ${src} within ${windowMin}-minute gaps. ` +
              "Grouping is a hypothesis to verify, not proof that one actor is behind every alert.",
            attackType: top.type,
            severity,
            priority: PRIORITY[severity],
            sourceIp: src,
            origin: "correlated",
            correlation: { key: `source:${src}`, windowMinutes: windowMin, basis },
          });
          await recordIncidentEvent(null, orgId, incident._id, "correlated", { basis, alerts: cluster.length, stages });
          await linkAlerts(null, orgId, incident._id, cluster.map((c) => c._id), basis);
          created++;
        }
        cluster = [];
      };
      for (const a of list) {
        const prev = cluster.at(-1);
        if (prev && a.firstSeen.getTime() - Math.max(prev.lastSeen.getTime(), prev.firstSeen.getTime()) > windowMs) await flush();
        cluster.push(a);
      }
      await flush();
    }
    if (created || linked) this.logger?.info({ orgId: String(orgId), created, linked }, "Alerts correlated");
    return { created, linked };
  }
}
