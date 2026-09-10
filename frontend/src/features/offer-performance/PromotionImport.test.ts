import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import PromotionImport from "./PromotionImport.vue";
import DatePicker from "../../shared/components/DatePicker.vue";

const tables: unknown[][][] = [
  [
    ["Merchant ID", "Merchant Name"],
    ["101", "First merchant"],
    ["101", "First merchant"],
    ["202", "Second merchant"],
  ],
];
const mounted: ReturnType<typeof mount>[] = [];
function setup(readFile = vi.fn(async () => tables)) {
  const wrapper = mount(PromotionImport, {
    attachTo: document.body,
    props: { language: "zh", defaultDate: "2026-09-07", readFile },
  });
  mounted.push(wrapper);
  return { wrapper, readFile };
}
async function choose(wrapper: ReturnType<typeof mount>) {
  const input = wrapper.get('input[type="file"]');
  Object.defineProperty(input.element, "files", {
    configurable: true,
    value: [new File(["sample"], "merchants.csv")],
  });
  await input.trigger("change");
}
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount());
  document.body.innerHTML = "";
});
describe("review before importing merchant lists", () => {
  it("only reads after the preview button and emits a deduplicated list only after confirmation", async () => {
    const { wrapper: w, readFile } = setup();
    expect(
      w.get(".promotion-import-action button").attributes("disabled"),
    ).toBeDefined();
    await choose(w);
    expect(readFile).not.toHaveBeenCalled();
    expect(w.text()).toContain("文件已选择，尚未导入");
    await w.get(".promotion-import-action button").trigger("click");
    await flushPromises();
    expect(w.get("dialog").attributes("open")).toBeDefined();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(w.findAll("tbody tr")).toHaveLength(2);
    expect(w.emitted("confirm")).toBeUndefined();
    await w.get("form").trigger("submit");
    expect(w.emitted("confirm")?.[0]?.[0]).toMatchObject({
      launchDate: "2026-09-07",
      offers: [{ merchantId: "101" }, { merchantId: "202" }],
    });
  });
  it("lets the user correct a missing or invalid date without reselecting the file", async () => {
    const { wrapper: w, readFile } = setup();
    await w.setProps({ defaultDate: "" });
    await choose(w);
    await w.get(".promotion-import-action button").trigger("click");
    await flushPromises();
    expect(w.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    const date = w.getComponent(DatePicker);
    date.vm.$emit("update:modelValue", "2026-02-30");
    await flushPromises();
    expect(w.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    date.vm.$emit("update:modelValue", "2026-08-31");
    await flushPromises();
    expect(w.get(".promotion-periods").text()).toContain(
      "2026-08-24 — 2026-08-30",
    );
    expect(w.get(".promotion-periods").text()).toContain(
      "2026-08-31 — 2026-09-06",
    );
    await w.get("form").trigger("submit");
    expect(readFile).toHaveBeenCalledOnce();
    expect(w.emitted("confirm")?.[0]?.[0]).toMatchObject({
      launchDate: "2026-08-31",
    });
  });
  it("cancels the modal without saving and returns focus to preview", async () => {
    const { wrapper: w } = setup();
    await choose(w);
    await w.get(".promotion-import-action button").trigger("click");
    await flushPromises();
    await w.get("dialog").trigger("cancel");
    await flushPromises();
    expect(w.find("dialog").exists()).toBe(false);
    expect(document.documentElement.style.overflow).toBe("");
    expect(w.emitted("confirm")).toBeUndefined();
    expect(document.activeElement).toBe(
      w.get(".promotion-import-action button").element,
    );
    expect(w.text()).toContain("merchants.csv");
  });
  it("retains the file after a read failure so preview can be retried", async () => {
    const readFile = vi
      .fn()
      .mockRejectedValueOnce(new Error("bad"))
      .mockResolvedValue(tables);
    const { wrapper: w } = setup(readFile);
    await choose(w);
    await w.get(".promotion-import-action button").trigger("click");
    await flushPromises();
    expect(w.get('[role="alert"]').text()).toContain("无法读取文件");
    await w.get(".promotion-import-action button").trigger("click");
    await flushPromises();
    expect(w.find('[role="alert"]').exists()).toBe(false);
    expect(w.get("dialog").text()).toContain("First merchant");
  });
  it("does not open a late preview after the import section is unmounted", async () => {
    let resolve!: (value: unknown[][][]) => void;
    const readFile = vi.fn(
      () =>
        new Promise<unknown[][][]>((done) => {
          resolve = done;
        }),
    );
    const { wrapper: w } = setup(readFile);
    await choose(w);
    await w.get(".promotion-import-action button").trigger("click");
    w.unmount();
    resolve(tables);
    await flushPromises();
    expect(document.querySelector("dialog")).toBeNull();
  });
});
