import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { OfferTrackerFilters as Filters } from "../../shared/contracts/offer";
import { normalizeOfferTrackerFilters } from "./offerTrackerModel";
import OfferTrackerFilters from "./OfferTrackerFilters.vue";

enableAutoUnmount(afterEach);
const defaults = normalizeOfferTrackerFilters({}, { startDate: "2026-09-01", endDate: "2026-09-30" });
const selection: Filters = {
  ...defaults, tiers: ["Tier 2", "Tier 3"], categories: ["Home", "Beauty"],
  minAov: "100", maxAov: "", minCommission: "10", maxCommission: "30",
  networks: ["Awin", "CJ"], bbPolicies: ["open", "unknown"],
  revenueStatus: "positive", revenueSort: "revenue-asc"
};
const create = (modelValue = selection, language: "zh" | "en" = "zh") => mount(OfferTrackerFilters, {
  props: { modelValue, appliedFilters: defaults, language, loading: false,
    tiers: ["Tier 2", "Tier 3"], categories: ["Home", "Beauty"], networks: ["Awin", "CJ"] }
});

describe("Offer Tracker filter summary", () => {
  it("summarizes every selected field, including multiple BB values and one-sided bounds", () => {
    const wrapper = create();
    const chips = wrapper.findAll(".offer-tracker-filter-chips > span").map(chip => chip.text());
    expect(chips).toEqual([
      "日期 2026-09-01 – 2026-09-30", "分层: Tier 2、Tier 3", "品类: Home、Beauty",
      "AOV 范围 ≥ 100", "AFF 佣金范围: 10% – 30%", "网络: Awin、CJ",
      "是否介意 BB: 不介意 BB、未知", "REVENUE 状态: 有 Revenue", "REVENUE 排序: Revenue 从低到高"
    ]);
    expect(wrapper.get('[role="status"]').text()).toContain("当前选择（待应用）");
  });

  it("keeps zero bounds and labels upper-only, lower-only and two-sided ranges", async () => {
    const wrapper = create({ ...defaults, minAov: "0", maxAov: "100", minCommission: "0" });
    expect(wrapper.get('[role="status"]').text()).toContain("AOV 范围: 0 – 100");
    expect(wrapper.get('[role="status"]').text()).toContain("AFF 佣金范围 ≥ 0%");
    await wrapper.setProps({ modelValue: { ...defaults, maxAov: "100", maxCommission: "20", revenueStatus: "none" } });
    const summary = wrapper.get('[role="status"]').text();
    expect(summary).toContain("AOV 范围 ≤ 100");
    expect(summary).toContain("AFF 佣金范围 ≤ 20%");
    expect(summary).toContain("REVENUE 状态: 无 Revenue");
  });

  it("recognizes equivalent multi-select sets and removes cleared conditions", async () => {
    const wrapper = create();
    await wrapper.setProps({ appliedFilters: { ...selection, tiers: ["Tier 3", "Tier 2"], bbPolicies: ["unknown", "open"] } });
    expect(wrapper.get('.offer-tracker-filter-summary-state').text()).toBe("已应用条件");
    await wrapper.setProps({ modelValue: defaults, appliedFilters: defaults });
    expect(wrapper.findAll('.offer-tracker-filter-chips > span')).toHaveLength(2);
    expect(wrapper.get('[role="status"]').text()).not.toContain("AOV 范围");
  });

  it("localizes the complete summary in English", () => {
    const summary = create(selection, "en").get('[role="status"]').text();
    expect(summary).toContain("Current selection (not applied)");
    expect(summary).toContain("Dates 2026-09-01 – 2026-09-30");
    expect(summary).toContain("AOV range ≥ 100");
    expect(summary).toContain("AFF commission range: 10% – 30%");
    expect(summary).toContain("Doesn't mind BB, Unknown");
    expect(summary).toContain("Revenue: low to high");
    expect(summary).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
