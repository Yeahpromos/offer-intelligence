export const CATEGORY_REPORT_STANDARD_TIERS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4"] as const;
export const CATEGORY_REPORT_TIER_OPTIONS = [...CATEGORY_REPORT_STANDARD_TIERS, "BLACK TIER"] as const;

export type CategoryReportTier = (typeof CATEGORY_REPORT_TIER_OPTIONS)[number];
export type CategoryReportSortKey =
  | "category"
  | "merchantCount"
  | "revenue"
  | "orders"
  | "clicks"
  | "avgCvr"
  | "avgEpc"
  | "avgAov";
export type CategoryReportSortDirection = "asc" | "desc";

export interface CategoryReportSheet {
  readonly name?: unknown;
  readonly sheetName?: unknown;
  readonly headers?: readonly unknown[];
  readonly rows?: readonly unknown[];
}

export interface CategoryReportData {
  readonly sheets?: readonly CategoryReportSheet[];
  readonly tierSheets?: readonly unknown[];
  readonly offers?: readonly unknown[];
  readonly startDate?: unknown;
  readonly endDate?: unknown;
}

export interface CategoryReportSelection {
  readonly type: "category" | "merchant";
  readonly category?: string;
  readonly merchantId?: string;
  readonly merchantName?: string;
  readonly value?: string;
}

export interface CategoryReportRow {
  readonly key: string;
  readonly tier: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly category: string;
  readonly categorySource: string;
  readonly network: string;
  readonly country: string;
  readonly revenue: number;
  readonly orders: number;
  readonly clicks: number;
  readonly payout: number;
  readonly epc: number | null;
  readonly aov: number | null;
  readonly cvr: number | null;
  readonly monthKey: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface CategoryReportGroup {
  readonly category: string;
  readonly rows: readonly CategoryReportRow[];
  readonly merchantCount: number;
  readonly rowCount: number;
  readonly revenue: number;
  readonly orders: number;
  readonly clicks: number;
  readonly avgCvr: number | null;
  readonly avgEpc: number | null;
  readonly avgAov: number | null;
  readonly topMerchant: string;
  readonly previewMerchants: string;
  readonly tierBreakdown: Readonly<Record<string, number>>;
}

export interface CategorySearchEntry {
  readonly type: "category" | "merchant";
  readonly value: string;
  readonly category?: string;
  readonly merchantId?: string;
  readonly merchantName?: string;
}

export interface CategoryPieSlice {
  readonly group: CategoryReportGroup;
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly tint: string;
  readonly value: number;
  readonly share: number;
  readonly dash: number;
  readonly dashOffset: number;
}

export interface CategoryTrendRow {
  readonly monthKey: string;
  readonly label: string;
  readonly revenue: number;
  readonly orders: number;
  readonly clicks: number;
  readonly merchantCount: number;
}

type RawRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function nonEmpty(value: unknown): string {
  const result = text(value);
  return result && result.toLowerCase() !== "uncategorized" ? result : "";
}

function firstValue(records: readonly RawRecord[], keys: readonly string[]): string {
  for (const record of records) {
    for (const key of keys) {
      const value = nonEmpty(record[key]);
      if (value) return value;
    }
  }
  return "";
}

export function parseCategoryNumber(value: unknown): number {
  const cleaned = text(value).replace(/[$,%]/g, "").replace(/,/g, "");
  if (!cleaned) return 0;
  const result = Number(cleaned);
  return Number.isFinite(result) ? result : 0;
}

function nullableCategoryNumber(records: readonly RawRecord[], keys: readonly string[]): number | null {
  for (const record of records) {
    for (const key of keys) {
      if (record[key] === undefined || record[key] === null || !text(record[key])) continue;
      const parsed = Number(text(record[key]).replace(/[$,%]/g, "").replace(/,/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function canonicalTier(value: unknown): string {
  const raw = text(value);
  if (raw.toLowerCase() === "black tier") return "BLACK TIER";
  const match = raw.match(/^tier\s*([1-4])$/i);
  return match?.[1] ? "Tier " + match[1] : raw;
}

function rowValue(record: RawRecord, keys: readonly string[]): string {
  return firstValue([record], keys);
}

function offerIndex(data: CategoryReportData): ReadonlyMap<string, RawRecord> {
  const index = new Map<string, RawRecord>();
  for (const value of data.offers || []) {
    if (!isRecord(value)) continue;
    const id = rowValue(value, ["merchantId", "merchant_id", "Merchant ID", "MerchantID", "id"]);
    if (id && !index.has(id.replace(/\.0$/, ""))) index.set(id.replace(/\.0$/, ""), value);
  }
  return index;
}

/**
 * Resolve the display category using the established dashboard priority order.
 * Category on a Tier Sheet is the database main-category column.
 */
export function resolveCategory(row: Readonly<Record<string, unknown>>, offer?: Readonly<Record<string, unknown>>): {
  readonly category: string;
  readonly source: string;
} {
  const records = [row, ...(offer ? [offer] : [])];
  const sheetCategory = firstValue(records, ["sheetCategory", "Sheet Category", "sheet_category"]);
  if (sheetCategory) return { category: sheetCategory, source: "sheetCategory" };

  const mainCategory = firstValue(records, ["mainCategory", "Main Category", "main_category", "Category"]);
  if (mainCategory) return { category: mainCategory, source: "mainCategory" };

  const feishuSource = records.some((record) => text(record.categorySource).toLowerCase() === "feishu");
  const feishuCategory = firstValue(records, [
    "feishuMainCategory",
    "Feishu Main Category",
    "feishuCategory",
    "Feishu Category"
  ]) || (feishuSource ? firstValue(records, ["category", "Category"]) : "");
  if (feishuCategory) return { category: feishuCategory, source: "feishu" };

  const otherCategory = firstValue(records, [
    "otherCategory",
    "category",
    "Category"
  ]);
  if (otherCategory) return { category: otherCategory, source: "other" };

  const levantaCategory = firstValue(records, ["levantaCategory", "Levanta Category", "levanta_category"]);
  if (levantaCategory) return { category: levantaCategory, source: "levantaCategory" };

  return { category: "Uncategorized", source: "uncategorized" };
}

function monthKey(value: unknown): string {
  const raw = text(value);
  const match = raw.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?/);
  if (match?.[1] && match[2]) return match[1] + "-" + String(Number(match[2])).padStart(2, "0");
  const monthName = raw.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!monthName?.[1] || !monthName[2]) return "";
  const index = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ].indexOf(monthName[1].toLowerCase());
  return index < 0 ? "" : monthName[2] + "-" + String(index + 1).padStart(2, "0");
}

function monthValue(records: readonly RawRecord[]): string {
  for (const record of records) {
    const value = firstValue([record], ["monthKey", "Month Key", "month", "Month", "reportMonth", "Report Month", "date", "Date"]);
    const key = monthKey(value);
    if (key) return key;
  }
  return "";
}

function numericValue(records: readonly RawRecord[], keys: readonly string[], fallback = 0): number {
  for (const record of records) {
    for (const key of keys) {
      if (record[key] === undefined || record[key] === null || !text(record[key])) continue;
      return parseCategoryNumber(record[key]);
    }
  }
  return fallback;
}

export function buildCategoryRows(
  data: CategoryReportData,
  selectedTiers: readonly string[] = CATEGORY_REPORT_STANDARD_TIERS,
  livePayloads: Readonly<Record<string, unknown>> = {}
): CategoryReportRow[] {
  const selected = new Set(selectedTiers.map(canonicalTier));
  const offers = offerIndex(data);
  const rows: CategoryReportRow[] = [];

  for (const sheet of data.sheets || []) {
    if (!isRecord(sheet)) continue;
    const tier = canonicalTier(sheet.name ?? sheet.sheetName);
    if (!selected.has(tier)) continue;
    const snapshotRows = Array.isArray(sheet.rows) ? sheet.rows.filter(isRecord) : [];
    const payload = livePayloads[tier];
    const liveRows = isRecord(payload) && Array.isArray(payload.rows)
      ? payload.rows.filter(isRecord)
      : null;
    const snapshotByMerchant = new Map(snapshotRows.map((row) => [
      rowValue(row, ["Merchant ID", "MerchantID", "ID", "merchantId"]).replace(/\.0$/, ""),
      row
    ] as const));
    const sourceRows = liveRows === null
      ? snapshotRows
      : liveRows.map((row) => ({
        ...(snapshotByMerchant.get(rowValue(row, ["Merchant ID", "MerchantID", "ID", "merchantId"]).replace(/\.0$/, "")) || {}),
        ...row
      }));

    sourceRows.forEach((row, index) => {
      const merchantId = rowValue(row, ["Merchant ID", "MerchantID", "ID", "merchantId"]).replace(/\.0$/, "");
      const offer = offers.get(merchantId);
      const records = [row, ...(offer ? [offer] : [])];
      const resolution = resolveCategory(row, offer);
      const merchantName = firstValue(records, ["Merchant Name", "merchantName", "Brand", "brand", "Merchant", "merchant"]) || merchantId;
      const revenue = numericValue(records, ["Revenue", "Sales Amount", "Sales", "revenue", "salesAmount"]);
      const orders = numericValue(records, ["Order count", "Order Count", "Orders", "orders"]);
      const clicks = numericValue(records, ["Clicks", "Total Clicks", "clicks"]);
      const epc = nullableCategoryNumber(records, ["EPC(Aff)", "Aff EPC", "Backend EPC", "EPC", "EPC(All)", "All EPC", "epc"]);
      const aov = nullableCategoryNumber(records, ["AOV", "aov"]) ?? (orders ? revenue / orders : null);
      const cvr = nullableCategoryNumber(records, ["Conversion", "Conversion Rate", "CVR", "conversionRate"]) ?? (clicks ? orders / clicks : null);
      const payout = numericValue(records, ["Payout", "Affiliate Payout", "AFF Commission", "affiliatePayout", "affCommission"]);
      rows.push({
        key: tier + "::" + (merchantId || "row") + "::" + index,
        tier,
        merchantId,
        merchantName,
        category: resolution.category,
        categorySource: resolution.source,
        network: firstValue(records, ["Network", "network", "Agency", "agency"]),
        country: firstValue(records, ["COUNTRY", "Country", "country", "region"]),
        revenue,
        orders,
        clicks,
        payout,
        epc,
        aov,
        cvr,
        monthKey: monthValue(records),
        raw: { ...row, __tierName: tier }
      });
    });
  }
  return rows;
}

function normalizedCategory(value: unknown): string {
  return text(value).toLowerCase();
}

export function categoryKey(value: unknown): string {
  const normalized = text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "uncategorized";
}

function categoryCompare(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function aggregateCategoryGroups(rows: readonly CategoryReportRow[]): CategoryReportGroup[] {
  const groups = new Map<string, {
    category: string;
    rows: CategoryReportRow[];
    merchantIds: Set<string>;
    revenue: number;
    orders: number;
    clicks: number;
    epcWeighted: number;
    epcSum: number;
    epcCount: number;
    tierBreakdown: Record<string, number>;
  }>();
  for (const row of rows) {
    const groupKey = normalizedCategory(row.category) || "uncategorized";
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        category: row.category || "Uncategorized",
        rows: [],
        merchantIds: new Set<string>(),
        revenue: 0,
        orders: 0,
        clicks: 0,
        epcWeighted: 0,
        epcSum: 0,
        epcCount: 0,
        tierBreakdown: {}
      };
      groups.set(groupKey, group);
    }
    group.rows.push(row);
    if (row.merchantId) group.merchantIds.add(row.merchantId);
    group.revenue += row.revenue;
    group.orders += row.orders;
    group.clicks += row.clicks;
    group.tierBreakdown[row.tier] = (group.tierBreakdown[row.tier] || 0) + 1;
    if (row.epc !== null) {
      group.epcSum += row.epc;
      group.epcCount += 1;
      if (row.clicks) group.epcWeighted += row.epc * row.clicks;
    }
  }

  return Array.from(groups.values()).map((group) => {
    const sortedRows = group.rows.slice().sort((left, right) =>
      right.revenue - left.revenue || right.orders - left.orders || right.clicks - left.clicks
    );
    const previewMerchants = sortedRows.slice(0, 3).map((row) => row.merchantName).filter(Boolean).join(", ");
    return {
      category: group.category,
      rows: sortedRows,
      merchantCount: group.merchantIds.size || group.rows.length,
      rowCount: group.rows.length,
      revenue: group.revenue,
      orders: group.orders,
      clicks: group.clicks,
      avgCvr: group.clicks ? group.orders / group.clicks : null,
      avgEpc: group.clicks && group.epcWeighted ? group.epcWeighted / group.clicks : group.epcCount ? group.epcSum / group.epcCount : null,
      avgAov: group.orders ? group.revenue / group.orders : null,
      topMerchant: sortedRows[0]?.merchantName || "",
      previewMerchants,
      tierBreakdown: group.tierBreakdown
    };
  });
}

function sortValue(group: CategoryReportGroup, key: CategoryReportSortKey): number | string {
  if (key === "category") return group.category;
  return group[key] ?? 0;
}

export function sortCategoryGroups(
  groups: readonly CategoryReportGroup[],
  key: CategoryReportSortKey = "revenue",
  direction: CategoryReportSortDirection = "desc"
): CategoryReportGroup[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return groups.slice().sort((left, right) => {
    if (left.category === "Uncategorized" && right.category !== "Uncategorized") return 1;
    if (right.category === "Uncategorized" && left.category !== "Uncategorized") return -1;
    const leftValue = sortValue(left, key);
    const rightValue = sortValue(right, key);
    const result = typeof leftValue === "string" || typeof rightValue === "string"
      ? categoryCompare(String(leftValue), String(rightValue))
      : Number(leftValue) - Number(rightValue);
    return result * multiplier || categoryCompare(left.category, right.category);
  });
}

export function filterCategoryGroups(
  groups: readonly CategoryReportGroup[],
  selection?: CategoryReportSelection | null,
  search = ""
): CategoryReportGroup[] {
  if (selection?.type === "category") {
    const key = categoryKey(selection.category);
    return groups.filter((group) => categoryKey(group.category) === key);
  }
  if (selection?.type === "merchant") {
    const id = text(selection.merchantId);
    const name = normalizedCategory(selection.merchantName);
    return groups.filter((group) => group.rows.some((row) =>
      (id && row.merchantId === id) || (name && normalizedCategory(row.merchantName) === name)
    ));
  }
  const query = normalizedCategory(search);
  if (!query) return groups.slice();
  return groups.filter((group) => group.category.toLowerCase().includes(query)
    || group.rows.some((row) => (row.merchantName + " " + row.merchantId).toLowerCase().includes(query)));
}

export function categorySearchEntries(rows: readonly CategoryReportRow[]): CategorySearchEntry[] {
  const categories = new Map<string, CategorySearchEntry>();
  const merchants = new Map<string, CategorySearchEntry>();
  rows.forEach((row) => {
    const category = row.category;
    const categoryId = normalizedCategory(category);
    if (category && !categories.has(categoryId)) {
      categories.set(categoryId, { type: "category", value: category, category });
    }
    if (!row.merchantId && !row.merchantName) return;
    const key = row.merchantId ? "id:" + row.merchantId : "name:" + normalizedCategory(row.merchantName);
    if (!merchants.has(key)) {
      const label = row.merchantName || row.merchantId;
      merchants.set(key, {
        type: "merchant",
        value: row.merchantId ? label + " · " + row.merchantId : label + " · merchant",
        merchantId: row.merchantId,
        merchantName: label
      });
    }
  });
  const byValue = (left: CategorySearchEntry, right: CategorySearchEntry) => categoryCompare(left.value, right.value);
  return [...Array.from(categories.values()).sort(byValue), ...Array.from(merchants.values()).sort(byValue)];
}

function otherGroup(slices: readonly { group: CategoryReportGroup; value: number }[]): CategoryReportGroup {
  const rows = slices.flatMap((slice) => slice.group.rows);
  const revenue = slices.reduce((sum, slice) => sum + slice.group.revenue, 0);
  const orders = slices.reduce((sum, slice) => sum + slice.group.orders, 0);
  const clicks = slices.reduce((sum, slice) => sum + slice.group.clicks, 0);
  const merchantCount = slices.reduce((sum, slice) => sum + slice.group.merchantCount, 0);
  const topMerchants = slices.map((slice) => slice.group.topMerchant).filter(Boolean).slice(0, 3).join(", ");
  const tierBreakdown: Record<string, number> = {};
  rows.forEach((row) => { tierBreakdown[row.tier] = (tierBreakdown[row.tier] || 0) + 1; });
  return {
    category: "Other selected categories",
    rows,
    merchantCount,
    rowCount: rows.length,
    revenue,
    orders,
    clicks,
    avgCvr: clicks ? orders / clicks : null,
    avgEpc: null,
    avgAov: orders ? revenue / orders : null,
    topMerchant: topMerchants,
    previewMerchants: topMerchants,
    tierBreakdown
  };
}

export function categoryPieMetricKey(sortKey: CategoryReportSortKey = "revenue"): "merchantCount" | "revenue" | "orders" | "clicks" {
  return ["merchantCount", "revenue", "orders", "clicks"].includes(sortKey)
    ? sortKey as "merchantCount" | "revenue" | "orders" | "clicks"
    : "revenue";
}

function categoryMetricValue(group: CategoryReportGroup, metric: ReturnType<typeof categoryPieMetricKey>): number {
  return Number(group[metric]) || 0;
}

export function categoryPalette(category: string): { readonly color: string; readonly tint: string } {
  const lower = category.toLowerCase();
  const palettes: readonly [RegExp, string, string][] = [
    [/baby|kid|nursery|stroller|children|toddler/, "#ff3d9a", "#fff0f7"],
    [/electronic|cell phone|camera|audio|video games|computer|software/, "#3478ff", "#edf4ff"],
    [/beauty|personal care|skin|hair|makeup/, "#a23bff", "#f6edff"],
    [/home\s*(?:&|and)?\s*kitchen/, "#00c985", "#eafff7"],
    [/kitchen\s*(?:&|and)?\s*dining|dining|cookware|food/, "#ffb000", "#fff7e6"],
    [/home|furniture|bedding|mattress/, "#00c985", "#eafff7"],
    [/health|household|wellness|medical|vitamin/, "#00c6e8", "#e9fbff"],
    [/clothing|shoes|jewelry|fashion|apparel/, "#ff6a2b", "#fff0ea"],
    [/patio|lawn|garden|outdoor|sports|camping/, "#93db16", "#f3ffe7"],
    [/pet|dog|cat/, "#ffd21c", "#fff9d8"],
    [/automotive|motorcycle|car/, "#ff4457", "#fff0f0"]
  ];
  const found = palettes.find(([pattern]) => pattern.test(lower));
  return found ? { color: found[1], tint: found[2] } : { color: "#64748b", tint: "#f1f5f9" };
}

export function buildCategoryPieSlices(
  groups: readonly CategoryReportGroup[],
  selectedTiers: readonly string[] = CATEGORY_REPORT_STANDARD_TIERS,
  sortKey: CategoryReportSortKey = "revenue",
  focusKey = ""
): CategoryPieSlice[] {
  const metric = categoryPieMetricKey(sortKey);
  const positive = groups.map((group) => ({ group, value: categoryMetricValue(group, metric) })).filter((slice) => slice.value > 0);
  const total = positive.reduce((sum, slice) => sum + slice.value, 0);
  if (!total) return [];
  const selected = new Set(selectedTiers.map(canonicalTier));
  const globalOverview = CATEGORY_REPORT_STANDARD_TIERS.every((tier) => selected.has(tier))
    && selected.size === CATEGORY_REPORT_STANDARD_TIERS.length;
  const visible = globalOverview && !focusKey ? positive.slice(0, 7) : positive.slice();
  const overflow = globalOverview && !focusKey ? positive.slice(7) : [];
  if (overflow.length) visible.push({
    group: otherGroup(overflow),
    value: overflow.reduce((sum, slice) => sum + slice.value, 0)
  });
  let current = 0;
  return visible.map((slice) => {
    const share = slice.value / total;
    const dash = share * 100;
    const palette = slice.group.category === "Other selected categories"
      ? { color: "#6366f1", tint: "#eef2ff" }
      : categoryPalette(slice.group.category);
    const result: CategoryPieSlice = {
      group: slice.group,
      key: slice.group.category === "Other selected categories" ? "other-categories" : categoryKey(slice.group.category),
      label: slice.group.category,
      color: palette.color,
      tint: palette.tint,
      value: slice.value,
      share,
      dash,
      dashOffset: -current
    };
    current += dash;
    return result;
  });
}

function monthLabel(value: string): string {
  const date = new Date(value + "-01T00:00:00");
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function buildCategoryTrendRows(rows: readonly CategoryReportRow[], category: string): CategoryTrendRow[] {
  const groups = new Map<string, { revenue: number; orders: number; clicks: number; merchantIds: Set<string> }>();
  rows.filter((row) => categoryKey(row.category) === categoryKey(category) && row.monthKey).forEach((row) => {
    const current = groups.get(row.monthKey) || { revenue: 0, orders: 0, clicks: 0, merchantIds: new Set<string>() };
    current.revenue += row.revenue;
    current.orders += row.orders;
    current.clicks += row.clicks;
    if (row.merchantId) current.merchantIds.add(row.merchantId);
    groups.set(row.monthKey, current);
  });
  return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({
    monthKey: key,
    label: monthLabel(key),
    revenue: value.revenue,
    orders: value.orders,
    clicks: value.clicks,
    merchantCount: value.merchantIds.size
  }));
}
