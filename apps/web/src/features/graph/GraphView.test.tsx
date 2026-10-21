import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { GraphView } from "./GraphView";
import type { GraphData } from "./model";

// The canvas needs a real browser (the Playwright suite covers it); here it is a stand-in that
// exposes what GraphView hands it.
vi.mock("./GraphCanvas", () => ({
  default: ({ data, onOpenNode }: { data: GraphData; onOpenNode: (ip: string) => void }) => (
    <button type="button" data-testid="canvas" onClick={() => onOpenNode(data.nodes[0]?.id ?? "")}>
      canvas with {data.nodes.length} nodes
    </button>
  ),
}));

const data: GraphData = {
  seeds: ["10.0.0.66"],
  range: { from: null, to: null },
  limits: { maxNodes: 150, maxEdges: 600, depth: 1 },
  nodes: [
    { id: "10.0.0.66", scope: "internal", seed: true, flows: 47, lastSeen: "2026-10-19T09:10:00Z", alerts: null },
    { id: "10.0.0.20", scope: "internal", seed: false, flows: 40, lastSeen: "2026-10-19T09:10:00Z", alerts: { count: 2, maxSeverity: "high" } },
  ],
  edges: [{ source: "10.0.0.66", target: "10.0.0.20", flows: 40, maliciousFlows: 3, firstSeen: "2026-10-19T09:00:00Z", lastSeen: "2026-10-19T09:10:00Z", alerts: { count: 2, maxSeverity: "high" } }],
  truncated: { nodes: false, edges: false },
  generatedAt: "2026-10-19T10:00:00Z",
};

function renderView(props: Partial<React.ComponentProps<typeof GraphView>> = {}) {
  return render(
    <MemoryRouter initialEntries={["/start"]}>
      <Routes>
        <Route path="/start" element={<GraphView data={data} isLoading={false} error={null} onRetry={() => {}} {...props} />} />
        <Route path="/assets/:ip" element={<p>asset page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("GraphView", () => {
  it("shows a loading state", () => {
    renderView({ isLoading: true, data: undefined });
    expect(screen.getByRole("status", { name: "Loading graph" })).toBeInTheDocument();
  });

  it("shows the canvas and a text summary once loaded", async () => {
    renderView();
    expect(await screen.findByTestId("canvas")).toHaveTextContent("canvas with 2 nodes");
    expect(screen.getByText("Network graph: 2 addresses, 1 connection, 1 with alerts.")).toBeInTheDocument();
  });

  it("shows an error with a retry", () => {
    const onRetry = vi.fn();
    renderView({ data: undefined, error: new Error("boom"), onRetry });
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows an empty state when there is no traffic in the range", () => {
    renderView({ data: { ...data, nodes: data.nodes.slice(0, 1), edges: [] } });
    expect(screen.getByText("No traffic between these addresses in this range")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).not.toBeInTheDocument();
  });

  it("opens the asset page when a node is activated on the canvas", async () => {
    renderView();
    fireEvent.click(await screen.findByTestId("canvas"));
    expect(await screen.findByText("asset page")).toBeInTheDocument();
  });

  it("says when the neighbourhood was cut short", () => {
    renderView({ data: { ...data, truncated: { nodes: true, edges: false } } });
    expect(screen.getByRole("note")).toHaveTextContent(/busiest addresses only/);
  });

  it("offers a list with every address as a link, alerts spelled out, and the connections", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    // The investigated address comes first and is labelled; alerts carry a text severity.
    expect(within(rows[1]!).getByRole("link", { name: "10.0.0.66" })).toHaveAttribute("href", "/assets/10.0.0.66");
    expect(within(rows[1]!).getByText("under investigation")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("HIGH")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText(/10\.0\.0\.66 → 10\.0\.0\.20 · 40 flows · 3 flagged by the model · 2 alert\(s\), worst HIGH/)).toBeInTheDocument();
    fireEvent.click(within(rows[2]!).getByRole("link", { name: "10.0.0.20" }));
    expect(await screen.findByText("asset page")).toBeInTheDocument();
  });

  it("lets the page decide what opening a node does", () => {
    const onOpenNode = vi.fn();
    renderView({ onOpenNode });
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(screen.getByRole("button", { name: "10.0.0.20" }));
    expect(onOpenNode).toHaveBeenCalledWith("10.0.0.20");
  });
});
