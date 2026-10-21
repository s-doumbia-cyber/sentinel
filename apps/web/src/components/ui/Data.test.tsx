import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeatureContributionChart } from "./Data";

describe("FeatureContributionChart", () => {
  it("shows plain-language labels with units, keeping the model feature name visible", () => {
    render(
      <FeatureContributionChart
        features={[
          { name: "Flow Packets/s", contribution: 0.21, value: 812.4 },
          { name: "Flow Duration", contribution: -0.05, value: 2500 },
          { name: "SYN Flag Count", contribution: 0.02, value: null },
        ]}
      />,
    );
    expect(screen.getByText("Packets per second")).toBeInTheDocument();
    expect(screen.getByText(/value 812 packets\/s/)).toBeInTheDocument();
    expect(screen.getByText(/value 2\.5 ms/)).toBeInTheDocument();
    expect(screen.getByText(/value missing \(imputed\)/)).toBeInTheDocument();
    expect(screen.getByText(/· Flow Packets\/s/)).toBeInTheDocument();
    expect(screen.getByText(/Packets per second increased the score by 0\.210/)).toBeInTheDocument();
    expect(screen.getByText(/describe the model’s behaviour, not the cause/)).toBeInTheDocument();
  });

  it("falls back to the raw name for a feature the glossary does not know", () => {
    render(<FeatureContributionChart features={[{ name: "unknown_feature", contribution: 0.3, value: 4 }]} />);
    expect(screen.getAllByText("unknown_feature").length).toBeGreaterThan(0);
    expect(screen.getByText(/value 4/)).toBeInTheDocument();
  });
});
