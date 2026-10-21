import { severityRank, type Severity } from "@sentinel/shared";

/** Mirrors apps/api/src/modules/entities/graph.service.ts. */
export interface GraphMarker {
  count: number;
  maxSeverity: Severity;
}

export interface GraphNode {
  id: string;
  scope: "internal" | "external" | "unknown";
  seed: boolean;
  flows: number;
  lastSeen: string | null;
  alerts: GraphMarker | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  flows: number;
  maliciousFlows: number;
  firstSeen: string;
  lastSeen: string;
  alerts: GraphMarker | null;
}

export interface GraphData {
  seeds: string[];
  range: { from: string | null; to: string | null };
  limits: { maxNodes: number; maxEdges: number; depth: 1 | 2 };
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: { nodes: boolean; edges: boolean };
  generatedAt: string;
}

export const edgeId = (e: Pick<GraphEdge, "source" | "target">) => `${e.source}>${e.target}`;

/** One sentence a screen reader can use instead of the canvas. */
export function describeGraph(g: GraphData): string {
  const alerted = g.nodes.filter((n) => n.alerts).length;
  const parts = [`${g.nodes.length} ${g.nodes.length === 1 ? "address" : "addresses"}`, `${g.edges.length} ${g.edges.length === 1 ? "connection" : "connections"}`];
  if (alerted) parts.push(`${alerted} with alerts`);
  return `Network graph: ${parts.join(", ")}.`;
}

/** Why part of the neighbourhood is missing, or null when nothing was cut. */
export function truncationNotice(g: GraphData): string | null {
  const { nodes, edges } = g.truncated;
  if (!nodes && !edges) return null;
  const what = nodes && edges ? "addresses and connections" : nodes ? "addresses" : "connections";
  return `Showing the busiest ${what} only (limit ${g.limits.maxNodes} addresses, ${g.limits.maxEdges} connections). Narrow the time range to see the rest.`;
}

/** Busiest first; seeds always on top; ties by address so the list is stable. */
export function sortNodes(nodes: GraphNode[]): GraphNode[] {
  return [...nodes].sort((a, b) => Number(b.seed) - Number(a.seed) || b.flows - a.flows || a.id.localeCompare(b.id));
}

/** Cytoscape node size in px: log-scaled so one noisy address does not flatten the rest. */
export function nodeSize(flows: number, seed: boolean): number {
  const base = 16 + Math.min(22, Math.log10(Math.max(flows, 1)) * 7);
  return Math.round(seed ? base + 8 : base);
}

/** Edge width in px, 1.5 to 9, log-scaled against the busiest edge. */
export function edgeWidth(flows: number, maxFlows: number): number {
  if (maxFlows <= 1) return 2;
  const t = Math.log10(Math.max(flows, 1)) / Math.log10(maxFlows);
  return Math.round((1.5 + t * 7.5) * 10) / 10;
}

export interface Elements {
  nodes: { data: { id: string; label: string; seed: boolean; size: number; severity: Severity | null; alerted: boolean; scope: string } }[];
  edges: { data: { id: string; source: string; target: string; width: number; severity: Severity | null; alerted: boolean; flows: number } }[];
}

export function toElements(g: GraphData): Elements {
  const maxFlows = g.edges.reduce((m, e) => Math.max(m, e.flows), 1);
  return {
    nodes: g.nodes.map((n) => ({
      data: { id: n.id, label: n.id, seed: n.seed, size: nodeSize(n.flows, n.seed), severity: n.alerts?.maxSeverity ?? null, alerted: n.alerts !== null, scope: n.scope },
    })),
    edges: g.edges.map((e) => ({
      data: { id: edgeId(e), source: e.source, target: e.target, width: edgeWidth(e.flows, maxFlows), severity: e.alerts?.maxSeverity ?? null, alerted: e.alerts !== null, flows: e.flows },
    })),
  };
}

/** Highest severity among markers, for the legend and summaries. */
export function worstSeverity(markers: (GraphMarker | null)[]): Severity | null {
  return markers.reduce<Severity | null>((worst, m) => (m && (worst === null || severityRank(m.maxSeverity) > severityRank(worst)) ? m.maxSeverity : worst), null);
}
