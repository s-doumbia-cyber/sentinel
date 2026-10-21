import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Flow } from "@/lib/types";
import { VerdictBadge } from "./Badges";

const scored = (over: Partial<NonNullable<Flow["scored"]>>): Pick<Flow, "scoreStatus" | "scored" | "scoreError"> => ({
  scoreStatus: "scored",
  scoreError: null,
  scored: {
    modelVersion: "m1",
    label: "Normal",
    confidence: 0.9,
    severity: "info",
    needsReview: false,
    scoredAt: "2026-10-21T10:00:00Z",
    probabilities: null,
    topFeatures: [],
    ...over,
  },
});

describe("VerdictBadge", () => {
  it("shows unusual behaviour next to the class verdict, never instead of it", () => {
    render(<VerdictBadge flow={scored({ label: "Normal", unusualBehaviour: true, novelty: { score: 0.7, threshold: 0.55, aboveThreshold: true } })} />);
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("Unusual behaviour")).toBeInTheDocument();
  });

  it("shows nothing extra for an ordinary verdict", () => {
    render(<VerdictBadge flow={scored({ label: "DDoS", novelty: { score: 0.7, threshold: 0.55, aboveThreshold: true }, unusualBehaviour: false })} />);
    expect(screen.getByText("DDoS")).toBeInTheDocument();
    expect(screen.queryByText("Unusual behaviour")).not.toBeInTheDocument();
  });
});
