import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, buildQuery, refreshSession, setAccessToken, setActiveOrg } from "./api";

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("api client", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken(null);
    setActiveOrg(null);
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("sends the in-memory token and org header, and never stores tokens", async () => {
    setAccessToken("access-1");
    setActiveOrg("org-1");
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    await api("/me");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-1");
    expect((init.headers as Record<string, string>)["X-Org-Id"]).toBe("org-1");
    expect(init.credentials).toBe("same-origin");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    setAccessToken("expired");
    fetchMock
      .mockResolvedValueOnce(json(401, { error: { code: "UNAUTHENTICATED", message: "expired" } }))
      .mockResolvedValueOnce(json(200, { accessToken: "fresh" }))
      .mockResolvedValueOnce(json(200, { items: [] }));
    await expect(api("/flows")).resolves.toEqual({ items: [] });
    const refreshInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/refresh");
    expect((refreshInit.headers as Record<string, string>)["X-Sentinel-CSRF"]).toBe("1");
    expect(((fetchMock.mock.calls[2]?.[1] as RequestInit).headers as Record<string, string>).Authorization).toBe("Bearer fresh");
  });

  it("shares one refresh between concurrent callers", async () => {
    let resolve: (r: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const a = refreshSession();
    const b = refreshSession();
    resolve(json(200, { accessToken: "x" }));
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("turns the error envelope into an ApiError with the request id", async () => {
    fetchMock.mockResolvedValueOnce(json(422, { error: { code: "UNPROCESSABLE", message: "Bad CSV", requestId: "req-123", details: [{ path: "header", message: "Missing feature column: Flow Duration" }] } }));
    const err = await api("/imports/csv", { method: "POST", body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: "UNPROCESSABLE", requestId: "req-123" });
    expect((err as ApiError).details?.[0]?.message).toContain("Flow Duration");
  });

  it("builds query strings without empty values", () => {
    expect(buildQuery({ a: "1", b: undefined, c: "", d: null, e: 0 })).toBe("?a=1&e=0");
  });
});
