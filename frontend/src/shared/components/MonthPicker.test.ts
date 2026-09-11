import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import MonthPicker from "./MonthPicker.vue";

enableAutoUnmount(afterEach);
function picker(value = "2026-12") {
  return mount(MonthPicker, { attachTo: document.body, props: { modelValue: value, language: "zh", label: "月份", today: () => new Date(2026, 8, 11) } });
}
const panel = () => document.querySelector<HTMLElement>(".month-picker-panel")!;
describe("MonthPicker", () => {
  it("moves across years with arrow keys and returns focus after selecting", async () => {
    const wrapper = picker();
    await wrapper.get("button").trigger("click");
    await flushPromises();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flushPromises();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("2027 1月");
    (document.activeElement as HTMLButtonElement).click();
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["2027-01"]);
    expect(document.activeElement).toBe(wrapper.get("button").element);
    expect(panel()).toBeNull();
  });
  it("localizes the calendar and selects this month, while Escape keeps the current value", async () => {
    const wrapper = picker();
    await wrapper.get("button").trigger("click");
    await wrapper.setProps({ language: "en" });
    expect(panel().textContent).toContain("Dec");
    panel().querySelector<HTMLButtonElement>("footer button")!.click();
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["2026-09"]);
    await wrapper.get("button").trigger("click");
    panel().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(panel()).toBeNull();
    expect(wrapper.emitted("update:modelValue")).toHaveLength(1);
    expect(document.activeElement).toBe(wrapper.get("button").element);
  });
});
