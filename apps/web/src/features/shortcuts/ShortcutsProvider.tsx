import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { NAV } from "@/components/layout/nav";
import { Dialog } from "@/components/ui/Overlays";
import { useAuth } from "@/features/auth/AuthContext";
import { CommandPalette } from "./CommandPalette";
import { dialogIsOpen, isEditableTarget, SHORTCUT_GROUPS, type ShortcutRow } from "./keys";

interface ShortcutsValue {
  openPalette: () => void;
  openHelp: () => void;
}

const Ctx = createContext<ShortcutsValue | null>(null);

export function useShortcuts(): ShortcutsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useShortcuts must be used inside ShortcutsProvider");
  return v;
}

/** How long "G" waits for its second key. */
export const SEQUENCE_MS = 1200;

function Keys({ row }: { row: ShortcutRow }) {
  const sep = row.join === "then" ? "then" : row.join === "or" ? "or" : row.join === "plus" ? "+" : "";
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {row.keys.map((k, i) => (
        <span key={k} className="flex items-center gap-1.5">
          {i > 0 && sep && <span className="text-caption text-fg-3">{sep}</span>}
          <kbd className="min-w-[24px] rounded-sm border bg-surface-2 px-1.5 py-0.5 text-center font-mono text-caption text-fg-1">{k}</kbd>
        </span>
      ))}
    </span>
  );
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="Single-letter shortcuts are off while you type in a field, and G-then-letter navigation is off while a panel or dialog is open.">
      <div role="region" aria-label="Keyboard shortcuts list" tabIndex={0} className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h3 className="mb-2 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">{g.title}</h3>
            <ul className="space-y-1.5">
              {g.rows.map((r) => (
                <li key={r.label} className="flex items-center justify-between gap-4 text-small">
                  <span className="text-fg-2">{r.label}</span>
                  <Keys row={r} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** Global shortcuts: Ctrl/Cmd+K palette, ? overlay and G-then-letter navigation. */
export function ShortcutsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const pendingG = useRef<number | null>(null);
  const canRef = useRef(can);
  canRef.current = can;

  const openPalette = useCallback(() => {
    setHelp(false);
    setPalette(true);
  }, []);
  const openHelp = useCallback(() => {
    setPalette(false);
    setHelp(true);
  }, []);

  useEffect(() => {
    const clear = () => {
      if (pendingG.current !== null) window.clearTimeout(pendingG.current);
      pendingG.current = null;
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        clear();
        setHelp(false);
        setPalette((p) => !p);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || isEditableTarget(e.target) || dialogIsOpen()) return;
      if (e.key === "?") {
        e.preventDefault();
        clear();
        openHelp();
        return;
      }
      const key = e.key.toLowerCase();
      if (pendingG.current !== null) {
        clear();
        const target = NAV.flatMap((g) => g.items).find((i) => i.go === key);
        if (target && (!target.requires || canRef.current(target.requires))) {
          e.preventDefault();
          navigate(target.to);
        }
        return;
      }
      if (key === "g" && !e.shiftKey) pendingG.current = window.setTimeout(clear, SEQUENCE_MS);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      clear();
    };
  }, [navigate, openHelp]);

  const value = useMemo(() => ({ openPalette, openHelp }), [openPalette, openHelp]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <CommandPalette open={palette} onOpenChange={setPalette} onShowShortcuts={openHelp} />
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
    </Ctx.Provider>
  );
}
