import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import OfferExportPreview from "./OfferExportPreview.vue";

enableAutoUnmount(afterEach);
const rows = Array.from({ length: 31 }, (_, i) => ({ merchantId: String(i), merchantName: `Merchant ${i}`, tier: i < 26 ? "Tier 1" : "Tier 3" }));
function preview(language: "zh" | "en" = "zh") {
  return mount(OfferExportPreview, { attachTo: document.body, global: { stubs: { teleport: true } }, props: { payload: { rows, view: "offers", selectedOnly: true }, language } });
}
describe("Offer export preview", () => {
  it("counts all selected pages, paginates, and sends the same rows with the chosen style", async () => {
    const wrapper = preview();
    expect(wrapper.text()).toContain("31 个商家");
    expect(wrapper.get('.offer-export-tier-counts').text()).toContain("Tier 126");
    expect(wrapper.findAll("tbody tr")).toHaveLength(25);
    await wrapper.get('nav button:last-child').trigger("click");
    expect(wrapper.findAll("tbody tr")).toHaveLength(6);
    await wrapper.get('input[value="none"]').setValue(true);
    expect(wrapper.get('tbody tr').attributes('style')).toContain('background: #fff');
    await wrapper.get('.offer-export-confirm').trigger("click");
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toMatchObject({ rows, backgroundPreset: "none" });
  });
  it("cancels without exporting, supports Escape, and localizes controls", async () => {
    const wrapper = preview("en");
    expect(wrapper.text()).toContain("Background color presets");
    await wrapper.get('[aria-label="Close preview"]').trigger("click");
    expect(wrapper.emitted('confirm')).toBeUndefined();
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(2);
  });
  it("keeps keyboard navigation within the dialog", async () => {
    const wrapper = preview();
    const last = wrapper.get('.offer-export-confirm');
    (last.element as HTMLElement).focus();
    await last.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(wrapper.get('[aria-label="关闭预览"]').element);
  });
  it("lets users limit each Tier and prevents exporting invalid highlight ranges", async () => {
    const wrapper = preview();
    await wrapper.get('[aria-label="Tier 1 导出商家数"]').setValue(2);
    await wrapper.get('[aria-label="Tier 3 导出商家数"]').setValue(0);
    expect(wrapper.findAll('tbody tr')).toHaveLength(2);
    await wrapper.get('.offer-export-custom > button').trigger('click');
    expect(wrapper.get('tbody tr').attributes('style')?.toLowerCase()).toContain('#d6eedd');
    await wrapper.findAll('.offer-export-range input[type="number"]')[1]!.setValue(3);
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.get('.offer-export-confirm').attributes('disabled')).toBeDefined();
    await wrapper.findAll('.offer-export-range input[type="number"]')[1]!.setValue(2);
    await wrapper.get('.offer-export-confirm').trigger('click');
    expect(wrapper.emitted('confirm')?.[0]?.[0]).toMatchObject({ rows: rows.slice(0, 2), backgroundRanges: [{ start: 1, end: 2, color: '#D6EEDD' }] });
  });
});
