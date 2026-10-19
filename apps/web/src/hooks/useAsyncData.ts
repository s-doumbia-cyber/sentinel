import { useEffect, useRef, useState } from "react";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

// Simple in-memory cache shared across every useAsyncData call in the app.
// Keyed by a string the caller provides (e.g. "dashboard", "attack-breakdown").
// This is what makes switching between pages feel instant on a revisit within
// the TTL window, instead of re-querying MongoDB every single time — a real
// query-caching library (TanStack Query) would be the next step if this app
// grew further, but a small Map covers this app's needs without adding a
// dependency.
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes — long enough that navigating between pages during a normal session never re-fetches, but still refreshes eventually if you leave the tab open a long time
const cache = new Map<string, { data: unknown; timestamp: number }>();

/** Fetches `fetcher()` on mount (and whenever `deps` change), exposing loading/error state.
 * Pass `cacheKey` to serve a recent result instantly on revisit instead of re-fetching. */
export function useAsyncData<T>(fetcher: () => Promise<T>, deps: unknown[] = [], cacheKey?: string): AsyncState<T> {
  const cached = cacheKey ? (cache.get(cacheKey) as { data: T; timestamp: number } | undefined) : undefined;
  const isFreshCache = cached && Date.now() - cached.timestamp < CACHE_TTL_MS;

  const [state, setState] = useState<AsyncState<T>>(
    isFreshCache ? { data: cached!.data, loading: false, error: null } : { data: null, loading: true, error: null }
  );
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const key = cacheKey;
    const existing = key ? (cache.get(key) as { data: T; timestamp: number } | undefined) : undefined;
    if (existing && Date.now() - existing.timestamp < CACHE_TTL_MS) {
      setState({ data: existing.data, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcherRef
      .current()
      .then((data) => {
        if (cancelled) return;
        if (key) cache.set(key, { data, timestamp: Date.now() });
        setState({ data, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          error: err?.response?.data?.message || err?.message || "Failed to load data",
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, ...deps]);

  return state;
}
