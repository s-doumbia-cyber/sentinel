import { MITRE_BY_CLASS, STAGE_BY_CLASS, stageOrder, type AttackClass, type Stage } from "@sentinel/shared";

export interface TimelineAlert {
  id: string;
  type: AttackClass;
  severity: string;
  srcIp: string | null;
  dstIp: string | null;
  dstPort: number | null;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  sources: string[];
  status: string;
  verdict: string | null;
}

export interface AttackStep {
  /** Event time (when the traffic happened), not when Sentinel processed it. */
  at: string;
  until: string;
  stage: Stage | null;
  mitre: string | null;
  fact: string;
  alertId: string;
  severity: string;
  detectedBy: string[];
  analystVerdict: string | null;
}

export interface Hypothesis {
  statement: string;
  basis: string[];
  limits: string[];
}

/**
 * Orders an incident's alerts in event time and states, separately, what the
 * sequence might mean. Facts are alerts Sentinel raised; hypotheses are
 * readings of their order, always with their basis and limits.
 */
export function buildAttackTimeline(alerts: TimelineAlert[]): { steps: AttackStep[]; hypotheses: Hypothesis[] } {
  const ordered = [...alerts].sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime());
  const steps: AttackStep[] = ordered.map((a) => {
    const m = MITRE_BY_CLASS[a.type];
    const target = `${a.dstIp ?? "several targets"}${a.dstIp && a.dstPort !== null ? `:${a.dstPort}` : ""}`;
    return {
      at: a.firstSeen.toISOString(),
      until: a.lastSeen.toISOString(),
      stage: STAGE_BY_CLASS[a.type] ?? null,
      mitre: m ? (m.techniqueId ? `${m.techniqueId} ${m.techniqueName}` : m.tactics.map((t) => t.name).join(", ")) : null,
      fact: `Sentinel raised a ${a.severity} ${a.type} alert for ${a.srcIp ?? "several sources"} → ${target} (${a.count} ${a.count === 1 ? "piece" : "pieces"} of evidence).`,
      alertId: a.id,
      severity: a.severity,
      detectedBy: a.sources,
      analystVerdict: a.verdict,
    };
  });

  const hypotheses: Hypothesis[] = [];
  const stages: Stage[] = [];
  for (const s of steps) if (s.stage && !stages.includes(s.stage)) stages.push(s.stage);
  const sources = new Set(alerts.map((a) => a.srcIp).filter(Boolean));
  const commonLimits = [
    "A shared, NATed or VPN address can mix the activity of different actors.",
    "Each stage comes from a detected class, which can be wrong.",
    "MITRE ATT&CK labels are suggested context, not proof of technique or attribution.",
  ];
  if (stages.length >= 2) {
    const monotonic = stages.every((s, i) => i === 0 || stageOrder(s) > stageOrder(stages[i - 1] as Stage));
    hypotheses.push(
      monotonic
        ? {
            statement: `Possible progression: ${stages.join(" → ")}.`,
            basis: [sources.size === 1 ? `All alerts share the source ${[...sources][0]}` : `${sources.size} sources involved`, "The alerts follow the usual order of an intrusion in time"],
            limits: commonLimits,
          }
        : {
            statement: `Several stages were seen (${stages.join(", ")}) but not in the usual order; they may be unrelated activities.`,
            basis: ["Stage order in event time"],
            limits: commonLimits,
          },
    );
  } else if (steps.length >= 2) {
    hypotheses.push({
      statement: "Repeated activity of the same kind; it may be one ongoing attempt or several separate ones.",
      basis: ["Alerts of the same stage over time"],
      limits: commonLimits.slice(0, 2),
    });
  }
  const dismissed = alerts.filter((a) => a.verdict === "false_positive" || a.verdict === "benign").length;
  if (dismissed) {
    hypotheses.push({
      statement: `${dismissed} alert(s) in this incident were judged false positive or benign by an analyst; conclusions drawn from them should be revisited.`,
      basis: ["Analyst verdicts"],
      limits: [],
    });
  }
  return { steps, hypotheses };
}
