import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import CategoryReportPage from "./CategoryReportPage.vue";
enableAutoUnmount(afterEach);

const report = {
  sheets: [
    {
      name: "Tier 1",
      rows: [
        { "Merchant ID": "101", "Merchant Name": "Alpha", Category: "Home", Revenue: "1,000", "Order count": "10", Clicks: "100" },
        { "Merchant ID": "102", "Merchant Name": "Beta", Category: "Beauty", Revenue: "500", "Order count": "5", Clicks: "50" }
      ]
    },
    {
      name: "Tier 2",
      rows: [{ "Merchant ID": "201", "Merchant Name": "Gamma", Category: "Home", Revenue: "2,000", "Order count": "20", Clicks: "200" }]
    }
  ]
};

describe("CategoryReportPage", () => {
  it("keeps the exit control available if an in-flight load returns no merchants", async () => {
    const pending: Array<(value: unknown) => void> = [];
    const wrapper = mount(CategoryReportPage, {
      attachTo: document.body,
      props: { language: "en", reportData: report, loadTier: () => new Promise(resolve => pending.push(resolve)) }
    });
    await wrapper.get(".category-full-view-button").trigger("click");
    pending.forEach(resolve => resolve({ rows: [] }));
    await flushPromises();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("No category rows match");
    (dialog.querySelector(".category-full-view-button") as HTMLButtonElement).click();
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
  it("keeps expanded merchants and sorting in full view, traps focus, and exits with Escape", async () => {
    const wrapper = mount(CategoryReportPage, {
      attachTo: document.body,
      props: { language: "zh", reportData: report, autoLoad: false }
    });
    await wrapper.get('[data-category-sort="orders"]').trigger("click");
    await wrapper.get(".dashboard-category-row").trigger("keydown", { key: " " });
    const merchants = wrapper.findAll(".category-detail-merchant-row").map(row => row.text());
    expect(merchants).toHaveLength(2);
    const scroll = wrapper.get(".dashboard-category-table-wrap").element;
    scroll.scrollTop = 80;
    const button = wrapper.get<HTMLButtonElement>(".category-full-view-button");
    expect(button.text()).toBe("全图视图");
    await button.trigger("click");
    await flushPromises();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.querySelector('[data-category-sort="orders"]')?.classList.contains("active")).toBe(true);
    expect(Array.from(dialog.querySelectorAll(".category-detail-merchant-row")).map(row => row.textContent)).toEqual(merchants);
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(button.element);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true }));
    expect(document.activeElement).toBe(dialog.querySelectorAll(".dashboard-category-row")[1]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    expect(document.activeElement).toBe(button.element);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(button.element);
    expect(wrapper.get(".dashboard-category-table-wrap").element.scrollTop).toBe(80);
    expect(wrapper.findAll(".category-detail-merchant-row")).toHaveLength(2);
    await button.trigger("click");
    wrapper.unmount();
    expect(document.body.style.overflow).toBe("");
    expect(document.querySelector(".is-full-view")).toBeNull();
  });
  it("renders the legacy report hierarchy, pie, optimization cards, and table", () => {
    const wrapper = mount(CategoryReportPage, {
      props: { language: "en", reportData: report, autoLoad: false }
    });

    expect(wrapper.find('[data-page="category"]').exists()).toBe(true);
    expect(wrapper.find(".dashboard-category-report").exists()).toBe(true);
    expect(wrapper.findAll("[data-category-tier]").length).toBe(6);
    expect(wrapper.find(".dashboard-category-pie").exists()).toBe(true);
    expect(wrapper.findAll(".category-idea-card")).toHaveLength(3);
    expect(wrapper.findAll(".dashboard-category-report-table tbody tr")).toHaveLength(2);
    expect(wrapper.text()).toContain("$3.5K");
  });

  it("supports exact category search, sorting, focus, and expanded merchant detail", async () => {
    const wrapper = mount(CategoryReportPage, {
      props: { language: "en", reportData: report, autoLoad: false }
    });

    const search = wrapper.get("#category-report-search");
    await search.setValue("Home");
    await search.trigger("change");
    expect(wrapper.findAll(".dashboard-category-report-table tbody .dashboard-category-row")).toHaveLength(1);
    expect(wrapper.text()).toContain("Showing category: Home");

    await wrapper.get(".category-pie-slice").trigger("click");
    await wrapper.get(".category-focus-back").trigger("click");
    await wrapper.get(".dashboard-category-row").trigger("click");
    expect(wrapper.find(".category-expanded-detail").exists()).toBe(true);
    await wrapper.get('[data-category-sort="orders"]').trigger("click");
    expect(wrapper.get('[data-category-sort="orders"]').classes()).toContain("active");
  });

  it("uses the injected export and tier loader boundaries", async () => {
    const downloads: unknown[] = [];
    const calls: string[] = [];
    const wrapper = mount(CategoryReportPage, {
      props: {
        language: "zh",
        reportData: report,
        autoLoad: true,
        loadTier: async ({ tier }) => {
          calls.push(tier);
          return { rows: [] };
        },
        download: (payload) => downloads.push(payload)
      }
    });

    await wrapper.get(".category-focus-export").trigger("click");
    expect(downloads).toHaveLength(1);
    expect(calls).toEqual(["Tier 1", "Tier 2", "Tier 3", "Tier 4"]);
  });
  it("exposes stable hooks for search, date, focus, and export interactions", () => {
    const wrapper = mount(CategoryReportPage, {
      props: {
        language: "en",
        reportData: report,
        autoLoad: false,
        download: () => undefined
      }
    });

    expect(wrapper.get('[data-category-action="search"]').element.tagName).toBe("INPUT");
    expect(wrapper.get('[data-category-date="start"]').element.tagName).toBe("INPUT");
    expect(wrapper.get('[data-category-date="end"]').element.tagName).toBe("INPUT");
    expect(wrapper.find('[data-category-action="apply-date"]').exists()).toBe(true);
    expect(wrapper.find('[data-category-action="export"]').exists()).toBe(true);
    expect(wrapper.find('[data-category-action="toggle-expanded"]').exists()).toBe(true);
  });

  it("presents category records with a publishers-style table toolbar", () => {
    const wrapper = mount(CategoryReportPage, {
      props: { language: "en", reportData: report, autoLoad: false }
    });

    const toolbar = wrapper.find(".dashboard-category-table-toolbar");
    expect(toolbar.exists()).toBe(true);
    expect(toolbar.get("h3").text()).toBe("Category Records");
    expect(toolbar.get("[data-category-table-count]").text()).toContain("2");
  });

});
