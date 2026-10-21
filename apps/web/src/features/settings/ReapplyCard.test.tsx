import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReapplyStatus } from "@/lib/types";
import { ReapplyCard } from "./ReapplyCard";

const state: { manage: boolean; data: ReapplyStatus; started: number } = {
  manage: true,
  started: 0,
  data: { running: false, preview: { alertsRebuilt: 12, alertsKept: 3, incidentsRebuilt: 2, incidentsKept: 1 }, last: null },
};

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ can: () => state.manage }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/queries", () => ({
  useReapplyStatus: () => ({ data: state.data, isLoading: false, isError: false }),
  useOrgMutation: () => ({
    isPending: false,
    mutate: (_v: unknown, o?: { onSuccess?: () => void }) => {
      state.started += 1;
      o?.onSuccess?.();
    },
  }),
}));

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReapplyCard />
    </QueryClientProvider>,
  );

beforeEach(() => {
  state.manage = true;
  state.started = 0;
  state.data = { running: false, preview: { alertsRebuilt: 12, alertsKept: 3, incidentsRebuilt: 2, incidentsKept: 1 }, last: null };
});

describe("ReapplyCard", () => {
  it("states what will be rebuilt and what is kept, and only starts after the confirmation", async () => {
    renderCard();
    expect(screen.getByText(/12 alert\(s\) and 2 incident\(s\) would be rebuilt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild alerts with the saved settings" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/delete and rebuild/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Flows and their verdicts are not changed/)).toBeInTheDocument();
    expect(state.started).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Rebuild alerts" }));
    expect(state.started).toBe(1);
  });

  it("cancelling the dialog starts nothing", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Rebuild alerts with the saved settings" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(state.started).toBe(0);
  });

  it("is disabled while a run is in progress and says so", () => {
    state.data = { ...state.data, running: true };
    renderCard();
    expect(screen.getByRole("status")).toHaveTextContent(/Rebuilding alerts in the background/);
    expect(screen.getByRole("button", { name: "Rebuild alerts with the saved settings" })).toBeDisabled();
  });

  it("shows the last outcome, including a failure", () => {
    state.data = { ...state.data, last: { at: "2026-10-21T10:00:00Z", status: "failed", error: "Mongo went away" } };
    renderCard();
    expect(screen.getByRole("alert")).toHaveTextContent(/failed: Mongo went away/);
  });

  it("offers no button to people who cannot manage detection", () => {
    state.manage = false;
    renderCard();
    expect(screen.queryByRole("button", { name: /Rebuild alerts/ })).not.toBeInTheDocument();
    expect(screen.getByText("Only Owners and Admins can rebuild alerts.")).toBeInTheDocument();
  });
});
