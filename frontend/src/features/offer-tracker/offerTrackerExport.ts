import type { OfferRecord, OfferTrackerExportPayload } from "../../shared/contracts/offer";
import { TIER_NAMES } from "../../shared/contracts/tier";
import { normalizeExportColor, objectExportColumns, type ExportSheet } from "../../shared/export/xlsx";
import { normalizeOfferRecord } from "./offerTrackerModel";

export const EXPORT_PRESETS = ["tier", "blue", "none"] as const;
export type ExportPreset = typeof EXPORT_PRESETS[number];
const tierColors: Readonly<Record<string, string>> = {
  "Tier 1": "#DBEAFE", "Tier 2": "#D1FAE5", "Tier 3": "#FEF3C7",
  "Tier 4": "#FFE4E6", "BLACK TIER": "#E2E8F0"
};

export function exportRowColor(row: OfferRecord, preset: ExportPreset): string {
  if (preset === "none") return "";
  if (preset === "blue") return "#DBEAFE";
  return tierColors[normalizeOfferRecord(row).tier] || "#F1F5F9";
}

export function exportMerchantSummary(rows: readonly OfferRecord[]) {
  const merchants = new Set<string>();
  const tiers = new Map<string, Set<string>>(TIER_NAMES.map((tier) => [tier, new Set<string>()]));
  rows.forEach((source, index) => {
    const row = normalizeOfferRecord(source);
    const identity = row.merchantId || row.merchantName || `row:${index}`;
    merchants.add(identity);
    const tier = row.tier || "Unassigned";
    if (!tiers.has(tier)) tiers.set(tier, new Set());
    tiers.get(tier)!.add(identity);
  });
  return { total: merchants.size, tiers: Array.from(tiers, ([tier, ids]) => ({ tier, count: ids.size })) };
}

export function limitExportMerchants(rows: readonly OfferRecord[], quantities: Readonly<Record<string, number>>): readonly OfferRecord[] {
  const selected = new Map<string, Set<string>>();
  return rows.filter((source, index) => {
    const row = normalizeOfferRecord(source);
    const tier = row.tier || "Unassigned";
    const identity = row.merchantId || row.merchantName || `row:${index}`;
    if (!selected.has(tier)) selected.set(tier, new Set());
    const ids = selected.get(tier)!;
    if (ids.has(identity)) return true;
    const limit = Number.isFinite(quantities[tier]) ? Math.max(0, Math.floor(quantities[tier]!)) : 0;
    if (ids.size >= limit) return false;
    ids.add(identity);
    return true;
  });
}

export function validExportRanges(ranges: NonNullable<OfferTrackerExportPayload["backgroundRanges"]>, rowCount: number): boolean {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  return sorted.every((range, index) => Number.isInteger(range.start) && Number.isInteger(range.end)
    && range.start >= 1 && range.start <= range.end && range.end <= rowCount
    && Boolean(normalizeExportColor(range.color)) && (!index || sorted[index - 1]!.end < range.start));
}

// Keep all source fields and row order; preview and download share the same sheet.
export function offerTrackerExportSheet(payload: OfferTrackerExportPayload): ExportSheet {
  const preset = payload.backgroundPreset || "tier";
  const ranges = payload.backgroundRanges || [];
  if (!validExportRanges(ranges, payload.rows.length)) throw new Error("Invalid export background ranges");
  return {
    sheetName: payload.view === "products" ? "Products" : "Offers",
    rows: payload.rows,
    columns: objectExportColumns(payload.rows, ["merchantName", "merchantId", "tier", "network", "affCommissionRate", "aov", "revenue", "category", "topAsins"]),
    referenceStyle: true,
    rowBackgroundRanges: [...ranges, ...(preset === "none" ? [] : payload.rows.map((row, index) => ({
      start: index + 1, end: index + 1, color: exportRowColor(row, preset)
    }))) ]
  };
}
