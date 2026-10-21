import { useEffect, useRef } from "react";
import { isEditableTarget } from "./keys";

/**
 * Single-letter shortcuts for the component that is on screen. Ignored while typing in a form control
 * or with a modifier held, so they never fight the browser or screen readers. Keys are lower-case.
 */
export function useHotkeys(handlers: Record<string, () => void>, enabled = true): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isEditableTarget(e.target)) return;
      const handler = latest.current[e.key.toLowerCase()];
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
