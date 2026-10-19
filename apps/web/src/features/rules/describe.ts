import type { RuleDefinition } from "@sentinel/shared";

const FIELD_LABEL: Record<string, string> = {
  sourceIp: "source IP",
  destinationIp: "destination IP",
  destinationPort: "destination port",
  sourcePort: "source port",
  protocol: "protocol",
};

/** Plain-language sentence for a threshold rule, so analysts need not read JSON. */
export function describeRule(r: Pick<RuleDefinition, "window" | "groupBy" | "condition" | "filter">): string {
  const what = r.condition.distinct
    ? `${r.condition.gte} or more distinct ${FIELD_LABEL[r.condition.distinct] ?? r.condition.distinct}s`
    : `${r.condition.gte} or more flows`;
  const per = r.groupBy.map((g) => FIELD_LABEL[g] ?? g).join(" + ");
  const f = r.filter ?? {};
  const conditions: string[] = [];
  if (f.destinationPorts) conditions.push(`to port${f.destinationPorts.length > 1 ? "s" : ""} ${f.destinationPorts.join(", ")}`);
  if (f.maxPacketsPerFlow !== undefined) conditions.push(`at most ${f.maxPacketsPerFlow} packets per flow`);
  if (f.minPacketsPerFlow !== undefined) conditions.push(`at least ${f.minPacketsPerFlow} packets per flow`);
  if (f.maxDurationMs !== undefined) conditions.push(`lasting at most ${f.maxDurationMs / 1000} s`);
  if (f.minDurationMs !== undefined) conditions.push(`lasting at least ${f.minDurationMs / 1000} s`);
  for (const [k, v] of Object.entries(f.featureGte ?? {})) conditions.push(`${k} ≥ ${v}`);
  for (const [k, v] of Object.entries(f.featureLte ?? {})) conditions.push(`${k} ≤ ${v}`);
  const scope = f.protocol || conditions.length ? `, counting only ${f.protocol ? `${f.protocol} ` : ""}flows${conditions.length ? ` ${conditions.join(", ")}` : ""}` : "";
  return `Fires on ${what} per ${per} within ${r.window}${scope}.`;
}
