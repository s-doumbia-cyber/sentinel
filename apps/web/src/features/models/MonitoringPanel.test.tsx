import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriftOverview, DriftRunResult, ModelFeedback } from "@/lib/types";
import { MonitoringPanel } from "./MonitoringPanel";

const state: { drift: DriftOverview; feedback: ModelFeedback; runResult: DriftRunResult | null; runs: number } = {
  drift: { latest: null, history: [] },
  feedback: { modelVersion: "m1", totals: { alerts: 0, reviewed: 0, truePositive: 0, falsePositive: 0, benign: 0, unreviewed: 0, withRuleEvidence: 0 }, confirmedShareOfReviewed: null, byType: [] },
  runResult: null,
  runs: 0,
};

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ can: () => true }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/queries", () => ({
  useDrift: () => ({ data: state.drift, isLoading: false, isError: false }),
  useModelFeedback: () => ({ data: state.feedback, isLoading: false, isError: false }),
  useOrgMutation: () => ({
    isPending: false,
    mutate: (_h: number, o?: { onSuccess?: (r: DriftRunResult) => void }) => {
      state.runs += 1;
      if (state.runResult) o?.onSuccess?.(state.runResult);
    },
  }),
}));

beforeEach(() => {
  state.drift = { latest: null, history: [] };
  state.runResult = null;
  state.runs = 0;
  state.feedback = { ...state.feedback, totals: { alerts: 0, reviewed: 0, truePositive: 0, falsePositive: 0, benign: 0, unreviewed: 0, withRuleEvidence: 0 }, byType: [], confirmedShareOfReviewed: null };
});

describe("MonitoringPanel", () => {
  it("shows empty states and never invents numbers when nothing was checked or reviewed", () => {
    render(<MonitoringPanel version="m1" active />);
    expect(screen.getByText("No drift check yet")).toBeInTheDocument();
    expect(screen.getByText("No alerts from this model yet")).toBeInTheDocument();
  });

  it("shows the drift level as text plus icon, with glossary labels for the drifted features", () => {
    state.drift = {
      history: [],
      latest: {
        id: "d1",
        createdAt: "2026-10-21T10:00:00Z",
        windowHours: 24,
        referenceRows: 5000,
        sampleSize: 1234,
        maxPsi: 0.4312,
        level: "significant",
        driftedFeatureCount: 1,
        features: [{ name: "Flow Packets/s", psi: 0.4312, level: "significant", missingCurrent: 0.1, missingReference: 0, values: 1111 }],
        predictedClassShare: { DDoS: 0.8, Normal: 0.2 },
        trainingClassShare: { Normal: 0.9, DDoS: 0.1 },
      },
    };
    render(<MonitoringPanel version="m1" active />);
    expect(screen.getAllByText("Significant change").length).toBeGreaterThan(0);
    expect(screen.getByText("Packets per second")).toBeInTheDocument();
    expect(screen.getByText("0.431")).toBeInTheDocument();
    expect(screen.getByText(/shows that inputs changed, not that detection got worse/)).toBeInTheDocument();
  });

  it("explains an insufficient sample instead of showing a report", () => {
    state.runResult = { status: "insufficient_data", sampleSize: 12, minimum: 200, windowHours: 24 };
    render(<MonitoringPanel version="m1" active />);
    fireEvent.click(screen.getByRole("button", { name: "Check drift now" }));
    expect(state.runs).toBe(1);
    expect(screen.getByRole("status")).toHaveTextContent(/Only 12 flow\(s\).*at least 200.*Nothing was recorded/);
  });

  it("describes analyst feedback as reviewed-only, not precision", () => {
    state.feedback = {
      modelVersion: "m1",
      totals: { alerts: 10, reviewed: 4, truePositive: 3, falsePositive: 1, benign: 0, unreviewed: 6, withRuleEvidence: 0 },
      confirmedShareOfReviewed: 0.75,
      byType: [{ type: "DDoS", truePositive: 3, falsePositive: 1, benign: 0, unreviewed: 6 }],
    };
    render(<MonitoringPanel version="m1" active />);
    expect(screen.getByText(/10 alert\(s\): 4 reviewed \(3 true positive, 1 false positive/)).toBeInTheDocument();
    expect(screen.getByText(/not the model’s precision/)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "6" })).toBeInTheDocument();
  });
});
