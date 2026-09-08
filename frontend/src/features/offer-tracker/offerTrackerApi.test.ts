import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOfferTrackerRange } from "./offerTrackerApi";

const range = { startDate: "2026-06-01", endDate: "2026-09-30" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Offer Tracker range requests", () => {
  it("accepts a live range response that takes longer than ten seconds", async () => {
    vi.useFakeTimers();
    const rows = [{ merchantId: "42", salesAmount: 1200 }];
    const fetchMock = vi.fn((_path: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify({ offers: rows }))), 18_000);
      init.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = loadOfferTrackerRange(range);
    const assertion = expect(result).resolves.toEqual(rows);
    await vi.advanceTimersByTimeAsync(18_000);
    await assertion;
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/ui/db/offers?start_date=2026-06-01&end_date=2026-09-30");
  });

  it("keeps a bounded timeout for a stalled range request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const assertion = expect(loadOfferTrackerRange(range)).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it("rejects server failures and malformed data instead of treating them as empty results", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: "Database query failed" }), { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadOfferTrackerRange(range)).rejects.toMatchObject({ status: 502 });
    await expect(loadOfferTrackerRange(range)).rejects.toThrow("响应缺少 offers");
  });
});
