import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "@/features/auth/AuthPages";
import i18n, { setUiLanguage, uiLanguage } from "./index";
import { en } from "./en";
import { fr } from "./fr";

vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ status: "anonymous", login: vi.fn(), verifyMfa: vi.fn() }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

type Tree = { [k: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [[`${prefix}${k}`, v] as [string, string]] : leaves(v, `${prefix}${k}.`)));
}

const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}|<(\w+)>/g)].map((m) => m[1] ?? `<${m[2]}>`).sort();

afterEach(() => setUiLanguage("en"));

describe("translations", () => {
  const enLeaves = new Map(leaves(en));
  const frLeaves = new Map(leaves(fr));

  it("give French the same keys as English, none empty", () => {
    expect([...frLeaves.keys()].sort()).toEqual([...enLeaves.keys()].sort());
    for (const [key, value] of frLeaves) expect(value.trim(), key).not.toBe("");
  });

  it("keep every placeholder and inline tag in French", () => {
    for (const [key, value] of enLeaves) expect(placeholders(frLeaves.get(key) ?? ""), key).toEqual(placeholders(value));
  });

  it("show English for a preference with no translation yet, instead of guessing", () => {
    expect(uiLanguage("hi")).toBe("en");
    expect(uiLanguage("fr")).toBe("fr");
    expect(uiLanguage(undefined)).toBe("en");
  });
});

describe("language switch", () => {
  it("translates the sign-in page and sets <html lang>", async () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Français" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Se connecter" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Français" })).toHaveAttribute("aria-pressed", "true");
    expect(document.documentElement.lang).toBe("fr");
    expect(i18n.language).toBe("fr");
  });
});
