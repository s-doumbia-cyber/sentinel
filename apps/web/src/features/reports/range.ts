/** The report range lives in the URL as whole UTC days (`?from=2017-07-07&to=2017-07-08`), so a link reproduces a report. */
export interface DayRange {
  from: string | null;
  to: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const valid = (v: string | null): string | null => {
  if (!v || !DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
};

export function readRange(params: URLSearchParams): DayRange {
  return { from: valid(params.get("from")), to: valid(params.get("to")) };
}

/** Both days are inclusive: `to` runs to the end of that UTC day. */
export function toIsoRange(r: DayRange): { from?: string; to?: string } {
  return {
    ...(r.from ? { from: `${r.from}T00:00:00.000Z` } : {}),
    ...(r.to ? { to: `${r.to}T23:59:59.999Z` } : {}),
  };
}

export function rangeError(r: DayRange): string | null {
  return r.from && r.to && r.from > r.to ? "The start day is after the end day." : null;
}

export function writeRange(params: URLSearchParams, r: DayRange): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of ["from", "to"] as const) {
    const v = r[k];
    if (v) next.set(k, v);
    else next.delete(k);
  }
  return next;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** "Last n days" counted back from `now`, today included. */
export function lastDays(n: number, now = new Date()): DayRange {
  return { from: dayOf(new Date(now.getTime() - (n - 1) * 86_400_000)), to: dayOf(now) };
}

export const describeRange = (r: DayRange): string => (!r.from && !r.to ? "All stored data" : `${r.from ?? "the start"} to ${r.to ?? "now"} (UTC, whole days)`);
