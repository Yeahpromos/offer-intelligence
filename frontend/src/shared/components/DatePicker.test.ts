import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import DatePicker from "./DatePicker.vue";

const mounted: ReturnType<typeof mount>[] = [];
function picker(value = "2026-09-09") {
  const wrapper = mount(DatePicker, { attachTo: document.body, props: { modelValue: value, language: "zh", label: "开始日期", today: () => new Date(2026, 8, 9, 12) } });
  mounted.push(wrapper);
  return wrapper;
}
const panel = () => document.querySelector<HTMLElement>(".date-picker-panel")!;
afterEach(() => { mounted.splice(0).forEach((wrapper) => wrapper.unmount()); });

describe("DatePicker", () => {
  it("navigates across month boundaries with the keyboard and restores focus after selection", async () => {
    const wrapper = picker("2026-09-30");
    await wrapper.get("button").trigger("click");
    await nextTick();
    await nextTick();
    expect(document.activeElement?.getAttribute("data-date")).toBe("2026-09-30");
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await nextTick();
    await nextTick();
    expect(document.activeElement?.getAttribute("data-date")).toBe("2026-10-01");
    (document.activeElement as HTMLButtonElement).click();
    await nextTick();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["2026-10-01"]);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(wrapper.get("button").element);
  });

  it("handles leap years, locale changes, clear, and today without UTC conversion", async () => {
    const wrapper = picker("2024-02-29");
    await wrapper.get("button").trigger("click");
    expect(panel().querySelector('[data-date="2024-02-29"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(panel().textContent).toContain("今天");
    await wrapper.setProps({ language: "en" });
    expect(panel().textContent).toContain("February");
    expect(panel().textContent).toContain("Today");
    panel().querySelector<HTMLButtonElement>(".date-picker-footer button")!.click();
    await nextTick();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([""]);
    await wrapper.get("button").trigger("click");
    panel().querySelector<HTMLButtonElement>(".date-picker-footer button:last-child")!.click();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["2026-09-09"]);
  });

  it("closes on Escape, outside interaction, and becoming disabled", async () => {
    const wrapper = picker();
    await wrapper.get("input").trigger("keydown", { key: "ArrowDown", altKey: true });
    expect(panel()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(panel()).toBeNull();
    await wrapper.get("button").trigger("click");
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await nextTick();
    expect(panel()).toBeNull();
    await wrapper.get("button").trigger("click");
    await wrapper.setProps({ disabled: true });
    expect(panel()).toBeNull();
    expect(wrapper.get("input").attributes("disabled")).toBeDefined();
  });
});
