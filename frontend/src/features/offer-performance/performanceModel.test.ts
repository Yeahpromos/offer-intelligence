import { describe, expect, it } from "vitest";
import {
  addDays,
  change,
  emptyMetrics,
  monthlyBaseline,
  observedDays,
  observationWindow,
  parseBatch,
  sumMetrics,
  windowDates,
  upsertTrackedMerchant,
  restoreBatches,
} from "./performanceModel";

describe("promotion window and metrics", () => {
  it("keeps old and invalid saved periods usable while restoring valid custom dates", () => {
    const batch = parseBatch(
      [
        [
          ["Merchant ID", "Merchant Name"],
          ["101", "Merchant"],
        ],
      ],
      "list.csv",
      "2026-09-07",
    );
    expect(observationWindow(batch)?.startDate).toBe("2026-09-07");
    expect(
      observationWindow({ ...batch, observationStart: "2026-08-01" })?.endDate,
    ).toBe("2026-09-13");
    expect(
      observationWindow({
        ...batch,
        observationStart: "bad",
        observationEnd: "2026-08-14",
      })?.startDate,
    ).toBe("2026-09-07");
    const saved = {
      ...batch,
      observationStart: "2026-08-01",
      observationEnd: "2026-08-14",
    };
    const restored = restoreBatches([batch], [saved]);
    expect(observationWindow(restored[0]!)?.beforeStart).toBe("2026-07-18");
  });
  it("includes launch day in the following seven days", () => {
    expect(windowDates("2026-09-07")).toEqual({
      startDate: "2026-09-07",
      endDate: "2026-09-13",
      beforeStart: "2026-08-31",
      beforeEnd: "2026-09-06",
      days: 7,
    });
    expect(
      windowDates("2026-09-07", "2026-01-01", "2026-01-14")?.beforeStart,
    ).toBe("2025-12-18");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });
  it("rejects impossible, reversed, partial and oversized date ranges", () => {
    expect(windowDates("2026-02-30")).toBeNull();
    expect(windowDates("2026-09-07", "2026-09-07", "2026-09-01")).toBeNull();
    expect(windowDates("2026-09-07", "2026-09-07")).toBeNull();
    expect(windowDates("2026-09-07", "2026-01-01", "2026-09-01")).toBeNull();
  });
  it("never presents unfinished or zero-baseline windows as percent lift", () => {
    expect(observedDays("2026-09-07", "2026-09-13", "2026-09-08")).toBe(2);
    expect(observedDays("2026-09-07", "2026-09-13", "2026-09-06")).toBe(0);
    expect(observedDays("2026-09-07", "2026-09-13", "2026-10-01")).toBe(7);
    expect(change(100, 200, false)).toBeNull();
    expect(change(0, 200)).toBeNull();
    expect(change(null, 200)).toBeNull();
    expect(change(100, 200)).toBe(1);
  });
  it("keeps absent metrics distinct from measured zero", () => {
    expect(sumMetrics([]).revenue).toBeNull();
    expect(
      sumMetrics([
        { ...emptyMetrics(), revenue: 0 },
        { ...emptyMetrics(), revenue: 20 },
      ]).revenue,
    ).toBe(20);
    expect(
      sumMetrics([{ ...emptyMetrics(), revenue: 20 }, emptyMetrics()]).revenue,
    ).toBeNull();
  });
  it("excludes months that have not reached month end", () => {
    const row = {
      merchantId: "1",
      before: emptyMetrics(),
      after: emptyMetrics(),
      daily: [],
      monthly: [
        { ...emptyMetrics(), month: "2026-07", revenue: 100 },
        { ...emptyMetrics(), month: "2026-08", revenue: 300 },
      ],
    };
    expect(monthlyBaseline(row, "2026-08-15")).toMatchObject({
      average: 100,
      peak: 100,
    });
    expect(monthlyBaseline(row, "2026-08-31")).toMatchObject({
      average: 200,
      peak: 300,
    });
    expect(monthlyBaseline(row, "").average).toBeNull();
  });
});

describe("workbook batches", () => {
  it("requires only ID and name and discovers no invented ASINs", () => {
    const batch = parseBatch(
      [
        [
          ["商家ID", "商家名"],
          ["101", "First merchant"],
        ],
      ],
      "id-name.csv",
      "2026-09-07",
    );
    expect(batch.offers).toEqual([
      {
        merchantId: "101",
        merchantName: "First merchant",
        category: "",
        notes: undefined,
        asins: [],
      },
    ]);
    expect(() =>
      parseBatch([[["Merchant ID"], ["101"]]], "ids.csv", "2026-09-07"),
    ).toThrow("IMPORT_NAMES");
  });
  it("adds by exact ID and updates names without losing existing product metadata", () => {
    const original = [
      {
        merchantId: "101",
        merchantName: "Old",
        category: "Home",
        asins: ["B012345678"],
      },
    ];
    const renamed = upsertTrackedMerchant(original, " 101 ", " Renamed ");
    expect(renamed.added).toBe(false);
    expect(renamed.offers).toEqual([
      { ...original[0], merchantName: "Renamed" },
    ]);
    expect(
      upsertTrackedMerchant(renamed.offers, "1101", "Second").offers,
    ).toHaveLength(2);
    expect(() => upsertTrackedMerchant(original, "101 OR 1=1", "Bad")).toThrow(
      "MERCHANT_ID",
    );
    expect(() => upsertTrackedMerchant(original, "102", " ")).toThrow(
      "MERCHANT_NAME",
    );
  });
  it("restores manual additions to catalog lists and separate local lists after reload", () => {
    const catalog = parseBatch(
      [
        [
          ["Merchant ID", "Merchant Name"],
          ["101", "First"],
        ],
      ],
      "catalog.xlsx",
      "2026-09-07",
    );
    catalog.id = "seed";
    catalog.local = false;
    const changed = {
      ...catalog,
      customized: true,
      offers: upsertTrackedMerchant(catalog.offers, "202", "Added").offers,
    };
    const local = { ...changed, id: "manual", local: true };
    expect(restoreBatches([catalog], [changed, local])[0]?.offers).toHaveLength(
      2,
    );
    expect(restoreBatches([catalog], [changed, local])).toHaveLength(2);
    expect(
      restoreBatches(
        [catalog],
        [{ ...local, offers: [{ merchantId: "202" }] }],
      ),
    ).toEqual([catalog]);
  });
  it("merges all sheets by exact Merchant ID and deduplicates ASIN references", () => {
    const batch = parseBatch(
      [
        [
          ["Title"],
          ["Merchant ID", "Merchant Name", "Category", "推荐信息"],
          ["101", "Same Name", "Home", "推荐 B012345678"],
          ["1101", "Same Name", "Sports", ""],
        ],
        [
          ["Merchant ID", "Merchant Name", "Top ASINs"],
          ["101", "Same Name", "B012345678 B098765432"],
        ],
      ],
      "offers.xlsx",
      "2026-09-07",
    );
    expect(batch.offers).toHaveLength(2);
    expect(batch.offers[0]).toMatchObject({
      merchantId: "101",
      asins: ["B012345678", "B098765432"],
      category: "Home",
    });
    expect(batch.offers[1]?.asins).toEqual([]);
    expect(batch.local).toBe(true);
  });
  it("rejects missing identifiers and oversized cohorts", () => {
    expect(() =>
      parseBatch([[["Name"], ["Foo"]]], "x.csv", "2026-09-07"),
    ).toThrow("IMPORT_IDS");
    expect(() =>
      parseBatch(
        [[["Merchant ID"], ...Array.from({ length: 201 }, (_, i) => [i + 1])]],
        "x.csv",
        "2026-09-07",
      ),
    ).toThrow("IMPORT_IDS");
  });
});
