import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Attribution } from "@/lib/types";
import { AnalysisPanel, AttributionPanel } from "./Evidence";

const base: Attribution = {
  ip: "10.0.0.66",
  scope: "internal",
  window: { from: "2026-10-19T09:10:00Z", to: "2026-10-19T09:14:34Z" },
  connectedSources: [],
  candidates: [],
  ambiguous: false,
  caveats: ["An IP address alone does not identify a person or a group."],
  help: ["DHCP lease logs map internal addresses to device names and MAC addresses over time."],
};

const renderPanel = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("AnalysisPanel", () => {
  it("keeps observations, inferences and unknowns in separate labelled sections", () => {
    render(
      <AnalysisPanel
        analysis={{
          observed: [{ text: "45 flows to 10.0.0.20:22", basis: "Imported file" }],
          inferred: [{ text: "The activity resembles SSHPatator." }],
          unknown: [],
        }}
      />,
    );
    expect(within(screen.getByRole("region", { name: "Observed" })).getByText("45 flows to 10.0.0.20:22")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Inferred" })).getByText(/resembles SSHPatator/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Unknown" })).getByText("Nothing to list.")).toBeInTheDocument();
  });
});

describe("AttributionPanel", () => {
  it("answers unknown, names the missing sources and never invents an identity", () => {
    renderPanel(<AttributionPanel attribution={base} restricted={false} ip="10.0.0.66" />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText(/No identity source is connected/)).toBeInTheDocument();
    expect(screen.getByText(/DHCP lease logs map/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Import identity records" })).toHaveAttribute("href", "/identity");
    expect(screen.getByText(/does not identify a person/)).toBeInTheDocument();
  });

  it("shows each candidate with its source, confidence and reasons, and flags ambiguity", () => {
    const attribution: Attribution = {
      ...base,
      connectedSources: [{ source: "dhcp", label: "DHCP lease log" }],
      ambiguous: true,
      candidates: [
        { username: null, hostname: "UNMANAGED-66", mac: null, source: "dhcp", validFrom: "2026-10-19T08:55:00Z", validTo: "2026-10-19T09:40:00Z", confidence: "medium", reasons: ["The record covers the whole activity window"] },
        { username: "demo.user31", hostname: null, mac: null, source: "auth", validFrom: "2026-10-19T09:00:00Z", validTo: null, confidence: "low", reasons: ["Single event"] },
      ],
    };
    renderPanel(<AttributionPanel attribution={attribution} restricted={false} ip="10.0.0.66" />);
    expect(screen.getByText("UNMANAGED-66")).toBeInTheDocument();
    expect(screen.getByText("medium confidence")).toBeInTheDocument();
    expect(screen.getByText("low confidence")).toBeInTheDocument();
    expect(screen.getByText(/Several identities held this address/)).toBeInTheDocument();
    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
  });

  it("hides identity data from roles without access", () => {
    renderPanel(<AttributionPanel attribution={null} restricted ip="10.0.0.66" />);
    expect(screen.getByText(/restricted to Analysts and above/)).toBeInTheDocument();
  });
});
