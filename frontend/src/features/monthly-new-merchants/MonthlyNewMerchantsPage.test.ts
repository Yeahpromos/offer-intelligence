import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import MonthlyNewMerchantsPage from "./MonthlyNewMerchantsPage.vue";

enableAutoUnmount(afterEach);

const records = [
  {
    recordId: 1,
    reportMonth: "2026-08",
    merchantId: "101",
    merchantName: "Alpha Home",
    program: "Amazon",
    platform: "Levanta",
    gmvRequirement: "$ 50,000",
    gmvMonthlyTarget: 50000,
    businessManager: "Dora",
    ourCommission: 35,
    presetCommission: 20,
    isPriority: true,
    updatedAt: "2026-08-31"
  },
  {
    recordId: 2,
    reportMonth: "2026-08",
    merchantId: "202",
    merchantName: "Beta Beauty",
    businessManager: "Alex",
    isPriority: false
  }
];

function mountPage(props: Record<string, unknown> = {}) {
  return mount(MonthlyNewMerchantsPage, {
    attachTo: document.body,
    global: { stubs: { teleport: true } },
    props: {
      language: "zh",
      month: "2026-08",
      records,
      autoLoad: false,
      ...props
    }
  });
}

describe("MonthlyNewMerchantsPage", () => {
  it("localizes modal actions and groups the merchant fields", async () => {
    const wrapper = mountPage();
    await wrapper.get('[data-modern-action="add"]').trigger("click");
    expect(wrapper.get('[data-modern-action="cancel-drawer"]').text()).toBe("取消");
    expect(wrapper.findAll(".monthly-new-merchant-form-section")).toHaveLength(3);
    expect(wrapper.get('[data-modern-field="gmv-requirement"]').attributes("placeholder")).toContain("例如");
    await wrapper.get('[data-modern-action="cancel-drawer"]').trigger("click");
    await wrapper.get('[data-modern-action="import"]').trigger("click");
    expect(wrapper.get('[data-modern-action="cancel-import"]').text()).toBe("取消");
    await wrapper.setProps({ language: "en" });
    expect(wrapper.get('[data-modern-action="cancel-import"]').text()).toBe("Cancel");
  });

  it("keeps the legacy table hierarchy, summary and priority interaction visible", async () => {
    const wrapper = mountPage();

    expect(wrapper.find('[data-page="monthly-new-merchants"]').exists()).toBe(true);
    expect(wrapper.find(".monthly-new-merchants-header").exists()).toBe(true);
    expect(wrapper.find(".month-picker-trigger").exists()).toBe(true);
    expect(wrapper.findAll(".monthly-new-merchants-table thead th")).toHaveLength(14);
    expect(wrapper.findAll(".monthly-new-merchants-table tbody tr")).toHaveLength(2);
    expect(wrapper.find(".monthly-new-merchants-table tbody tr").classes()).toContain("is-priority");
    expect(wrapper.text()).toContain("2026");
    expect(wrapper.text()).toContain("50,000");

    await wrapper.get('[data-modern-action="search"]').setValue("Beta");
    expect(wrapper.findAll(".monthly-new-merchants-table tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("Beta Beauty");
    expect(wrapper.text()).not.toContain("Alpha Home");
  });

  it("renders the same empty state boundary when a month has no records", () => {
    const wrapper = mountPage({ records: [] });

    expect(wrapper.find(".monthly-new-merchants-table-wrap").exists()).toBe(false);
    expect(wrapper.find(".monthly-new-merchants-empty").exists()).toBe(true);
    expect(wrapper.text()).toContain("本月还没有上新商家");
  });

  it("opens the add drawer, restores focus, and serializes a submitted record", async () => {
    const saved: unknown[] = [];
    const wrapper = mountPage({
      saveData: async (payload: unknown) => {
        saved.push(payload);
        return { record: { ...(payload as Record<string, unknown>), recordId: 3 } };
      }
    });
    const addButton = wrapper.get('[data-modern-action="add"]');

    await addButton.trigger("click");
    await flushPromises();
    expect(wrapper.find(".monthly-new-merchant-drawer-backdrop").classes()).not.toContain("hidden");
    const nameInput = wrapper.get('[data-modern-field="merchant-name"]');
    expect(document.activeElement).toBe(nameInput.element);
    await nameInput.setValue("New Merchant");
    await wrapper.get('[data-modern-action="save"]').trigger("click");
    await flushPromises();

    expect(saved[0]).toMatchObject({
      action: "upsert",
      reportMonth: "2026-08",
      merchantName: "New Merchant"
    });
    expect(wrapper.find(".monthly-new-merchant-drawer-backdrop").exists()).toBe(false);
    expect(document.activeElement).toBe(addButton.element);
  });

  it("previews pasted rows and exposes row-level import errors before saving", async () => {
    const wrapper = mountPage();
    await wrapper.get('[data-modern-action="import"]').trigger("click");
    await wrapper.get('[data-modern-field="import-paste"]').setValue(
      "Brand\tMerchant ID\tOur Commission\nAcme\tbad\t125%"
    );
    await wrapper.get('[data-modern-action="preview-import"]').trigger("click");
    expect(wrapper.find(".monthly-new-merchant-import-preview table").exists()).toBe(true);
    expect(wrapper.find(".import-status-error").exists()).toBe(true);
    expect(wrapper.get('[data-modern-action="import-save"]').attributes("disabled")).toBeDefined();
  });
});
