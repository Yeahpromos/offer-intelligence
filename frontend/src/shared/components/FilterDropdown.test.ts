import { enableAutoUnmount, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import FilterDropdown from "./FilterDropdown.vue";

enableAutoUnmount(afterEach);
const options = [
  { value: "mind", label: "介意 BB" },
  { value: "open", label: "不介意 BB" },
  { value: "unknown", label: "未知" },
];
const panel = () =>
  document.querySelector<HTMLElement>(".filter-dropdown-panel");
function dropdown(multiple = true, searchable = false) {
  const wrapper = mount(FilterDropdown, {
    attachTo: document.body,
    props: {
      options,
      modelValue: multiple ? [] : ["mind"],
      multiple,
      searchable,
      language: "zh" as const,
      label: "BB",
      "onUpdate:modelValue": (value: string[]) =>
        wrapper.setProps({ modelValue: value }),
    },
  });
  return wrapper;
}

describe("FilterDropdown", () => {
  it("keeps multiple choices open and clears them using All", async () => {
    const wrapper = dropdown();
    await wrapper.get("button").trigger("click");
    for (const value of ["mind", "open"]) {
      panel()!
        .querySelector<HTMLInputElement>(`input[value="${value}"]`)!
        .click();
      await nextTick();
    }
    expect(wrapper.props("modelValue")).toEqual(["mind", "open"]);
    expect(wrapper.get("button").attributes("aria-expanded")).toBe("true");
    expect(wrapper.text()).toContain("介意 BB、不介意 BB");
    panel()!.querySelector<HTMLButtonElement>(".filter-dropdown-all")!.click();
    await nextTick();
    expect(wrapper.props("modelValue")).toEqual([]);
    expect(panel()!.textContent).toContain("包含全部选项");
  });

  it("navigates choices by keyboard and restores focus after selection or Escape", async () => {
    const wrapper = dropdown(false);
    await wrapper.get("button").trigger("keydown", { key: "ArrowDown" });
    await nextTick();
    await nextTick();
    expect(document.activeElement?.textContent).toContain("介意 BB");
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    );
    (document.activeElement as HTMLButtonElement).click();
    await nextTick();
    expect(wrapper.props("modelValue")).toEqual(["unknown"]);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(wrapper.get("button").element);
    await wrapper.get("button").trigger("click");
    panel()!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(wrapper.get("button").element);
  });

  it("searches choices without dropping selections and closes on outside pointer input", async () => {
    const wrapper = dropdown(true, true);
    await wrapper.get("button").trigger("click");
    const input = panel()!.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    input.value = "未知";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(panel()!.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    panel()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    await nextTick();
    input.value = "no match";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await nextTick();
    expect(panel()!.querySelector('[role="status"]')?.textContent).toContain(
      "没有匹配",
    );
    expect(wrapper.props("modelValue")).toEqual(["unknown"]);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(panel()).toBeNull();
  });
});
