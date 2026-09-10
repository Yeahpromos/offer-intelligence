import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import PromotionRelations from "./PromotionRelations.vue";
import {
  emptyMetrics,
  windowDates,
  type MediaRow,
  type PerformanceReport,
} from "./performanceModel";

const offers = [
  {
    merchantId: "101",
    merchantName: "First Home",
    category: "Home",
    asins: [],
  },
  {
    merchantId: "202",
    merchantName: "Second Home",
    category: "Home",
    asins: [],
  },
];
const edge = (merchantId: string, revenue: number): MediaRow => ({
  merchantId,
  publisherId: "7",
  publisherName: "Media Seven",
  before: { ...emptyMetrics(), revenue: 10 },
  after: { ...emptyMetrics(), revenue, clicks: 25 },
  linkType: "unknown",
  asin: "",
  purchasedAsin: "",
});
const report: PerformanceReport = {
  ok: true,
  availableThrough: "2026-09-08",
  generatedAt: "2026-09-10",
  clickSource: "fixture",
  supported: {
    revenue: true,
    clicks: true,
    orders: false,
    atc: false,
    dpv: false,
    commission: false,
  },
  dateRange: windowDates("2026-09-07")!,
  merchants: [],
  media: [edge("101", 100), edge("202", 200)],
  links: [
    { ...edge("101", 100), asin: "B012345678", linkType: "asin" },
    { ...edge("202", 200), purchasedAsin: "B098765432" },
    { ...edge("101", 40), linkType: "storefront" },
  ],
};
const page = (extra = {}) =>
  mount(PromotionRelations, {
    props: {
      language: "zh",
      offers,
      report,
      loading: false,
      error: false,
      ready: true,
      ...extra,
    },
  });

describe("visible merchant and product relationships", () => {
  it("shows a separate merchant-to-publisher path for every exact merchant ID immediately", async () => {
    const w = page();
    expect(w.findAll(".promotion-relation-path")).toHaveLength(2);
    expect(w.get(".promotion-relation-summary").text()).toContain("2 个商家");
    expect(w.get(".promotion-relation-summary").text()).toContain(
      "1 家已识别媒体",
    );
    const first = w.findAll(".promotion-relation-path")[0]!;
    expect(first.text()).toContain("Second Home");
    expect(first.text()).toContain("Media Seven");
    await first.get("button").trigger("click");
    expect(w.emitted("merchant")).toEqual([["202"]]);
  });
  it("shows merchant-product-publisher paths without imported ASINs and distinguishes purchase evidence", async () => {
    const w = page();
    await w.findAll(".promotion-relation-modes button")[1]!.trigger("click");
    expect(w.findAll(".has-product")).toHaveLength(3);
    for (const text of [
      "B012345678",
      "推广 ASIN",
      "B098765432",
      "成交 ASIN · 推广链接未知",
      "Storefront",
      "Media Seven",
    ])
      expect(w.text()).toContain(text);
    await w.get('input[type="search"]').setValue("B098765432");
    expect(w.findAll(".promotion-relation-path")).toHaveLength(1);
    expect(w.get(".promotion-relation-path").text()).toContain("Second Home");
  });
  it("queries a specific merchant when selected and keeps failed loads distinct from empty activity", async () => {
    const w = page({ error: true, report: null });
    expect(w.get('[role="alert"]').text()).toContain("关系数据暂不可用");
    await w.get("select").setValue("202");
    expect(w.emitted("retry")).toEqual([["202"]]);
    await w.setProps({ error: false, report: { ...report, media: [] } });
    expect(w.text()).toContain("当前筛选下没有观察到对应关系");
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });
  it("excludes before-only activity when observation is selected", async () => {
    const w = page({
      report: {
        ...report,
        media: [
          { ...edge("101", 100), after: emptyMetrics() },
          edge("202", 200),
        ],
      },
    });
    await w.findAll("select")[1]!.setValue("after");
    expect(w.findAll(".promotion-relation-path")).toHaveLength(1);
    expect(w.get(".promotion-relation-path").text()).toContain("Second Home");
    await w.setProps({ language: "en" });
    expect(w.text()).toContain("Product–publisher");
  });
});
