import { describe, expect, it, vi } from "vitest";
import type { OfferRecord } from "../../shared/contracts/offer";
import { useOfferTracker } from "./useOfferTracker";

const defaultDateRange = { startDate: "2026-09-01", endDate: "2026-09-30" };
const offers = [{ merchantId: "1", category: "Beauty", salesAmount: 100 }];
const range = { startDate: "2026-06-01", endDate: "2026-09-30" };

describe("Offer Tracker loaded date ranges", () => {
  it("applies ordinary filters without requesting already loaded dates", async () => {
    const loadRange = vi.fn().mockRejectedValue(new Error("offline"));
    const tracker = useOfferTracker({ offers, defaultDateRange, loadRange });
    tracker.setDraftFilters({ ...tracker.filters.value, categories: ["Other"] });
    expect(await tracker.applyFilters()).toBe(true);
    expect(loadRange).not.toHaveBeenCalled();
    expect(tracker.filteredRows.value).toHaveLength(0);
    expect(tracker.error.value).toBe("");
  });

  it("requests changed dates once and reuses them for subsequent filters", async () => {
    const rangedOffers = [{ ...offers[0], salesAmount: 900 }];
    const loadRange = vi.fn().mockResolvedValue(rangedOffers);
    const tracker = useOfferTracker({ offers, defaultDateRange, loadRange });
    tracker.setDraftFilters({ ...tracker.filters.value, ...range });
    expect(await tracker.applyFilters()).toBe(true);
    tracker.setDraftFilters({ ...tracker.filters.value, categories: ["Beauty"] });
    expect(await tracker.applyFilters()).toBe(true);
    expect(loadRange).toHaveBeenCalledTimes(1);
    expect(loadRange).toHaveBeenCalledWith(expect.objectContaining(range));
    expect(tracker.sourceRows.value).toEqual(rangedOffers);
    expect(await tracker.resetFilters()).toBe(true);
    expect(tracker.sourceRows.value).toEqual(offers);
    expect(tracker.filters.value).toMatchObject(defaultDateRange);
    expect(loadRange).toHaveBeenCalledTimes(1);
  });

  it("retains the prior rows and applied dates after failure and allows retry", async () => {
    const rangedOffers = [{ ...offers[0], salesAmount: 900 }];
    const loadRange = vi.fn().mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce(rangedOffers);
    const tracker = useOfferTracker({ offers, defaultDateRange, loadRange });
    tracker.setDraftFilters({ ...tracker.filters.value, ...range });
    expect(await tracker.applyFilters()).toBe(false);
    expect(tracker.sourceRows.value).toEqual(offers);
    expect(tracker.filters.value).toMatchObject(defaultDateRange);
    expect(await tracker.applyFilters()).toBe(true);
    expect(tracker.sourceRows.value).toEqual(rangedOffers);
    expect(tracker.error.value).toBe("");
  });

  it("ignores an older date response after the user resets", async () => {
    let finish!: (rows: readonly OfferRecord[]) => void;
    const loadRange = vi.fn(() => new Promise<readonly OfferRecord[]>((resolve) => { finish = resolve; }));
    const tracker = useOfferTracker({ offers, defaultDateRange, loadRange });
    tracker.setDraftFilters({ ...tracker.filters.value, ...range });
    const pending = tracker.applyFilters();
    expect(await tracker.resetFilters()).toBe(true);
    finish([{ merchantId: "old-request" }]);
    expect(await pending).toBe(false);
    expect(tracker.sourceRows.value).toEqual(offers);
    expect(tracker.filters.value).toMatchObject(defaultDateRange);
    expect(tracker.loading.value).toBe(false);
  });
});
