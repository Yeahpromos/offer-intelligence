import { describe, expect, it } from "vitest";
import { buildWorkbookFiles } from "../../shared/export/xlsx";
import { exportMerchantSummary, limitExportMerchants, validExportRanges, offerTrackerExportSheet } from "./offerTrackerExport";

const rows = [
  { merchantId: "1", merchantName: "A", tier: "tier1", revenue: 30 },
  { merchantId: "2", merchantName: "B", tier: "Tier 3", revenue: 20 },
  { merchantId: "1", merchantName: "A", tier: "Tier 1", revenue: 10 },
  { merchantId: "3", merchantName: "C", tier: "", revenue: 0 }
];
describe("Offer export workbook", () => {
  it("counts unique merchants rather than rows and includes empty and unassigned tiers", () => {
    expect(exportMerchantSummary(rows)).toEqual({ total: 3, tiers: [
      { tier: "Tier 1", count: 1 }, { tier: "Tier 2", count: 0 },
      { tier: "Tier 3", count: 1 }, { tier: "Tier 4", count: 0 },
      { tier: "BLACK TIER", count: 0 }, { tier: "Unassigned", count: 1 }
    ] });
  });
  it("writes Tier fills onto the correct rows without reordering or losing numeric values", () => {
    const sheet = offerTrackerExportSheet({ rows, view: "offers", selectedOnly: true, backgroundPreset: "tier" });
    const files = new Map(buildWorkbookFiles([sheet]).map((file) => [file.name, file.data]));
    expect(sheet.rows).toEqual(rows);
    expect(files.get("xl/styles.xml")).toContain('rgb="FFDBEAFE"');
    expect(files.get("xl/styles.xml")).toContain('rgb="FFFEF3C7"');
    const xml = files.get("xl/worksheets/sheet1.xml");
    expect(xml).toContain('<c r="A2" s="4"');
    expect(xml).toContain('<c r="A3" s="7"');
    expect(xml).toContain('<c r="A4" s="4"');
    expect(xml).toContain('<v>30</v>');
  });
  it("supports uniform and no-fill exports in products view", () => {
    const blue = offerTrackerExportSheet({ rows, view: "products", selectedOnly: false, backgroundPreset: "blue" });
    expect(blue.sheetName).toBe("Products");
    expect(new Set(blue.rowBackgroundRanges?.map((range) => range.color))).toEqual(new Set(["#DBEAFE"]));
    const plain = offerTrackerExportSheet({ rows, view: "offers", selectedOnly: true, backgroundPreset: "none" });
    expect(plain.rowBackgroundRanges).toEqual([]);
    expect(buildWorkbookFiles([plain]).find((file) => file.name === "xl/worksheets/sheet1.xml")?.data).not.toContain('r="A2" s=');
  });
  it("limits unique merchants per Tier while retaining their rows and original order", () => {
    expect(limitExportMerchants(rows, { 'Tier 1': 1 })).toEqual([rows[0], rows[2]]);
  });
  it("validates ranges and applies custom fills ahead of presets", () => {
    expect(validExportRanges([{ start: 1, end: 2, color: '#D6EEDD' }, { start: 2, end: 3, color: '#CCFFFF' }], 4)).toBe(false);
    expect(validExportRanges([{ start: 0, end: 5, color: 'bad' }], 4)).toBe(false);
    const sheet = offerTrackerExportSheet({ rows, view: 'offers', selectedOnly: true, backgroundPreset: 'tier', backgroundRanges: [{ start: 2, end: 2, color: '#CCFFFF' }] });
    const files = new Map(buildWorkbookFiles([sheet]).map((file) => [file.name, file.data]));
    expect(files.get('xl/styles.xml')).toContain('rgb="FFCCFFFF"');
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('<c r="A3" s="4"');
    expect(files.get('xl/worksheets/sheet1.xml')).toContain('<c r="A2" s="7"');
  });
});
