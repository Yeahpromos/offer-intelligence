import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import TierSheetPage from "./TierSheetPage.vue";

const report = {
  offers: [
    { merchantId: "101", category: "Audio", commissionRate: 0.2 },
    { merchantId: "101", category: "Audio", commissionRate: 0.201 }
  ],
  sheets: [
    {
      name: "Tier 1",
      title: "Tier 1",
      headers: ["Merchant ID", "Merchant Name", "Network", "Revenue", "Clicks", "AOV", "Color"],
      rows: [
        { "Merchant ID": "101", "Merchant Name": "Alpha", Network: "Levanta", Revenue: "1000", Clicks: "100", AOV: "100", COUNTRY: "US", Color: "yellow" },
        { "Merchant ID": "102", "Merchant Name": "Beta", Network: "Archer", Revenue: "500", Clicks: "50", AOV: "50", COUNTRY: "US", Color: "green" }
      ],
      introRows: [["Tier 1"], ["Keep high-potential merchants moving."], ["Revenue target"]]
    },
    { name: "Tier 2", headers: [], rows: [] },
    { name: "Tier 3", headers: [], rows: [] },
    { name: "Tier 4", headers: [], rows: [] },
    { name: "BLACK TIER", headers: [], rows: [] }
  ]
};

describe("TierSheetPage", () => {
  it("switches the complete report chrome between Chinese and English while retaining raw sort keys", async () => {
    const wrapper = mount(TierSheetPage, { props: { language: "zh", reportData: report, autoLoad: false } });
    expect(wrapper.get(".tier-header").text()).toContain("添加商家");
    expect(wrapper.get(".tier-summary").text()).toContain("总点击量");
    expect(wrapper.get(".tier-category-header").text()).toContain("个品类");
    expect(wrapper.get('[data-tier-sort="Merchant Name"]').text()).toContain("商家名称");
    expect(wrapper.get('[data-tier-date="start"]').attributes("aria-label")).toBe("开始日期");
    await wrapper.setProps({ language: "en" });
    expect(wrapper.get(".tier-header").text()).toContain("Add merchant");
    expect(wrapper.get('[data-tier-sort="Merchant Name"]').text()).toContain("Merchant Name");
    wrapper.unmount();
  });

  it("validates manual date entry and only loads a valid applied range", async () => {
    const calls: unknown[] = [];
    const wrapper = mount(TierSheetPage, { props: { language: "zh", reportData: report, autoLoad: false, loadTier: async (request) => { calls.push(request); return { rows: [] }; } } });
    await wrapper.get('[data-tier-date="start"]').setValue("2026-09-30");
    await wrapper.get('[data-tier-date="end"]').setValue("2026-09-01");
    await wrapper.get('[data-tier-action="date-apply"]').trigger("click");
    expect(wrapper.get(".tier-date-status").text()).toContain("开始日期不能晚于结束日期");
    expect(calls).toHaveLength(0);
    await wrapper.get('[data-tier-date="start"]').setValue("2026-02-30");
    await wrapper.get('[data-tier-action="date-apply"]').trigger("click");
    expect(wrapper.get(".tier-date-status").text()).toContain("请输入有效日期");
    expect(calls).toHaveLength(0);
    await wrapper.get('[data-tier-date="start"]').setValue("2026-09-01");
    await wrapper.get('[data-tier-date="end"]').setValue("2026-09-30");
    await wrapper.get('[data-tier-action="date-apply"]').trigger("click");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ startDate: "2026-09-01", endDate: "2026-09-30" });
    wrapper.unmount();
  });

  it("renders the legacy Tier hierarchy and operational controls", () => {
    const wrapper = mount(TierSheetPage, { props: { language: "en", reportData: report, autoLoad: false } });
    expect(wrapper.find('[data-page="tier"]').exists()).toBe(true);
    expect(wrapper.find(".tier-summary").exists()).toBe(true);
    expect(wrapper.find(".tier-sheet-filters").exists()).toBe(true);
    expect(wrapper.find(".tier-table-panel").exists()).toBe(true);
    expect(wrapper.findAll(".tier-row-checkbox")).toHaveLength(3);
    expect(wrapper.text()).toContain("$1,000.00");
  });

  it("保持宽表格位于可横向滚动的容器内", () => {
    const wrapper = mount(TierSheetPage, { props: { language: "en", reportData: report, autoLoad: false } });
    expect(wrapper.get(".sheet-table-wrap").attributes("style") || "").not.toContain("min-width");
    expect(wrapper.get(".sheet-table-wrap .sheet-table").attributes("style") || "").toContain("min-width");
  });

  it("supports selection, column panel, expanded overlay, move dialog, and export", async () => {
    const downloads: unknown[] = [];
    const wrapper = mount(TierSheetPage, {
      props: { language: "zh", reportData: report, autoLoad: false, download: (payload) => downloads.push(payload) }
    });
    await wrapper.get('[data-tier-select-row="merchant:101:Tier 1"]').setValue(true);
    await wrapper.get('[data-tier-action="move"]').trigger("click");
    expect(wrapper.find(".tier-move-dialog").exists()).toBe(true);
    await wrapper.get('[data-tier-move-target="Tier 2"]').trigger("click");
    await wrapper.get('[data-tier-action="confirm-move"]').trigger("click");
    expect(wrapper.text()).toContain("Tier 2");

    await wrapper.get('[data-tier-action="columns"]').trigger("click");
    expect(wrapper.find(".column-picker-panel").exists()).toBe(true);
    await wrapper.get('[data-tier-action="expand"]').trigger("click");
    expect(wrapper.find(".sheet-expanded-panel").exists()).toBe(true);
    await wrapper.get('[data-tier-action="close-overlay"]').trigger("click");
    expect(wrapper.find(".sheet-expanded-panel").exists()).toBe(false);
    await wrapper.get(".table-download-button").trigger("click");
    expect(downloads).toHaveLength(1);
    const payload = downloads[0] as { sheets: Array<{ sheetName: string; headers: string[] }> };
    expect(payload.sheets.map((sheet) => sheet.sheetName)).toEqual(["Tier 1", "Category Summary", "Offer List"]);
    expect(payload.sheets[2]?.headers).toEqual(["Merchant ID", "Merchant Name", "Category", "Avg Commission Rate"]);
  });

  it("loads the selected tier through the injected API boundary", async () => {
    const calls: string[] = [];
    const wrapper = mount(TierSheetPage, {
      props: {
        language: "en",
        reportData: report,
        autoLoad: true,
        loadTier: async ({ tier }) => {
          calls.push(tier);
          return { rows: [] };
        }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["Tier 1"]);
    expect(wrapper.attributes("aria-busy")).toBe("false");
  });

  it("preloads the Tier 1 additions count without opening its dialog", async () => {
    let calls = 0;
    const wrapper = mount(TierSheetPage, {
      props: {
        language: "en",
        reportData: report,
        autoLoad: true,
        loadTier1Additions: async () => {
          calls += 1;
          return { additions: [{ merchantId: "303", merchantName: "Gamma", currentTier: "Tier 1" }] };
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
    expect(wrapper.get(".tier1-additions-count").text()).toBe("1");
    expect(wrapper.find(".tier1-additions-overlay").exists()).toBe(false);
  });

  it("exposes stable hooks for tier navigation and table interactions", () => {
    const wrapper = mount(TierSheetPage, { props: { language: "en", reportData: report, autoLoad: false } });

    expect(wrapper.find('[data-tier-tab="Tier 1"]').exists()).toBe(true);
    expect(wrapper.get('[data-tier-action="search"]').element.tagName).toBe("INPUT");
    expect(wrapper.get('[data-tier-date="start"]').element.tagName).toBe("INPUT");
    expect(wrapper.get('[data-tier-date="end"]').element.tagName).toBe("INPUT");
    expect(wrapper.find('[data-tier-action="date-apply"]').exists()).toBe(true);
    expect(wrapper.get('[data-tier-filter="network"]').element.tagName).toBe("SELECT");
    expect(wrapper.find('[data-tier-action="download"]').exists()).toBe(true);
  });

});
