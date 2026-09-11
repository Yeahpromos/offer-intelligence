import { enableAutoUnmount, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  OfferRecord,
  OfferTrackerDateRange,
  OfferTrackerExportPayload
} from "../../shared/contracts/offer";
import OfferTrackerPage from "./OfferTrackerPage.vue";

enableAutoUnmount(afterEach);

const defaultDateRange: OfferTrackerDateRange = {
  startDate: "2026-08-01",
  endDate: "2026-08-31"
};

const offers: readonly OfferRecord[] = Array.from({ length: 30 }, (_, index) => ({
  id: `offer-${String(index + 1).padStart(2, "0")}`,
  merchantId: `merchant-${String(index + 1).padStart(2, "0")}`,
  merchantName: `Merchant ${String(index + 1).padStart(2, "0")}`,
  tier: index === 27 ? "Tier 3" : "Tier 1",
  network: index % 2 === 0 ? "Awin" : "CJ",
  affCommissionRate: 10,
  aov: 100,
  aovType: "actual",
  salesAmount: (30 - index) * 10,
  brand: `Brand ${index + 1}`,
  category: index === 27 ? "Home" : "Beauty",
  topAsins: [`B0${String(index + 1).padStart(8, "0")}`]
}));

beforeEach(() => {
  window.localStorage.removeItem("offerListTrackerColumnsV1");
  window.localStorage.removeItem("offerListTrackerRulesV1");
});

function mountTracker(
  props: Partial<{
    offers: readonly OfferRecord[];
    language: "zh" | "en";
    defaultDateRange: OfferTrackerDateRange;
    download: (payload: OfferTrackerExportPayload) => void;
    loadRange: (range: OfferTrackerDateRange) => Promise<readonly OfferRecord[]>;
  }> = {}
) {
  return mount(OfferTrackerPage, {
    attachTo: document.body,
    global: { stubs: { teleport: true } },
    props: {
      offers,
      language: "zh",
      defaultDateRange,
      ...props
    }
  });
}

describe("OfferTrackerPage", () => {
  it("保留旧页面的头部、筛选卡和表格工具栏结构", () => {
    const wrapper = mountTracker();

    expect(wrapper.find(".offer-tracker-modern-header .offer-tracker-export-button").exists()).toBe(true);
    expect(wrapper.find(".offer-tracker-filter-card").exists()).toBe(true);
    expect(wrapper.find(".filter-dropdown-trigger").exists()).toBe(true);
    expect(wrapper.find(".offer-tracker-view-tabs").exists()).toBe(true);
    expect(wrapper.find(".offer-tracker-table-actions .offer-tracker-search").exists()).toBe(true);
    expect(wrapper.find(".offer-tracker-table-footer").exists()).toBe(true);
    expect(wrapper.findAll(".offer-tracker-table-scroll th")).toHaveLength(10);
  });

  it("renders the modern page root and the default 25-row page", () => {
    const wrapper = mountTracker();

    expect(wrapper.find('.oi-modern-page[data-page="offer-list-tracker"]').exists()).toBe(true);
    expect(wrapper.find('input[aria-label="搜索 Offer"]').exists()).toBe(true);
    expect(wrapper.findAll("tbody tr[data-row-key]")).toHaveLength(25);
    expect(wrapper.text()).toContain("Offer List Tracker");
    expect(wrapper.text()).toContain("第 1 / 2 页");
  });

  it("filters by search and multi-select without crashing on incomplete records", async () => {
    const wrapper = mountTracker({
      offers: [...offers, { id: "broken", merchantId: "broken", tier: null, aov: "not-number" }]
    });
    const search = wrapper.get('input[aria-label="搜索 Offer"]');

    await search.setValue("merchant-28");
    await search.trigger("input");
    expect(wrapper.findAll("tbody tr[data-row-key]")).toHaveLength(1);
    expect(wrapper.text()).toContain("Merchant 28");

    await search.setValue("");
    await search.trigger("input");
    await wrapper.get('button[aria-label="分层"]').trigger("click");
    await wrapper.get('input[type="checkbox"][value="Tier 3"]').setValue(true);
    await wrapper.get('button[aria-label="应用筛选"]').trigger("click");
    expect(wrapper.findAll("tbody tr[data-row-key]")).toHaveLength(1);
    expect(wrapper.text()).toContain("Merchant 28");
  });

  it("changes revenue sort order and keeps the table interaction accessible", async () => {
    const wrapper = mountTracker();
    await wrapper.get('button[aria-label="REVENUE 排序"]').trigger("click");
    await wrapper.findAll('[role="option"]').find(option => option.text() === "Revenue 从低到高")!.trigger("click");
    expect(wrapper.find("tbody tr[data-row-key]").attributes("data-row-key")).toBe("offer-30");

    const search = wrapper.get('input[aria-label="搜索 Offer"]');
    const searchElement = search.element as HTMLInputElement;
    searchElement.focus();
    expect(document.activeElement).toBe(searchElement);
    expect(wrapper.get('button[aria-label="导出当前筛选"]').attributes("tabindex")).not.toBe("-1");
  });

  it("selects and clears the current page, then selects all matching rows across pages", async () => {
    const wrapper = mountTracker();
    const pageSelect = wrapper.get('input[aria-label="选择当前页"]');

    await pageSelect.setValue(true);
    expect(wrapper.text()).toContain("已选择 25 个");
    await pageSelect.setValue(false);
    expect(wrapper.text()).toContain("已选择 0 个");

    await wrapper.get('button[aria-label="选择全部匹配"]').trigger("click");
    expect(wrapper.text()).toContain("已选择 30 个");
    expect(wrapper.get('button[aria-label="导出已选择"]').attributes("disabled")).toBeUndefined();
  });

  it("moves between pages while keeping selections and shows an empty state", async () => {
    const wrapper = mountTracker();
    await wrapper.get('button[aria-label="下一页"]').trigger("click");
    expect(wrapper.text()).toContain("第 2 / 2 页");
    expect(wrapper.findAll("tbody tr[data-row-key]")).toHaveLength(5);

    const search = wrapper.get('input[aria-label="搜索 Offer"]');
    await search.setValue("does-not-exist");
    await search.trigger("input");
    expect(wrapper.find("tbody tr[data-empty-state]").exists()).toBe(true);
    expect(wrapper.text()).toContain("没有符合当前筛选条件的 Offer");
  });

  it("emits selected/all export payloads through the injected legacy callback", async () => {
    const payloads: OfferTrackerExportPayload[] = [];
    const wrapper = mountTracker({ download: (payload) => payloads.push(payload) });

    await wrapper.get('button[aria-label="导出当前筛选"]').trigger("click");
    expect(payloads[0]).toMatchObject({ view: "offers", selectedOnly: false });
    expect(payloads[0]?.rows).toHaveLength(30);

    await wrapper.get('input[data-row-select="offer-01"]').setValue(true);
    await wrapper.get('button[aria-label="导出已选择"]').trigger("click");
    expect(payloads[1]).toMatchObject({ view: "offers", selectedOnly: true });
    expect(payloads[1]?.rows).toHaveLength(1);

    await wrapper.get('button[aria-label="产品视图"]').trigger("click");
    await nextTick();
    expect(wrapper.get('button[aria-label="产品视图"]').attributes("aria-selected")).toBe("true");
  });

  it("shows a controlled loading error while retaining the previous rows", async () => {
    const wrapper = mountTracker({
      loadRange: async () => {
        throw new Error("range unavailable");
      }
    });
    await wrapper.get('input[aria-label="开始日期"]').setValue("2026-06-01");
    await wrapper.get('button[aria-label="应用筛选"]').trigger("click");
    await nextTick();
    expect(wrapper.text()).toContain("筛选数据加载失败");
    expect(wrapper.findAll("tbody tr[data-row-key]")).toHaveLength(25);
  });

  it("localizes the controlled loading error", async () => {
    const wrapper = mountTracker({
      language: "en",
      loadRange: async () => {
        throw new Error("range unavailable");
      }
    });

    await wrapper.get('input[aria-label="Start date"]').setValue("2026-06-01");
    await wrapper.get('button[aria-label="Apply filters"]').trigger("click");
    await nextTick();

    expect(wrapper.text()).toContain("Failed to load filtered data. Please try again.");
  });

  it("follows the shared language state for the modern page copy", () => {
    const wrapper = mountTracker({ language: "en" });

    expect(wrapper.find('input[aria-label="Search offers"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Export current results");
    expect(wrapper.text()).toContain("Selected 0 offers");
  });

  it("localizes English view controls and accessibility labels", () => {
    const wrapper = mountTracker({ language: "en" });

    expect(wrapper.get('button[aria-label="Products view"]').text()).toBe("Products view");
    expect(wrapper.get('input[data-row-select]').attributes("aria-label")).toBe("Select Merchant 01");
    expect(wrapper.find('section[aria-label="Offer Tracker results"]').exists()).toBe(true);
    expect(wrapper.find('nav[aria-label="Offer Tracker pagination"]').exists()).toBe(true);
  });

  it("opens column settings and hides an optional column", async () => {
    const wrapper = mountTracker();

    expect(wrapper.findAll("#offerTrackerColumnsPanel")).toHaveLength(0);
    await wrapper.get('button[aria-label="列设置"]').trigger("click");

    expect(wrapper.findAll("#offerTrackerColumnsPanel")).toHaveLength(1);
    expect(wrapper.get('button[aria-controls="offerTrackerColumnsPanel"]').attributes("aria-expanded")).toBe("true");
    expect(wrapper.findAll(".offer-tracker-table th")).toHaveLength(10);

    await wrapper.get('input[data-offer-tracker-column="revenue"]').setValue(false);

    expect(wrapper.findAll(".offer-tracker-table th")).toHaveLength(9);
    expect(wrapper.find('th[data-column="revenue"]').exists()).toBe(false);
    expect(wrapper.find('td[data-column="revenue"]').exists()).toBe(false);
  });

  it("saves priority rules and recalculates row priority", async () => {
    const wrapper = mountTracker();

    await wrapper.get('button[aria-label="优先级规则"]').trigger("click");
    expect(wrapper.findAll("#offerTrackerRulesPanel")).toHaveLength(1);
    expect((wrapper.get("#offerTrackerHighScore").element as HTMLInputElement).value).toBe("8");
    expect((wrapper.get("#offerTrackerLowAovMax").element as HTMLInputElement).value).toBe("100");

    await wrapper.get("#offerTrackerHighScore").setValue(11);
    await wrapper.get("#offerTrackerLowAovMax").setValue(90);
    await wrapper.get('button[aria-label="保存规则"]').trigger("click");

    expect(wrapper.findAll("#offerTrackerRulesPanel")).toHaveLength(0);
    expect(wrapper.get('[data-row-key="offer-01"] .offer-tracker-priority-badge').classes()).toContain("recommended");
  });
});
