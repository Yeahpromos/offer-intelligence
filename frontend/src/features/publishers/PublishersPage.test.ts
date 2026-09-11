import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import PublishersPage from "./PublishersPage.vue";
import type { PublisherExportPayload } from "./publisherModel";

const metric = (sales: number) => ({ clicks: 10, dpv: 5, atc: 1, orders: 2, sales, allCommission: sales * 0.1 });
const data = {
  generatedAt: "2026-08-28T00:00:00Z",
  publishers: [
    { userId: 1, userName: "Media One", adminName: "Dora Long", networks: ["Levanta"], linkTypes: { storefront: metric(100) }, merchantIds: [101], markets: { "amazon.com": metric(100) }, total: metric(100) },
    { userId: 2, userName: "Media Two", adminName: "Alex Chen", networks: ["Wayward"], linkTypes: { storefront: metric(80) }, merchantIds: [102], markets: { "amazon.com": metric(80) }, total: metric(80) }
  ],
  summary: {},
  markets: ["amazon.com"],
  networks: ["Levanta", "Wayward"],
  linkTypes: ["storefront"],
  merchantNameMap: { "101": "Alpha", "102": "Beta" },
  dailyRows: {}
};

describe("PublishersPage", () => {
  it("keeps the legacy page hierarchy and six KPI cards", async () => {
    const wrapper = mount(PublishersPage, {
      props: { language: "zh", loadData: async () => data, autoLoad: false }
    });
    await wrapper.vm.load();

    expect(wrapper.find(".publishers-page").exists()).toBe(true);
    expect(wrapper.find(".publishers-filters").exists()).toBe(true);
    expect(wrapper.findAll(".publishers-kpi-row .metric")).toHaveLength(6);
    expect(wrapper.find(".publisher-affinity-panel").exists()).toBe(true);
    expect(wrapper.find(".publishers-market-summary").exists()).toBe(true);
    expect(wrapper.find(".publishers-chart-panel").exists()).toBe(true);
    expect(wrapper.find(".publishers-table-panel").exists()).toBe(true);
    expect(wrapper.findAll(".publishers-table tbody tr")).toHaveLength(3);
  });

  it("filters by manager, opens a publisher profile, and loads its portfolio", async () => {
    const portfolioCalls: string[] = [];
    const wrapper = mount(PublishersPage, {
      props: {
        language: "zh",
        loadData: async () => data,
        loadPortfolio: async (userId) => {
          portfolioCalls.push(userId);
          return {
            merchants: [{ merchantId: 101, merchantName: "Alpha", category: "Beauty", network: "Levanta", tier: "Tier 1", markets: { "amazon.com": metric(100) }, total: metric(100) }]
          };
        }
      }
    });
    await flushPromises();

    await wrapper.get('input[aria-label="经理"]').setValue("Dora");
    expect(wrapper.findAll(".publisher-selector-option")).toHaveLength(1);
    await wrapper.find(".publisher-selector-option").trigger("click");
    await flushPromises();

    expect(portfolioCalls).toEqual(["1"]);
    expect(wrapper.find(".publisher-affinity-content").exists()).toBe(true);
    expect(wrapper.text()).toContain("Alpha");
    expect(wrapper.find(".publishers-market-summary").classes()).toContain("hidden");
    expect(wrapper.findAll(".publishers-kpi-row .metric-value").map((node) => node.text())).toEqual([
      "10", "5", "1", "2", "$100", "$10"
    ]);
  });

  it("emits filtered publisher rows for export and toggles language copy", async () => {
    const exports: PublisherExportPayload[] = [];
    const wrapper = mount(PublishersPage, {
      props: { language: "en", loadData: async () => data, autoLoad: false, download: (payload) => exports.push(payload) }
    });
    await wrapper.vm.load();
    await wrapper.get('button[aria-label="Export current publisher results"]').trigger("click");
    expect(exports[0]?.rows).toHaveLength(2);
    expect(wrapper.get("h2").text()).toBe("Publisher Affinity");
  });

  it("exposes loading and error states without losing the page shell", async () => {
    const wrapper = mount(PublishersPage, {
      props: { language: "zh", loadData: async () => { throw new Error("503"); } }
    });
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find(".publishers-page").exists()).toBe(true);
  });

  it("preserves each network color when filtering from a segment, legend or table", async () => {
    const payload = { ...data, networks: [...data.networks, "PbAmazon"], publishers: [...data.publishers,
      { ...data.publishers[0], userId: 3, userName: "Pb Media", networks: ["PbAmazon"], total: metric(50) }
    ] };
    const wrapper = mount(PublishersPage, { props: { language: "en", loadData: async () => payload } });
    await flushPromises();
    const segment = '[data-overview-key="PbAmazon"]';
    const color = wrapper.get(segment).attributes("fill");
    expect(color).toBe("#ff4457");
    await wrapper.get(segment).trigger("keydown", { key: " " });
    expect((wrapper.get('select[aria-label="Affiliate Network"]').element as HTMLSelectElement).value).toBe("PbAmazon");
    expect(wrapper.findAll(".publisher-donut-segment")).toHaveLength(1);
    expect(wrapper.get(segment).attributes("fill")).toBe(color);
    expect(wrapper.get('[data-overview-legend="PbAmazon"]').text()).toContain("100.0%");
    await wrapper.get(".overview-back").trigger("click");
    await wrapper.get('[data-overview-legend="PbAmazon"]').trigger("click");
    expect(wrapper.get(segment).attributes("fill")).toBe(color);
    await wrapper.get(".overview-back").trigger("click");
    await wrapper.get('[data-overview-row="PbAmazon"] button').trigger("click");
    expect(wrapper.get(segment).attributes("fill")).toBe(color);
    await wrapper.get('.metric[aria-label="View Sales distribution"]').trigger("click");
    expect(wrapper.get(segment).attributes("fill")).toBe(color);
  });

  it("selects the correct publisher with keyboard navigation and dismisses menus", async () => {
    const calls: string[] = [];
    const wrapper = mount(PublishersPage, { props: { language: "zh", loadData: async () => data,
      loadPortfolio: async (id) => { calls.push(id); return { merchants: [] }; }
    } });
    await flushPromises();
    const input = wrapper.get('input[aria-label="媒体"]');
    await input.trigger("focus");
    await input.trigger("keydown", { key: "ArrowUp" });
    expect(input.attributes("aria-activedescendant")).toBe("publisher-publisher-option-1");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(calls).toEqual(["2"]);
    expect(input.attributes("aria-expanded")).toBe("false");
    await input.trigger("focus");
    await input.trigger("keydown", { key: "Escape" });
    expect(input.attributes("aria-expanded")).toBe("false");
    expect(wrapper.get("h2").text()).toBe("媒体合作偏好");
  });

  it("rejects reversed dates and requests portfolio dates only after applying", async () => {
    const calls: unknown[][] = [];
    const wrapper = mount(PublishersPage, { props: { language: "zh", loadData: async () => data,
      loadPortfolio: async (...args) => { calls.push(args); return { merchants: [] }; }
    } });
    await flushPromises();
    await wrapper.get('input[aria-label="媒体"]').trigger("focus");
    await wrapper.get(".publisher-selector-option").trigger("click");
    await flushPromises();
    await wrapper.get('input[data-publisher-date="start"]').setValue("2026-09-20");
    await wrapper.get('input[data-publisher-date="end"]').setValue("2026-09-01");
    await wrapper.get(".btn-search").trigger("click");
    expect(wrapper.get("#publisher-date-status").classes()).toContain("error");
    expect(calls).toHaveLength(1);
    await wrapper.get('input[data-publisher-date="end"]').setValue("2026-09-30");
    expect(calls).toHaveLength(1);
    await wrapper.get(".btn-search").trigger("click");
    await flushPromises();
    expect(calls[1]?.slice(0, 3)).toEqual(["1", "2026-09-20", "2026-09-30"]);
  });

  it("reorders sections using native buttons without dragging", async () => {
    const wrapper = mount(PublishersPage, { props: { language: "en", loadData: async () => data } });
    await flushPromises();
    await wrapper.get(".layout-customize-btn").trigger("click");
    await wrapper.get('[data-layout-id="filters"] .publisher-section-move button:last-child').trigger("click");
    expect(wrapper.findAll("[data-layout-id]").slice(0, 2).map(node => node.attributes("data-layout-id"))).toEqual(["kpi", "filters"]);
    await wrapper.get(".layout-cancel-btn").trigger("click");
    expect(wrapper.findAll("[data-layout-id]")[0]?.attributes("data-layout-id")).toBe("filters");
  });
});
