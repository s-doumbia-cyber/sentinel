import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiDownload, saveBlob, setAccessToken, setActiveOrg } from "./api";

describe("apiDownload", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    setAccessToken("access-1");
    setActiveOrg("org-1");
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    setAccessToken(null);
    setActiveOrg(null);
  });

  it("posts with the in-memory token and org, and returns the file with the server's name", async () => {
    fetchMock.mockResolvedValueOnce(new Response("%PDF-1.3", { status: 200, headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="sentinel-executive-report-2017-07-07_2017-07-08.pdf"' } }));
    const { blob, filename } = await apiDownload("/reports/executive/pdf", { query: { from: "2017-07-07T00:00:00.000Z" } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/reports/executive/pdf?from=2017-07-07T00%3A00%3A00.000Z");
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-1");
    expect((init.headers as Record<string, string>)["X-Org-Id"]).toBe("org-1");
    expect(filename).toBe("sentinel-executive-report-2017-07-07_2017-07-08.pdf");
    expect(blob.size).toBe("%PDF-1.3".length);
  });

  it("turns an error envelope into an ApiError and falls back to a default name", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Incident not found", requestId: "r-1" } }), { status: 404, headers: { "content-type": "application/json" } }));
    await expect(apiDownload("/incidents/x/report/pdf")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", requestId: "r-1" });
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 200 }));
    expect((await apiDownload("/x")).filename).toBe("sentinel-report.pdf");
    expect(ApiError).toBeDefined();
  });
});

describe("saveBlob", () => {
  it("clicks a temporary download link and releases the object URL", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:test");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("r.pdf");
      expect(this.href).toBe("blob:test");
    });
    saveBlob(new Blob(["x"]), "r.pdf");
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector("a[download]")).toBeNull();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:test");
    click.mockRestore();
    vi.useRealTimers();
  });
});
