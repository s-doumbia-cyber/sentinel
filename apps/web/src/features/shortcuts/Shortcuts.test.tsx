import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { useHotkeys } from "./useHotkeys";

const role = vi.hoisted(() => ({ can: ((_a: string) => true) as (a: string) => boolean }));
const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ can: role.can, activeOrg: { id: "org1", name: "Org", role: "Analyst" }, user: null, setUser: () => {} }),
  applyPreferences: () => {},
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), api: apiMock }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ success: () => {}, error: () => {} }) }));

import { ShortcutsProvider } from "./ShortcutsProvider";

beforeAll(() => {
  // jsdom lacks what cmdk uses to keep the selected row in view.
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function renderApp(extra?: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/start"]}>
        <ShortcutsProvider>
          <Where />
          <input aria-label="a field" />
          {extra}
        </ShortcutsProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key, ...init });
const type = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } });

beforeEach(() => {
  role.can = () => true;
  apiMock.mockReset();
  apiMock.mockRejectedValue(new ApiError(404, "NOT_FOUND", "not found"));
});
afterEach(() => vi.useRealTimers());

describe("G then a letter", () => {
  it("navigates to the page", () => {
    renderApp();
    press("g");
    press("a");
    expect(screen.getByTestId("where")).toHaveTextContent("/alerts");
    press("g");
    press("i");
    expect(screen.getByTestId("where")).toHaveTextContent("/incidents");
  });

  it("forgets a lone G after a moment", () => {
    vi.useFakeTimers();
    renderApp();
    press("g");
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    press("a");
    expect(screen.getByTestId("where")).toHaveTextContent("/start");
  });

  it("is ignored while typing in a field", () => {
    renderApp();
    const field = screen.getByLabelText("a field");
    fireEvent.keyDown(field, { key: "g" });
    fireEvent.keyDown(field, { key: "a" });
    expect(screen.getByTestId("where")).toHaveTextContent("/start");
  });

  it("does not take a role to pages it cannot open", () => {
    role.can = (a) => a !== "audit:read";
    renderApp();
    press("g");
    press("u");
    expect(screen.getByTestId("where")).toHaveTextContent("/start");
  });

  it("is ignored while a dialog is open", async () => {
    renderApp();
    press("?");
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    press("g");
    press("a");
    expect(screen.getByTestId("where")).toHaveTextContent("/start");
  });
});

describe("shortcuts overlay", () => {
  it("opens with ? and lists the shortcuts", async () => {
    renderApp();
    press("?");
    const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog).toHaveTextContent("Open the command palette");
    expect(dialog).toHaveTextContent("Acknowledge the alert");
    expect(dialog).toHaveTextContent("Executive report");
  });
});

describe("command palette", () => {
  it("opens with Ctrl+K, filters pages and navigates with Enter", async () => {
    renderApp();
    press("k", { ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: /Search pages/ });
    type(input, "alert");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/alerts"));
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("opens with Cmd+K and Esc closes it", async () => {
    renderApp();
    press("k", { metaKey: true });
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Command palette" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument());
  });

  it("hides pages the role cannot open", async () => {
    role.can = (a) => a !== "audit:read";
    renderApp();
    press("k", { ctrlKey: true });
    await screen.findByRole("dialog", { name: "Command palette" });
    expect(screen.getByRole("option", { name: /Alerts/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Audit log/ })).not.toBeInTheDocument();
  });

  it("jumps to an address by IP", async () => {
    renderApp();
    press("k", { ctrlKey: true });
    type(await screen.findByRole("combobox"), "10.0.0.66");
    fireEvent.click(await screen.findByRole("option", { name: /Open asset 10\.0\.0\.66/ }));
    expect(screen.getByTestId("where")).toHaveTextContent("/assets/10.0.0.66");
  });

  it("finds an incident and an alert by id, and says so when nothing matches", async () => {
    const id = "64f1c0a2b3c4d5e6f7a8b9c0";
    apiMock.mockImplementation(async (path: string) => {
      if (path === `/incidents/${id}`) return { id, title: "Discovery → Credential access" };
      if (path === `/alerts/${id}`) return { id, type: "PortScan", srcIp: "10.0.0.66" };
      throw new ApiError(404, "NOT_FOUND", "not found");
    });
    renderApp();
    press("k", { ctrlKey: true });
    const input = await screen.findByRole("combobox");
    type(input, id);
    expect(await screen.findByRole("option", { name: /Discovery → Credential access/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /PortScan alert from 10\.0\.0\.66/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Flow/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /PortScan alert/ }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/alerts?alert=${id}&status=all`);

    apiMock.mockRejectedValue(new ApiError(404, "NOT_FOUND", "not found"));
    press("k", { ctrlKey: true });
    const again = await screen.findByRole("combobox");
    type(again, "0123456789abcdef01234567");
    expect(await screen.findByText(/No alert, incident or flow with that id/)).toBeInTheDocument();
  });

  it("offers matching assets while an address is typed", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/assets") return { items: [{ ip: "10.0.0.66", scope: "internal" }, { ip: "10.0.0.67", scope: "internal" }], nextCursor: null };
      throw new ApiError(404, "NOT_FOUND", "not found");
    });
    renderApp();
    press("k", { ctrlKey: true });
    type(await screen.findByRole("combobox"), "10.0.0");
    expect(await screen.findByRole("option", { name: /10\.0\.0\.67/ })).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/assets", expect.objectContaining({ query: expect.objectContaining({ q: "10.0.0", limit: 6 }) }));
  });
});

describe("useHotkeys", () => {
  function Probe({ onKey, enabled = true }: { onKey: () => void; enabled?: boolean }) {
    useHotkeys({ e: onKey }, enabled);
    return <input aria-label="note" />;
  }

  it("runs the handler for its key, case-insensitively", () => {
    const fn = vi.fn();
    renderApp(<Probe onKey={fn} />);
    press("e");
    press("E");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stays quiet in a field, with a modifier, or when disabled", () => {
    const fn = vi.fn();
    const { rerender } = renderApp(<Probe onKey={fn} />);
    fireEvent.keyDown(screen.getByLabelText("note"), { key: "e" });
    press("e", { ctrlKey: true });
    press("e", { metaKey: true });
    press("e", { altKey: true });
    expect(fn).not.toHaveBeenCalled();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ShortcutsProvider>
            <Probe onKey={fn} enabled={false} />
          </ShortcutsProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    press("e");
    expect(fn).not.toHaveBeenCalled();
  });
});
