import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PromotionListPicker from "./PromotionListPicker.vue";
import type { PromotionBatch } from "./performanceModel";

const batches: PromotionBatch[] = ["Alpha", "Beta", "中文清单"].map(
  (name, index) => ({
    id: String(index),
    name,
    sourceFile: `offers-${index}.xlsx`,
    launchDate: "2026-09-07",
    offers: [
      {
        merchantId: "101",
        merchantName: "Merchant",
        category: "Home",
        asins: ["B012345678"],
      },
    ],
  }),
);
const mounted: ReturnType<typeof mount>[] = [];
function setup() {
  const w = mount(PromotionListPicker, {
    attachTo: document.body,
    props: { modelValue: "0", batches, language: "zh" },
  });
  mounted.push(w);
  return w;
}
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  document.body.innerHTML = "";
});

describe("tracking list picker", () => {
  it("searches names and source files, shows counts, and selects by exact list ID", async () => {
    const w = setup();
    await w.get("button").trigger("click");
    const input = w.get('[role="combobox"]');
    expect(document.activeElement).toBe(input.element);
    expect(w.get('[aria-selected="true"]').text()).toContain("Alpha");
    expect(w.get('[role="option"]').text()).toContain("1 个商家 · 1 ASIN");
    await input.setValue("offers-1");
    expect(w.findAll('[role="option"]')).toHaveLength(1);
    await input.trigger("keydown", { key: "Enter" });
    expect(w.emitted("update:modelValue")?.[0]).toEqual(["1"]);
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(w.get("button").element);
    await w.get("button").trigger("click");
    await w.get('[role="combobox"]').setValue("中文");
    expect(w.findAll('[role="option"]')).toHaveLength(1);
    await w.get('[role="option"]').trigger("click");
    expect(w.emitted("update:modelValue")?.[1]).toEqual(["2"]);
  });
  it("supports keyboard navigation, IME composition, empty results, and Escape without selection", async () => {
    const w = setup();
    await w.get("button").trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    const input = w.get('[role="combobox"]');
    await input.trigger("keydown", { key: "ArrowDown" });
    expect(input.attributes("aria-activedescendant")).toBe(
      w.findAll('[role="option"]')[1]!.attributes("id"),
    );
    await input.trigger("keydown", { key: "Enter", isComposing: true });
    expect(w.emitted("update:modelValue")).toBeUndefined();
    await input.setValue("missing");
    expect(input.attributes("aria-activedescendant")).toBeUndefined();
    expect(w.text()).toContain("没有匹配的清单");
    await input.trigger("keydown", { key: "Enter" });
    expect(w.emitted("update:modelValue")).toBeUndefined();
    await input.trigger("keydown", { key: "Escape" });
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(w.get("button").element);
  });
  it("closes when focus or pointer leaves without stealing focus and localizes the picker", async () => {
    const w = setup();
    const outside = document.createElement("button");
    document.body.append(outside);
    await w.get("button").trigger("click");
    outside.focus();
    await flushPromises();
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(outside);
    await w.get("button").trigger("click");
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await flushPromises();
    expect(w.find('[role="dialog"]').exists()).toBe(false);
    await w.setProps({ language: "en" });
    await w.get("button").trigger("click");
    expect(w.get('[role="combobox"]').attributes("aria-label")).toBe(
      "Search list or file name",
    );
  });
});
