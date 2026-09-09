import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import PublishersPage from "./PublishersPage.vue";
import { publisherOverviewColor } from "./publisherPresentation";

// Explicit expectations catch accidental reassignment when a row changes rank.
const networks = [
  ["Levanta", "#3478ed"], ["Wayward", "#228552"], ["Archer", "#b87512"],
  ["PbAmazon", "#dc4148"], ["amazon", "#8359ce"]
] as const;
const markets = [
  ["amazon.com", "#3478ed"], ["amazon.co.uk", "#228552"], ["amazon.de", "#b87512"],
  ["amazon.fr", "#dc4148"], ["amazon.ca", "#8359ce"], ["amazon.it", "#b84983"],
  ["amazon.es", "#197e92"], ["amazon.com.au", "#bf6635"], ["amazon.co.jp", "#6366c1"]
] as const;

const metric = (index: number) => ({ clicks: 1000 - index * 50, dpv: 80, atc: 20,
  orders: index + 1, sales: (index + 1) * 100, allCommission: (index + 1) * 10 });
const data = {
  publishers: markets.map(([market], index) => ({
    userId: index + 1, userName: `Media ${index + 1}`, adminName: "Manager",
    networks: [networks[index % networks.length]![0]],
    merchantIds: [index + 100], markets: { [market]: metric(index) }, total: metric(index)
  })),
  networks: networks.map(([key]) => key), markets: markets.map(([key]) => key),
  linkTypes: [], merchantNameMap: {}, dailyRows: {}, summary: {}
};

describe.each([
  { dimension: "network", label: "Affiliate Network", cases: networks },
  { dimension: "market", label: "Market", cases: markets }
] as const)("Publisher $dimension color selection", ({ dimension, label, cases }) => {
  it.each(cases.map(([key, color]) => ({ key, color })))("keeps $key mapped to $color through every selection entry point", async ({ key, color }) => {
    const wrapper = mount(PublishersPage, { props: { language: "en", loadData: async () => data } });
    await flushPromises();
    if (dimension === "market") await wrapper.get(".overview-toggle-btn").trigger("click");
    const segment = `[data-overview-key="${key}"]`;
    const filter = () => (wrapper.get(`select[aria-label="${label}"]`).element as HTMLSelectElement).value;
    const assertSelected = () => {
      expect(filter()).toBe(key);
      expect(wrapper.findAll(".publisher-donut-segment")).toHaveLength(1);
      expect(wrapper.get(segment).attributes("fill")).toBe(color);
      expect(wrapper.get(segment).attributes("aria-pressed")).toBe("true");
      expect(wrapper.get(`[data-overview-legend="${key}"]`).text()).toContain("100.0%");
      expect(wrapper.findAll("[data-overview-row]").map(row => row.attributes("data-overview-row"))).toEqual([key]);
    };
    const assertRestored = () => {
      expect(filter()).toBe("all");
      expect(wrapper.findAll(".publisher-donut-segment")).toHaveLength(cases.length);
      expect(wrapper.get(segment).attributes("fill")).toBe(color);
    };
    for (const entry of ["pointer", "Enter", " ", "legend", "table"]) {
      expect(wrapper.get(segment).attributes("fill")).toBe(color);
      if (entry === "legend") await wrapper.get(`[data-overview-legend="${key}"]`).trigger("click");
      else if (entry === "table") await wrapper.get(`[data-overview-row="${key}"] button`).trigger("click");
      else if (entry === "pointer") await wrapper.get(segment).trigger("click");
      else await wrapper.get(segment).trigger("keydown", { key: entry });
      assertSelected();
      // Second activation of the selected color restores the full distribution.
      await wrapper.get(segment).trigger("click");
      assertRestored();
    }
    await wrapper.get('.metric[aria-label="View Sales distribution"]').trigger("click");
    expect(wrapper.get(segment).attributes("fill")).toBe(color);
    await wrapper.get(segment).trigger("click");
    assertSelected();
    await wrapper.get(".overview-back").trigger("click");
    assertRestored();
    wrapper.unmount();
  });
});

describe("Publisher color identity", () => {
  it("keeps all network colors when sales reverses the click ranking", async () => {
    const wrapper = mount(PublishersPage, { props: { language: "en", loadData: async () => data } });
    await flushPromises();
    const order = () => wrapper.findAll(".publisher-donut-segment").map(node => node.attributes("data-overview-key"));
    const before = order();
    await wrapper.get('.metric[aria-label="View Sales distribution"]').trigger("click");
    expect(order()).not.toEqual(before);
    for (const [key, color] of networks) expect(wrapper.get(`[data-overview-key="${key}"]`).attributes("fill")).toBe(color);
    wrapper.unmount();
  });

  it("assigns stable fallback colors independently of previous lookups", () => {
    for (const dimension of ["network", "market"] as const) {
      const color = publisherOverviewColor(dimension, "New partner");
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      for (const [key] of [...networks, ...markets]) publisherOverviewColor(dimension, key);
      expect(publisherOverviewColor(dimension, " NEW PARTNER ")).toBe(color);
    }
  });
});
