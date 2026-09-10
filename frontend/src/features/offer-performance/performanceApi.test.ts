import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCatalog, loadReport } from "./performanceApi";
import { windowDates } from "./performanceModel";

afterEach(() => vi.unstubAllGlobals());
describe("promotion API", () => {
  it("sends the exact cohort and applied dates through the session-protected endpoint", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            merchants: [],
            dateRange: windowDates("2026-09-07"),
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await loadReport({
      batchId: "batch one",
      merchantIds: "101,1101",
      merchantId: "101",
      launchDate: "2026-09-07",
      startDate: "2026-08-01",
      endDate: "2026-08-14",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url, "http://localhost");
    expect(parsed.pathname).toBe("/api/ui/db/offer-performance");
    expect(parsed.searchParams.get("merchantIds")).toBe("101,1101");
    expect(parsed.searchParams.get("merchantId")).toBe("101");
    expect(parsed.searchParams.get("startDate")).toBe("2026-08-01");
    expect(init.credentials).toBe("same-origin");
  });
  it("rejects invalid report payloads without replacing them with zero activity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    await expect(
      loadReport({
        batchId: "x",
        merchantIds: "101",
        launchDate: "2026-09-07",
      }),
    ).rejects.toThrow("Invalid performance response");
    await expect(loadCatalog()).resolves.toMatchObject({ ok: true });
  });
});
