/**
 * API client. The access token lives only in memory; the refresh token is an
 * httpOnly cookie the browser sends to /api/v1/auth. Nothing auth-related is
 * written to localStorage or sessionStorage (CLAUDE.md §9).
 */

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly details?: { path?: string; message: string }[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;
let activeOrgId: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function hasAccessToken(): boolean {
  return accessToken !== null;
}
export function setActiveOrg(orgId: string | null) {
  activeOrgId = orgId;
}
export function getActiveOrg(): string | null {
  return activeOrgId;
}
export function onSessionExpired(handler: () => void) {
  onSessionLost = handler;
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; requestId?: string; details?: { path?: string; message: string }[] } } | null;
  const e = body?.error;
  return new ApiError(
    res.status,
    e?.code ?? "HTTP_ERROR",
    e?.message ?? `Request failed (${res.status})`,
    e?.requestId ?? res.headers.get("x-request-id") ?? undefined,
    e?.details,
  );
}

/** Exchanges the refresh cookie for a new access token. Concurrent callers share one request. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Sentinel-CSRF": "1" },
      });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  /** Cookie endpoints (logout) need the CSRF header. */
  csrf?: boolean;
}

export function buildQuery(query: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const s = params.toString();
  return s ? `?${s}` : "";
}

function headers(opts: RequestOptions, json: boolean): Record<string, string> {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(activeOrgId ? { "X-Org-Id": activeOrgId } : {}),
    ...(opts.csrf ? { "X-Sentinel-CSRF": "1" } : {}),
  };
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const isForm = opts.body instanceof FormData;
  const send = () =>
    fetch(`${BASE}${path}${buildQuery(opts.query)}`, {
      method: opts.method ?? "GET",
      credentials: "same-origin",
      headers: headers(opts, opts.body !== undefined && !isForm),
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.signal,
    });

  let res = await send();
  // One transparent retry after refreshing an expired access token.
  if (res.status === 401 && !path.startsWith("/auth/")) {
    if (await refreshSession()) res = await send();
    else onSessionLost?.();
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Multipart upload with progress (fetch cannot report upload progress). */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress: (pct: number) => void): Promise<T> {
  const attempt = () =>
    new Promise<{ status: number; body: string; requestId: string | null }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}${path}`);
      for (const [k, v] of Object.entries(headers({}, false))) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText, requestId: xhr.getResponseHeader("x-request-id") });
      xhr.onerror = () => reject(new ApiError(0, "NETWORK_ERROR", "Network error during upload"));
      xhr.send(form);
    });
  return (async () => {
    let r = await attempt();
    if (r.status === 401 && (await refreshSession())) r = await attempt();
    const parsed = (() => {
      try {
        return JSON.parse(r.body) as unknown;
      } catch {
        return null;
      }
    })();
    if (r.status >= 400) {
      const e = (parsed as { error?: { code?: string; message?: string; requestId?: string; details?: { message: string }[] } } | null)?.error;
      throw new ApiError(r.status, e?.code ?? "HTTP_ERROR", e?.message ?? `Upload failed (${r.status})`, e?.requestId ?? r.requestId ?? undefined, e?.details);
    }
    return parsed as T;
  })();
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
