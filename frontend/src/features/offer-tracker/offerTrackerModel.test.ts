import { describe, expect, it } from "vitest";

import type {
  OfferRecord,
  OfferTrackerFilters,
  OfferTrackerRules
} from "../../shared/contracts/offer";
import {
  DEFAULT_OFFER_TRACKER_RULES,
  filterOfferTrackerRows,
  normalizeOfferRecord,
  normalizeOfferTrackerFilters,
  offerTrackerExportColumns,
  offerTrackerExportRows,
  offerTrackerSelectionSummary,
  paginateOfferTrackerRows,
  updateOfferTrackerSelection
} from "./offerTrackerModel";

const defaultDateRange = { startDate: "2026-08-01", endDate: "2026-08-31" } as const;

const offers: readonly OfferRecord[] = [
  {
    id: "offer-high",
    merchantId: "m-high",
    merchantName: "High Brand",
    tier: "Tier 1",
    network: "Awin",
    affCommissionRate: 20,
    commissionRate: 1,
    aov: 120,
    aovType: "actual",
    salesAmount: 900,
    brand: "High Brand",
    topAsins: ["b012345678", "B012345678", "B0ABCDEFGH"],
    category: "Beauty"
  },
  {
    id: "offer-low",
    merchantId: "m-low",
    merchantName: "Low Brand",
    tier: "Tier 3",
    network: "CJ",
    affCommissionRate: 5,
    aov: 80,
    aovType: "estimated",
    salesAmount: 0,
    brand: "Low Brand",
    productAsins: "B0ZZZZZZZZ B0YYYYYYYY",
    category: "Home"
  },
  {
    id: "offer-none",
    merchantId: "m-none",
    merchantName: "Unknown Brand",
    tier: "Tier 4",
    network: "CJ",
    commissionRate: 99,
    aov: 0,
    aovType: "not available",
    salesAmount: null,
    brand: "Unknown Brand",
    category: "Beauty"
  },
  {
    id: "offer-mind",
    merchantId: "m-mind",
    merchantName: "Ulike",
    tier: "Tier 2",
    network: "Impact",
    affCommissionRate: 15,
    aov: 400,
    aovType: "actual",
    salesAmount: 200,
    brand: "Ulike",
    category: "Beauty"
  }
];

const baseFilters: OfferTrackerFilters = {
  tiers: [],
  categories: [],
  startDate: defaultDateRange.startDate,
  endDate: defaultDateRange.endDate,
  minAov: "",
  maxAov: "",
  minCommission: "",
  maxCommission: "",
  networks: [],
  bbPolicies: [],
  revenueStatus: "all",
  revenueSort: "priority"
};

describe("Offer Tracker model", () => {
  it("combines selected BB policies with OR and migrates legacy saved filters", () => {
    const rows = [...offers, { merchantId: "m-open", merchantName: "Merach" }];
    const filters = normalizeOfferTrackerFilters({ bbPolicies: ["mind", "open"] }, defaultDateRange);
    expect(filterOfferTrackerRows(rows, filters, "").map(row => row.merchantId).sort()).toEqual(["m-mind", "m-open"]);
    expect(filterOfferTrackerRows(rows, { ...filters, bbPolicies: ["open", "unknown"] }, "")).toHaveLength(4);
    expect(filterOfferTrackerRows(rows, { ...filters, bbPolicies: [] }, "")).toHaveLength(5);
    expect(normalizeOfferTrackerFilters({ bbPolicy: "mind" }).bbPolicies).toEqual(["mind"]);
    expect(normalizeOfferTrackerFilters({ bbPolicy: "all" }).bbPolicies).toEqual([]);
    expect(normalizeOfferTrackerFilters({ bbPolicy: "mind", bbPolicies: [] }).bbPolicies).toEqual([]);
  });

  it("normalizes commission, revenue, AOV, BB policy, ASINs and priority without mutating source", () => {
    const source = offers[0]!;
    const row = normalizeOfferRecord(source, DEFAULT_OFFER_TRACKER_RULES);

    expect(row.commissionRate).toBe(20);
    expect(row.revenue).toBe(900);
    expect(row.aovType).toBe("actual");
    expect(row.bbPolicy).toBe("unknown");
    expect(row.asins).toEqual(["B012345678", "B0ABCDEFGH"]);
    expect(row.score).toBe(11);
    expect(row.priority.key).toBe("high");
    expect(source).toEqual(offers[0]);
  });

  it("uses only AFF commission and classifies estimated/unavailable AOV", () => {
    const low = normalizeOfferRecord(offers[1]!);
    const none = normalizeOfferRecord(offers[2]!);

    expect(low.commissionRate).toBe(5);
    expect(low.aovType).toBe("estimated");
    expect(low.priority.key).toBe("low-aov");
    expect(none.commissionRate).toBe(0);
    expect(none.aovType).toBe("unavailable");
    expect(none.revenue).toBe(0);
    expect(none.priority.key).toBe("recommended");
  });

  it("normalizes invalid date ranges to the default and caps valid range at 366 days", () => {
    expect(normalizeOfferTrackerFilters({
      startDate: "2026-08-31",
      endDate: "2026-08-01"
    }, defaultDateRange)).toMatchObject(defaultDateRange);
    expect(normalizeOfferTrackerFilters({
      startDate: "2026-01-01",
      endDate: "2027-01-02"
    }, defaultDateRange)).toMatchObject(defaultDateRange);
    expect(normalizeOfferTrackerFilters({
      startDate: "2026-01-01",
      endDate: "2026-12-31"
    }, defaultDateRange)).toMatchObject({ startDate: "2026-01-01", endDate: "2026-12-31" });
  });

  it("filters by multi-selects, ranges, revenue status and search", () => {
    expect(filterOfferTrackerRows(offers, { ...baseFilters, tiers: ["Tier 3"] }, "").map((row) => row.merchantId))
      .toEqual(["m-low"]);
    expect(filterOfferTrackerRows(offers, { ...baseFilters, categories: ["Beauty"] }, "m-none")
      .map((row) => row.merchantId)).toEqual(["m-none"]);
    expect(filterOfferTrackerRows(offers, { ...baseFilters, minCommission: "15", minAov: "100" }, "")
      .map((row) => row.merchantId)).toEqual(["m-high", "m-mind"]);
    expect(filterOfferTrackerRows(offers, { ...baseFilters, revenueStatus: "positive" }, "")
      .map((row) => row.merchantId)).toEqual(["m-high", "m-mind"]);
    expect(filterOfferTrackerRows(offers, { ...baseFilters, revenueStatus: "none" }, "")
      .map((row) => row.merchantId)).toEqual(["m-none", "m-low"]);
  });

  it("sorts by revenue and keeps priority as the default stable fallback", () => {
    const descending = filterOfferTrackerRows(offers, { ...baseFilters, revenueSort: "revenue-desc" }, "");
    const ascending = filterOfferTrackerRows(offers, { ...baseFilters, revenueSort: "revenue-asc" }, "");
    const priority = filterOfferTrackerRows(offers, baseFilters, "");

    expect(descending[0]?.merchantId).toBe("m-high");
    expect(descending.at(-1)?.revenue).toBe(0);
    expect(ascending[0]?.revenue).toBe(0);
    expect(priority[0]?.priority.key).toBe("high");
    expect(priority.at(-1)?.priority.key).toBe("low-aov");
  });

  it("paginates and updates selection without dropping selections outside the page", () => {
    const rows = filterOfferTrackerRows(offers, baseFilters, "");
    const firstPage = paginateOfferTrackerRows(rows, 1, 2);
    const secondPage = paginateOfferTrackerRows(rows, 2, 2);
    const firstSelection = updateOfferTrackerSelection(firstPage.rows, true, new Set<string>());
    const allSelection = updateOfferTrackerSelection(secondPage.rows, true, firstSelection);
    const summary = offerTrackerSelectionSummary(rows, secondPage.rows, allSelection);

    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.rows).toHaveLength(2);
    expect(secondPage.page).toBe(2);
    expect(allSelection.size).toBe(4);
    expect(summary).toEqual({
      selectedCount: 4,
      currentPageSelectedCount: 2,
      allFilteredSelected: true,
      allPageSelected: true
    });
  });

  it("projects selected source rows and preserves the approved export columns", () => {
    const rows = filterOfferTrackerRows(offers, baseFilters, "");
    const selected = new Set([rows[0]?.key, rows[2]?.key].filter((key): key is string => Boolean(key)));

    expect(offerTrackerExportRows(rows, selected, true).map((row) => row.merchantId))
      .toEqual([rows[0]?.merchantId, rows[2]?.merchantId]);
    expect(offerTrackerExportColumns("offers").map((column) => column.label)).toEqual([
      "Priority", "Merchant ID", "Merchant Name", "Tier", "AFF Commission", "AOV", "Revenue",
      "AOV Type", "BB Preference", "Category", "Recommendation"
    ]);
    expect(offerTrackerExportColumns("products").map((column) => column.label)).toEqual([
      "Priority", "Merchant ID", "Merchant Name", "AOV", "Revenue", "AOV Type", "BB Preference",
      "Category", "Top Rank ASINs"
    ]);
  });

  it("accepts customized scoring rules without changing input rows", () => {
    const rules: OfferTrackerRules = { highScore: 7, lowAovMax: 90 };
    const row = normalizeOfferRecord(offers[3]!, rules);
    expect(row.priority.key).toBe("high");
    expect(row.source).toBe(offers[3]);
  });
});
