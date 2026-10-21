import { describe, expect, it } from "vitest";
import { describeGraph, edgeWidth, nodeSize, sortNodes, toElements, truncationNotice, worstSeverity, type GraphData } from "./model";

const graph = (over: Partial<GraphData> = {}): GraphData => ({
  seeds: ["10.0.0.66"],
  range: { from: null, to: null },
  limits: { maxNodes: 150, maxEdges: 600, depth: 1 },
  nodes: [
    { id: "10.0.0.20", scope: "internal", seed: false, flows: 40, lastSeen: null, alerts: { count: 2, maxSeverity: "high" } },
    { id: "10.0.0.66", scope: "internal", seed: true, flows: 47, lastSeen: null, alerts: null },
    { id: "8.8.8.8", scope: "external", seed: false, flows: 7, lastSeen: null, alerts: null },
  ],
  edges: [
    { source: "10.0.0.66", target: "10.0.0.20", flows: 40, maliciousFlows: 0, firstSeen: "2026-10-19T09:00:00Z", lastSeen: "2026-10-19T09:10:00Z", alerts: { count: 2, maxSeverity: "high" } },
    { source: "10.0.0.66", target: "8.8.8.8", flows: 7, maliciousFlows: 1, firstSeen: "2026-10-19T09:00:00Z", lastSeen: "2026-10-19T09:10:00Z", alerts: null },
  ],
  truncated: { nodes: false, edges: false },
  generatedAt: "2026-10-19T10:00:00Z",
  ...over,
});

describe("graph model", () => {
  it("describes the graph for screen readers", () => {
    expect(describeGraph(graph())).toBe("Network graph: 3 addresses, 2 connections, 1 with alerts.");
    expect(describeGraph(graph({ nodes: [graph().nodes[1]!], edges: [] }))).toBe("Network graph: 1 address, 0 connections.");
  });

  it("explains truncation only when something was cut", () => {
    expect(truncationNotice(graph())).toBeNull();
    expect(truncationNotice(graph({ truncated: { nodes: true, edges: false } }))).toMatch(/busiest addresses only \(limit 150 addresses, 600 connections\)/);
    expect(truncationNotice(graph({ truncated: { nodes: true, edges: true } }))).toMatch(/addresses and connections/);
  });

  it("lists the investigated address first, then the busiest", () => {
    expect(sortNodes(graph().nodes).map((n) => n.id)).toEqual(["10.0.0.66", "10.0.0.20", "8.8.8.8"]);
  });

  it("scales sizes and widths on a log scale within fixed bounds", () => {
    expect(nodeSize(1, false)).toBeLessThan(nodeSize(10_000, false));
    expect(nodeSize(5, true)).toBeGreaterThan(nodeSize(5, false));
    expect(nodeSize(10 ** 9, false)).toBeLessThanOrEqual(38);
    expect(edgeWidth(1, 1000)).toBeCloseTo(1.5, 1);
    expect(edgeWidth(1000, 1000)).toBeCloseTo(9, 1);
    expect(edgeWidth(1, 1)).toBe(2);
  });

  it("builds elements carrying severity, scope and the seed flag as data, not colour", () => {
    const { nodes, edges } = toElements(graph());
    expect(nodes.find((n) => n.data.id === "10.0.0.20")?.data).toMatchObject({ alerted: true, severity: "high", seed: false });
    expect(nodes.find((n) => n.data.id === "10.0.0.66")?.data).toMatchObject({ seed: true, alerted: false, severity: null });
    expect(nodes.find((n) => n.data.id === "8.8.8.8")?.data.scope).toBe("external");
    expect(edges.map((e) => e.data.id)).toEqual(["10.0.0.66>10.0.0.20", "10.0.0.66>8.8.8.8"]);
    expect(edges[0]?.data.width).toBeGreaterThan(edges[1]?.data.width ?? 0);
  });

  it("finds the worst severity", () => {
    expect(worstSeverity([null, { count: 1, maxSeverity: "low" }, { count: 1, maxSeverity: "critical" }])).toBe("critical");
    expect(worstSeverity([null])).toBeNull();
  });
});
