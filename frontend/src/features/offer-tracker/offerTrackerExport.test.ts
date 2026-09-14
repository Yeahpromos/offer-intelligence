import { describe, expect, it } from "vitest";
import { buildWorkbookFiles } from "../../shared/export/xlsx";
import { exportMerchantSummary, limitExportMerchants, validExportRanges, offerTrackerExportSheet, offerTrackerExportSheets } from "./offerTrackerExport";

const rows = [
  { merchantId: "1", merchantName: "A", tier: "tier1", salesAmount: 30 },
  { merchantId: "2", merchantName: "B", tier: "Tier 3", salesAmount: 20 },
  { merchantId: "1", merchantName: "A", tier: "Tier 1", salesAmount: 10 },
  { merchantId: "3", merchantName: "C", tier: "", salesAmount: 0 }
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
    expect(blue.sheetName).toBe("Brand Product List");
    expect(new Set(blue.rowBackgroundRanges?.map((range) => range.color))).toEqual(new Set(["#DBEAFE"]));
    const plain = offerTrackerExportSheet({ rows, view: "offers", selectedOnly: true, backgroundPreset: "none" });
    expect(plain.rowBackgroundRanges).toEqual([]);
    expect(buildWorkbookFiles([plain]).find((file) => file.name === "xl/worksheets/sheet1.xml")?.data).not.toContain('r="A2" s=');
  });
  it("limits unique merchants per Tier while retaining their rows and original order", () => {
    expect(limitExportMerchants(rows, { 'Tier 1': 1 })).toEqual([rows[0], rows[2]]);
  });
  it("exports both sample schemas, readable widths, top five ranked ASINs, and numeric commissions", () => {
    const asins = ["B000000009", "B000000007", "B000000005", "B000000003", "B000000001", "B000000002"];
    const source = { ...rows[0], affCommissionRate: 0.5, topAsins: asins.join(","), internalField: "not for export" };
    const sheets = offerTrackerExportSheets({ rows: [source], view: "products", selectedOnly: true });
    expect(sheets.map(sheet => sheet.sheetName)).toEqual(["List of Offers", "Brand Product List"]);
    expect(sheets[0]!.columns!.map(column => column[0])).toEqual(["Priority", "Merchant ID", "Merchant Name", "Tier", "AFF Commission", "AOV", "Revenue", "AOV Type", "BB Preference", "Category", "Recommendation"]);
    expect(sheets[1]!.columns!.map(column => column[0])).toEqual(["Priority", "Merchant ID", "Merchant Name", "AOV", "Revenue", "AOV Type", "BB Preference", "Category", "Top Rank ASINs"]);
    const files = new Map(buildWorkbookFiles(sheets).map(file => [file.name, file.data]));
    const productsXml = String(files.get("xl/worksheets/sheet2.xml"));
    expect(productsXml).toContain(asins.slice(0, 5).join(", "));
    expect(productsXml).not.toContain(asins[5]);
    expect(productsXml).not.toContain("internalField");
    expect(productsXml).toContain('width="42"');
    expect(productsXml).toContain('state="frozen"');
    expect(files.get("xl/styles.xml")).toContain('wrapText="1"');
    expect(files.get("xl/worksheets/sheet1.xml")).toContain('<c r="E2" s="5"><v>0.005</v></c>');
    expect(source.topAsins).toBe(asins.join(","));
  });
  it("uses the same optional columns in both sheets and current priority rules", () => {
    const payload = { rows, view: "offers" as const, selectedOnly: false, visibleColumns: { aov: false, revenue: false, category: false, asins: false, commission: false, recommendation: false }, rules: { highScore: 1, lowAovMax: 100 } };
    const sheets = offerTrackerExportSheets(payload);
    expect(sheets[0]!.columns!.map(column => column[0])).toEqual(["Priority", "Merchant ID", "Merchant Name", "Tier", "BB Preference"]);
    expect(sheets[1]!.columns!.map(column => column[0])).toEqual(["Priority", "Merchant ID", "Merchant Name", "BB Preference"]);
    expect(sheets[0]!.columns![0]![1](rows[0]!)).toBe("High Priority");
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
