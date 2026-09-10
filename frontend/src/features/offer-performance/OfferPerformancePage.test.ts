import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import DatePicker from "../../shared/components/DatePicker.vue";
import OfferPerformancePage from "./OfferPerformancePage.vue";
import {
  emptyMetrics,
  windowDates,
  type PerformanceReport,
  type PromotionBatch,
} from "./performanceModel";

const batch: PromotionBatch = {
  id: "test-batch",
  name: "Fixture campaign",
  sourceFile: "fixture.xlsx",
  launchDate: "2026-09-07",
  offers: [
    {
      merchantId: "101",
      merchantName: "Test Home",
      category: "Home",
      asins: ["B012345678"],
    },
    {
      merchantId: "1101",
      merchantName: "Test Sports",
      category: "Sports",
      asins: [],
    },
  ],
};
const metrics = (revenue: number) => ({
  revenue,
  clicks: 20,
  atc: 5,
  dpv: 10,
  orders: 2,
  commission: 3,
});
function fixture(): PerformanceReport {
  return {
    ok: true,
    availableThrough: "2026-09-08",
    generatedAt: "2026-09-10",
    clickSource: "cnpscy_amazon_click",
    dateRange: windowDates(batch.launchDate)!,
    supported: {
      revenue: true,
      clicks: true,
      atc: true,
      dpv: true,
      orders: true,
      commission: true,
    },
    merchants: batch.offers.map((o) => ({
      merchantId: o.merchantId,
      before: metrics(100),
      after: metrics(200),
      daily: [
        { date: "2026-09-07", ...metrics(100) },
        { date: "2026-09-08", ...metrics(100) },
      ],
      monthly: [{ month: "2026-08", ...metrics(500) }],
    })),
    media: [
      {
        merchantId: "101",
        publisherId: "7",
        publisherName: "Fixture Media",
        before: metrics(100),
        after: metrics(200),
        linkType: "unknown",
        asin: "",
        purchasedAsin: "",
      },
    ],
    links: ["asin", "storefront", "unknown"].map((linkType, i) => ({
      merchantId: "101",
      publisherId: "7",
      publisherName: "Fixture Media",
      before: emptyMetrics(),
      after: metrics(200),
      linkType: linkType as "asin" | "storefront" | "unknown",
      asin: i === 0 ? "B012345678" : "",
      purchasedAsin: i === 2 ? "B098765432" : "",
    })),
  };
}
const mounted: ReturnType<typeof mount>[] = [];
function page(extra: Record<string, unknown> = {}) {
  const wrapper = mount(OfferPerformancePage, {
    attachTo: document.body,
    props: {
      language: "zh",
      catalogLoader: async () => ({ batches: [structuredClone(batch)] }),
      reportLoader: async () => fixture(),
      ...extra,
    },
  });
  mounted.push(wrapper);
  return wrapper;
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  mounted.splice(0).forEach((w) => w.unmount());
  document.body.innerHTML = "";
});

describe("Offer promotion tracking", () => {
  it("adds and renames merchants by exact ID and restores the changed list after remount", async () => {
    const loader = vi.fn(async (_request: unknown) => fixture());
    const w = page({ reportLoader: loader });
    await flushPromises();
    await w.get("#promotion-add-merchant").trigger("click");
    expect(document.activeElement?.id).toBe("promotion-new-merchant-id");
    await w.get("#promotion-new-merchant-id").setValue("202");
    await w
      .get('.promotion-manual input[maxlength="160"]')
      .setValue("New tracked merchant");
    await w.get(".promotion-manual").trigger("submit");
    await flushPromises();
    expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({
      merchantIds: "101,1101,202",
      action: "relations",
    });
    expect(w.get(".promotion-merchant-table").text()).toContain(
      "New tracked merchant",
    );
    w.unmount();
    const restored = page();
    await flushPromises();
    expect(restored.findAll(".promotion-merchant-table tbody tr")).toHaveLength(
      3,
    );
    expect(restored.get(".promotion-merchant-table").text()).toContain(
      "New tracked merchant",
    );
    await restored.get("#promotion-add-merchant").trigger("click");
    await restored.get("#promotion-new-merchant-id").setValue("202");
    await restored
      .get('.promotion-manual input[maxlength="160"]')
      .setValue("Renamed merchant");
    await restored.get(".promotion-manual").trigger("submit");
    await flushPromises();
    expect(restored.findAll(".promotion-merchant-table tbody tr")).toHaveLength(
      3,
    );
    expect(restored.text()).toContain("该 ID 已在追踪中");
  });
  it("can track one merchant separately without uploading a workbook", async () => {
    const loader = vi.fn(async (_request: unknown) => fixture());
    const w = page({ reportLoader: loader });
    await flushPromises();
    await w.get("#promotion-add-merchant").trigger("click");
    await w.get("#promotion-new-merchant-id").setValue("202");
    await w
      .get('.promotion-manual input[maxlength="160"]')
      .setValue("Independent merchant");
    await w.get(".promotion-manual select").setValue("separate");
    await w.get(".promotion-manual").trigger("submit");
    await flushPromises();
    expect(w.findAll(".promotion-merchant-table tbody tr")).toHaveLength(1);
    expect(w.get(".promotion-merchant-table").text()).toContain(
      "Independent merchant",
    );
    expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({
      merchantIds: "202",
      launchDate: "2026-09-07",
    });
    expect(
      JSON.parse(localStorage.getItem("oi-promotion-batches-v1")!).at(-1),
    ).toMatchObject({ local: true, name: "Independent merchant" });
  });
  it("loads cohort relationships automatically and can narrow the API query to one merchant", async () => {
    const loader = vi.fn(async (_request: unknown) => fixture());
    const w = page({ reportLoader: loader });
    await flushPromises();
    expect(loader.mock.calls[1]?.[0]).toMatchObject({
      action: "relations",
      merchantIds: "101,1101",
    });
    expect(w.get(".promotion-relation-path").text()).toContain("Test Home");
    expect(w.get(".promotion-relation-path").text()).toContain("Fixture Media");
    await w.get(".promotion-relations select").setValue("101");
    await flushPromises();
    expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({
      action: "relations",
      merchantId: "101",
    });
  });
  it("uses the real default API loaders without calling them as Vue prop factories", async () => {
    const fetch = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("action=catalog") ? { batches: [batch] } : fixture(),
          ),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const w = page({ catalogLoader: undefined, reportLoader: undefined });
    await flushPromises();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "/api/ui/db/offer-performance?action=catalog",
    );
    expect(fetch.mock.calls[1]?.[0]).toContain("merchantIds=101%2C1101");
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(w.findAll(".promotion-merchant-table tbody tr")).toHaveLength(2);
  });
  it("defaults to seven days around launch, marks pending days and suppresses growth", async () => {
    const loader = vi.fn(async (_request: unknown) => fixture());
    const w = page({ reportLoader: loader });
    await flushPromises();
    expect(loader.mock.calls[0]?.[0]).toMatchObject({
      launchDate: "2026-09-07",
      merchantIds: "101,1101",
    });
    expect(w.get(".promotion-periods").text()).toContain(
      "2026-08-31 — 2026-09-06",
    );
    expect(w.get(".promotion-periods").text()).toContain(
      "2026-09-07 — 2026-09-13",
    );
    expect(w.findAll(".promotion-pair .pending")).toHaveLength(5);
    expect(w.get(".promotion-kpis").text()).toContain("观察期未结束");
    expect(w.get(".promotion-kpis").text()).not.toContain("+100.0%");
  });
  it("applies custom dates and drills down with the applied, not draft, request", async () => {
    const loader = vi.fn(
      async (request: { startDate?: string; endDate?: string }) => ({
        ...fixture(),
        dateRange: windowDates(
          batch.launchDate,
          request.startDate,
          request.endDate,
        )!,
      }),
    );
    const w = page({ reportLoader: loader });
    await flushPromises();
    await w.get('input[type="checkbox"]').setValue(true);
    const dates = w.findAllComponents(DatePicker);
    dates[1]!.vm.$emit("update:modelValue", "2026-08-01");
    dates[2]!.vm.$emit("update:modelValue", "2026-08-14");
    await w.get(".promotion-dates .primary").trigger("click");
    await flushPromises();
    expect(w.get(".promotion-periods").text()).toContain(
      "2026-07-18 — 2026-07-31",
    );
    dates[0]!.vm.$emit("update:modelValue", "2026-09-20");
    await w.get(".promotion-merchant-table tbody button").trigger("click");
    await flushPromises();
    expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({
      merchantId: "101",
      launchDate: "2026-09-07",
      startDate: "2026-08-01",
      endDate: "2026-08-14",
    });
  });
  it("shows exact merchant, publisher, ASIN and Storefront evidence and restores focus", async () => {
    const w = page();
    await flushPromises();
    const button = w.get(".promotion-merchant-table tbody button");
    (button.element as HTMLElement).focus();
    await button.trigger("click");
    await flushPromises();
    expect(document.activeElement?.id).toBe("promotion-detail");
    const detail = w.get("#promotion-detail");
    for (const text of [
      "Fixture Media",
      "Storefront",
      "未识别",
      "B012345678",
      "B098765432",
      "查看每月完整指标",
    ])
      expect(detail.text()).toContain(text);
    expect(detail.text()).not.toContain("Test Sports");
    await detail.get(".promotion-section-heading button").trigger("click");
    expect(document.activeElement).toBe(button.element);
  });
  it("keeps the cohort and absent metrics when the API fails, then retries", async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(fixture());
    const w = page({ reportLoader: loader });
    await flushPromises();
    expect(w.get('[role="alert"]').text()).toContain("暂未取得报表数据");
    expect(w.get(".promotion-merchant-table").text()).toContain("Test Home");
    expect(w.get(".promotion-kpis strong").text()).toBe("—");
    await w.get(".promotion-dates .primary").trigger("click");
    await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });
  it("filters exact cohort rows and exports applied dates and unrounded metrics", async () => {
    const download = vi.fn();
    const w = page({ download });
    await flushPromises();
    await w.get('input[aria-label="搜索商家或 ASIN"]').setValue("1101");
    expect(w.findAll(".promotion-merchant-table tbody tr")).toHaveLength(1);
    w.findComponent(DatePicker).vm.$emit("update:modelValue", "2026-09-20");
    await w
      .findAll("button")
      .find((b) => b.text() === "导出对比")!
      .trigger("click");
    expect(download.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        MerchantID: "1101",
        LaunchDate: "2026-09-07",
        Before_revenue: 100,
        After_revenue: 200,
      }),
    ]);
  });
  it("ignores a late merchant response after changing selection", async () => {
    let resolveFirst!: (value: PerformanceReport) => void;
    const loader = vi.fn(async (request: { merchantId?: string }) =>
      request.merchantId === "101"
        ? new Promise<PerformanceReport>((resolve) => {
            resolveFirst = resolve;
          })
        : fixture(),
    );
    const w = page({ reportLoader: loader });
    await flushPromises();
    await w
      .findAll(".promotion-merchant-table tbody button")[0]!
      .trigger("click");
    await flushPromises();
    await w
      .findAll(".promotion-merchant-table tbody button")[1]!
      .trigger("click");
    await flushPromises();
    resolveFirst({
      ...fixture(),
      media: [{ ...fixture().media![0]!, publisherName: "Stale media" }],
    });
    await flushPromises();
    expect(w.get("#promotion-detail").text()).toContain("Test Sports");
    expect(w.text()).not.toContain("Stale media");
  });
  it("localizes interface controls when switched to English", async () => {
    const w = page();
    await flushPromises();
    await w.setProps({ language: "en" });
    expect(w.text()).toContain("Offer promotion tracking");
    expect(w.get(".promotion-kpis").text()).toContain(
      "Observation in progress",
    );
    expect(w.get(".promotion-dates .primary").text()).toBe("Apply dates");
  });
  it("imports multiple sheets into a browser-local batch with its launch date", async () => {
    const readFile = vi.fn(async () => [
      [
        ["Merchant ID", "Merchant Name", "Category"],
        ["202", "Imported merchant", "Home"],
      ],
      [
        ["Merchant ID", "Top ASINs"],
        ["202", "B012345678"],
      ],
    ]);
    const loader = vi.fn(async (_request: unknown) => fixture());
    const w = page({ readFile, reportLoader: loader });
    await flushPromises();
    await w
      .findAll(".promotion-header button")
      .find((b) => b.text().includes("导入商家清单"))!
      .trigger("click");
    w.get(".promotion-import")
      .findComponent(DatePicker)
      .vm.$emit("update:modelValue", "2026-09-09");
    const input = w.get('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      value: [new File(["fixture"], "import.xlsx")],
    });
    await input.trigger("change");
    await flushPromises();
    expect(readFile).toHaveBeenCalledOnce();
    expect(loader.mock.calls.at(-1)?.[0]).toMatchObject({
      merchantIds: "202",
      launchDate: "2026-09-09",
    });
    expect(w.get(".promotion-batch").text()).toContain("1 ASIN");
    const saved = JSON.parse(localStorage.getItem("oi-promotion-batches-v1")!);
    expect(saved.at(-1)).toMatchObject({
      local: true,
      launchDate: "2026-09-09",
      offers: [
        expect.objectContaining({ merchantId: "202", asins: ["B012345678"] }),
      ],
    });
  });
});
