import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutiveReport } from "@/lib/types";
import { lastDays, rangeError, readRange, toIsoRange, writeRange } from "./range";

const apiMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: apiMock, apiDownload: downloadMock, saveBlob: saveMock }));
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ activeOrg: { id: "org1" } }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toastMock }));

import { ExecutivePreview } from "./ExecutivePreview";
import { ReportsPage } from "./ReportsPage";

const report = (over: Partial<ExecutiveReport> = {}): ExecutiveReport => ({
  meta: { reportVersion: 1, generatedAt: "2026-10-21T10:00:00.000Z", organisation: "E2E SOC", timezone: "UTC", range: { from: "2017-07-07T00:00:00.000Z", to: "2017-07-07T23:59:59.999Z" } },
  headline: ["190 flows in the period; 30 carry a malicious model verdict.", "3 alert(s) overlapped the period (1 critical, 1 medium, 1 low)."],
  flows: { totalFlows: 190, scoredFlows: 190, pendingFlows: 0, errorFlows: 0, maliciousFlows: 30, needsReviewFlows: 0, maliciousSourceIps: 1, bySourceKind: { IMPORTED: 190 }, dataRange: null },
  verdicts: [
    { key: "Normal", count: 160 },
    { key: "DDoS", count: 30 },
  ],
  topSources: [{ key: "10.7.7.7", count: 30, classes: ["DDoS"], lastSeen: "2017-07-07T04:10:00.000Z" }],
  topPorts: [{ key: "80", count: 30, classes: ["DDoS"], lastSeen: "2017-07-07T04:10:00.000Z" }],
  alerts: { byStatus: { open: 2, acknowledged: 1 }, activeBySeverity: { critical: 1, medium: 1, low: 1 }, bySeverity: { critical: 1, medium: 1, low: 1 }, byType: { DDoS: 1, PortScan: 1, SSHPatator: 1 }, total: 3 },
  incidents: { total: 1, openNow: 1, byStatus: { Open: 1 }, bySeverity: { high: 1 }, byType: { PortScan: 1 } },
  triage: { alertsConsidered: 3, triaged: 1, untriaged: 2, meanMinutes: 4.5, medianMinutes: 4.5, basis: "Time between Sentinel raising an alert and the first change an analyst made to it." },
  evaluation: { evaluatedFlows: 190, macroF1: 0.5, perClass: [{ label: "DDoS", precision: 1, recall: 1, f1: 1, support: 30, predicted: 30, unstable: false }, { label: "PortScan", precision: 0, recall: 0, f1: 0, support: 5, predicted: 0, unstable: true }], modelVersions: ["bench-a"] },
  provenance: { datasets: [{ name: "flows.csv", sourceKind: "IMPORTED", sha256: "a".repeat(64), flows: 190 }], flowsWithoutDataset: 0, models: ["bench-a"], rules: [{ key: "R-PORTSCAN-01", version: 1 }] },
  limitations: ["Malicious means a model verdict or a rule hit, never a dataset label."],
  ...over,
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}
function renderPage(url = "/reports") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <ReportsPage />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.mockReset();
  downloadMock.mockReset();
  saveMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/reports/executive") return report();
    if (path === "/stats/overview") return { ...report().flows, dataRange: { from: "2017-07-07T03:40:00.000Z", to: "2017-07-07T04:20:00.000Z" } };
    throw new Error(`unexpected ${path}`);
  });
});

describe("report range in the URL", () => {
  it("reads only real UTC days and ignores the rest", () => {
    expect(readRange(new URLSearchParams("from=2017-07-07&to=2017-07-08"))).toEqual({ from: "2017-07-07", to: "2017-07-08" });
    expect(readRange(new URLSearchParams("from=2017-02-30&to=yesterday"))).toEqual({ from: null, to: null });
    expect(readRange(new URLSearchParams(""))).toEqual({ from: null, to: null });
  });
  it("makes both days inclusive and flags an inverted range", () => {
    expect(toIsoRange({ from: "2017-07-07", to: "2017-07-08" })).toEqual({ from: "2017-07-07T00:00:00.000Z", to: "2017-07-08T23:59:59.999Z" });
    expect(toIsoRange({ from: null, to: null })).toEqual({});
    expect(rangeError({ from: "2017-07-09", to: "2017-07-08" })).toMatch(/start day is after/);
    expect(rangeError({ from: "2017-07-08", to: "2017-07-08" })).toBeNull();
  });
  it("keeps other URL parameters when it writes the range, and counts today as the last day", () => {
    expect(writeRange(new URLSearchParams("x=1&from=2017-01-01"), { from: null, to: "2017-07-08" }).toString()).toBe("x=1&to=2017-07-08");
    expect(lastDays(7, new Date("2026-10-21T10:00:00Z"))).toEqual({ from: "2026-10-15", to: "2026-10-21" });
  });
});

describe("ReportsPage", () => {
  it("loads the report for the range in the URL and shows the same sections the PDF has", async () => {
    renderPage("/reports?from=2017-07-07&to=2017-07-07");
    expect(screen.getByRole("status", { name: "Loading report" })).toBeInTheDocument();
    expect(await screen.findByText("190 flows in the period; 30 carry a malicious model verdict.")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/reports/executive", { query: { from: "2017-07-07T00:00:00.000Z", to: "2017-07-07T23:59:59.999Z" } });
    for (const heading of ["Summary", "Alerts", "Incidents", "Time to triage", "Traffic and verdicts", "Top sources and ports", "Detection quality on labelled data", "Provenance", "Limitations"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    // Severity is a badge with text, not colour alone.
    const severity = within(screen.getByRole("table", { name: "Alerts by severity" }));
    expect(severity.getByText("CRITICAL")).toBeInTheDocument();
    // Detection quality shows per-class figures and flags unstable estimates.
    expect(screen.getByRole("table", { name: /Per-class precision/ })).toHaveTextContent("PortScan *");
  });

  it("changes the URL, not local state, when the period changes", async () => {
    renderPage();
    await screen.findByText(/190 flows/);
    fireEvent.change(screen.getByLabelText(/From \(UTC day\)/), { target: { value: "2017-07-01" } });
    expect(screen.getByTestId("where")).toHaveTextContent("/reports?from=2017-07-01");
    fireEvent.click(screen.getByRole("button", { name: "Span of stored flows" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("from=2017-07-07&to=2017-07-07"));
    fireEvent.click(screen.getByRole("button", { name: "All stored data" }));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/reports$/);
  });

  it("refuses an inverted period instead of asking the API", async () => {
    renderPage("/reports?from=2017-07-09&to=2017-07-08");
    expect(await screen.findByRole("alert")).toHaveTextContent(/start day is after/);
    expect(apiMock).not.toHaveBeenCalledWith("/reports/executive", expect.anything());
    expect(screen.getByRole("button", { name: /Download PDF/ })).toBeDisabled();
  });

  it("downloads the PDF for the same period and says what was saved", async () => {
    downloadMock.mockResolvedValue({ blob: new Blob(["%PDF"]), filename: "sentinel-executive-report-2017-07-07_2017-07-07.pdf" });
    renderPage("/reports?from=2017-07-07&to=2017-07-07");
    await screen.findByText(/190 flows/);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledOnce());
    expect(downloadMock).toHaveBeenCalledWith("/reports/executive/pdf", { query: { from: "2017-07-07T00:00:00.000Z", to: "2017-07-07T23:59:59.999Z" } });
    expect(toastMock.success).toHaveBeenCalledWith("Saved sentinel-executive-report-2017-07-07_2017-07-07.pdf");
  });

  it("reports a failed PDF without losing the page", async () => {
    downloadMock.mockRejectedValue(new Error("Server busy"));
    renderPage();
    await screen.findByText(/190 flows/);
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Could not generate the PDF: Server busy"));
    expect(saveMock).not.toHaveBeenCalled();
    expect(screen.getByText(/190 flows/)).toBeInTheDocument();
  });

  it("shows an error with a retry, and an empty state for a period with nothing in it", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/reports/executive") throw new Error("boom");
      return report().flows;
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    apiMock.mockImplementation(async (path: string) => (path === "/reports/executive" ? report({ flows: { ...report().flows, totalFlows: 0 }, alerts: { ...report().alerts, total: 0 }, incidents: { ...report().incidents, total: 0 } }) : report().flows));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No flows, alerts or incidents in this period")).toBeInTheDocument();
  });
});

describe("ExecutivePreview", () => {
  it("says so when nothing is labelled and when nobody has triaged", () => {
    render(
      <MemoryRouter>
        <ExecutivePreview report={report({ evaluation: null, triage: { alertsConsidered: 3, triaged: 0, untriaged: 3, meanMinutes: null, medianMinutes: null, basis: "basis" } })} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No flow in this period carries a ground-truth label/)).toBeInTheDocument();
    expect(screen.getAllByText("n/a").length).toBeGreaterThanOrEqual(2);
  });
});
