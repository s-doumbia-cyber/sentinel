import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/format";

interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
}

const ToastContext = createContext<((kind: Toast["kind"], message: string) => void) | null>(null);
let nextId = 1;

/** Bottom-right, 4 s, at most 3 stacked, announced politely (§4). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Toast["kind"], message: string) => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-2), { id, kind, message }]);
      window.setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-32px))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn("pointer-events-auto flex items-start gap-2 rounded-md border bg-surface-2 px-3 py-2.5 text-small text-fg-1 shadow-e2")}
          >
            {t.kind === "success" ? (
              <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-sevfg-ok" />
            ) : (
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-sevfg-high" />
            )}
            <span className="flex-1">{t.message}</span>
            <button type="button" aria-label="Dismiss" className="text-fg-3 hover:text-fg-1" onClick={() => dismiss(t.id)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast must be used inside ToastProvider");
  return { success: (m: string) => push("success", m), error: (m: string) => push("error", m) };
}
