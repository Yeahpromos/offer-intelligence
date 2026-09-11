import {
  toFiniteNumber,
  toNullableNumber
} from "../../shared/format/number";
import { translateMessage } from "../../shared/i18n";
import { TIER_NAMES } from "../../shared/contracts/tier";
import type {
  OfferRecord,
  OfferTrackerAovType,
  OfferTrackerBbPolicy,
  OfferTrackerDateRange,
  OfferTrackerExportColumn,
  OfferTrackerFilterInput,
  OfferTrackerFilters,
  OfferTrackerPage,
  OfferTrackerPriority,
  OfferTrackerPriorityKey,
  OfferTrackerRevenueSort,
  OfferTrackerRevenueStatus,
  OfferTrackerRow,
  OfferTrackerRules,
  OfferTrackerSelectionSummary,
  OfferTrackerView
} from "../../shared/contracts/offer";

export const DEFAULT_OFFER_TRACKER_RULES: OfferTrackerRules = Object.freeze({
  highScore: 8,
  lowAovMax: 100
});

export function normalizeOfferTrackerRules(
  input: Partial<OfferTrackerRules> = {}
): OfferTrackerRules {
  const requestedHighScore = toFiniteNumber(input.highScore, DEFAULT_OFFER_TRACKER_RULES.highScore);
  const requestedLowAovMax = toFiniteNumber(input.lowAovMax, DEFAULT_OFFER_TRACKER_RULES.lowAovMax);
  return Object.freeze({
    highScore: Math.min(11, Math.max(4, Math.round(requestedHighScore || DEFAULT_OFFER_TRACKER_RULES.highScore))),
    lowAovMax: Math.max(1, requestedLowAovMax || DEFAULT_OFFER_TRACKER_RULES.lowAovMax)
  });
}

const DEFAULT_DATE_RANGE: OfferTrackerDateRange = Object.freeze({
  startDate: "1970-01-01",
  endDate: "1970-01-01"
});

const MIND_BB_BRANDS = [
  "ulike", "aiper", "neakasa", "speediance", "wolfbox", "redtiger", "beatbot",
  "mammotion", "3w", "gosovr", "worx", "true classic", "viture", "tp-link", "sublue"
] as const;

const OPEN_BB_BRANDS = [
  "merach", "heyzoo", "ottocast", "rockbros", "chebio", "tabwee", "shaperx", "bluewood",
  "featol", "aochuan", "edifier", "gaialoop", "tagry", "hisense", "shokz", "gyroor",
  "dji", "level8", "bassbloom", "derila", "akusoli", "matsato", "nuubu", "synoshi",
  "enence", "kinzeno"
] as const;

const OFFER_TRACKER_TIERS = TIER_NAMES;

const OFFER_COLUMNS: readonly OfferTrackerExportColumn[] = Object.freeze([
  { label: "Priority", key: "priority" },
  { label: "Merchant ID", key: "merchantId" },
  { label: "Merchant Name", key: "merchantName" },
  { label: "Tier", key: "tier" },
  { label: "AFF Commission", key: "commission" },
  { label: "AOV", key: "aov" },
  { label: "Revenue", key: "revenue" },
  { label: "AOV Type", key: "aovType" },
  { label: "BB Preference", key: "bbPolicy" },
  { label: "Category", key: "category" },
  { label: "Recommendation", key: "recommendation" }
]);

const PRODUCT_COLUMNS: readonly OfferTrackerExportColumn[] = Object.freeze([
  { label: "Priority", key: "priority" },
  { label: "Merchant ID", key: "merchantId" },
  { label: "Merchant Name", key: "merchantName" },
  { label: "AOV", key: "aov" },
  { label: "Revenue", key: "revenue" },
  { label: "AOV Type", key: "aovType" },
  { label: "BB Preference", key: "bbPolicy" },
  { label: "Category", key: "category" },
  { label: "Top Rank ASINs", key: "asins" }
]);

function recordValue(record: OfferRecord, key: string): unknown {
  return record[key];
}

function stringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function firstString(record: OfferRecord, keys: readonly string[], fallback = ""): string {
  for (const key of keys) {
    const value = stringValue(recordValue(record, key));
    if (value) return value;
  }
  return fallback;
}

function selectedValues(value: unknown, singular: unknown): readonly string[] {
  const values = Array.isArray(value) ? value : singular == null ? [] : [singular];
  return Array.from(new Set(values.map(stringValue).filter(Boolean)));
}

function canonicalTier(value: unknown): string {
  const text = stringValue(value);
  const lower = text.toLowerCase();
  if (lower === "black" || lower === "black tier") return "BLACK TIER";
  const match = lower.match(/tier\s*([1-4])/);
  return match?.[1] ? `Tier ${match[1]}` : text;
}

function normalizeText(value: unknown): string {
  return stringValue(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function cleanCategory(value: unknown): string {
  const text = stringValue(value);
  return text && text !== "Uncategorized" ? text : "";
}

function displayCategory(record: OfferRecord): string {
  return firstString(record, [
    "sheetCategory",
    "mainCategory",
    "feishuMainCategory",
    "category",
    "levantaCategory"
  ], "Uncategorized");
}

function dateOrdinal(value: unknown): number | null {
  const text = stringValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [yearText, monthText, dayText] = text.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return Math.floor(date.getTime() / 86400000);
}

export function validDateRange(startDate: unknown, endDate: unknown): boolean {
  const start = dateOrdinal(startDate);
  const end = dateOrdinal(endDate);
  return start !== null && end !== null && start <= end && end - start + 1 <= 366;
}

function normalizedRules(rules: OfferTrackerRules = DEFAULT_OFFER_TRACKER_RULES): OfferTrackerRules {
  return normalizeOfferTrackerRules(rules);
}

function offerTrackerCommissionRate(record: OfferRecord): number {
  return toNullableNumber(recordValue(record, "affCommissionRate")) ?? 0;
}

function offerTrackerRevenue(record: OfferRecord): number {
  return Math.max(0, toNullableNumber(recordValue(record, "salesAmount")) ?? 0);
}

function offerTrackerAov(record: OfferRecord): number {
  return toFiniteNumber(recordValue(record, "aov"));
}

function offerTrackerAovType(record: OfferRecord): OfferTrackerAovType {
  const type = stringValue(recordValue(record, "aovType")).toLowerCase();
  if (type === "actual") return "actual";
  if (["tentative", "estimated", "estimate"].includes(type)) return "estimated";
  return "unavailable";
}

function offerTrackerAsins(record: OfferRecord): readonly string[] {
  const values: unknown[] = [];
  const flatten = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(flatten);
      return;
    }
    values.push(value);
  };
  ["topAsins", "productAsins", "asinsText"].forEach((key) => flatten(recordValue(record, key)));
  const seen = new Set<string>();
  return values
    .flatMap((value) => stringValue(value).split(/[|,;\s]+/))
    .map((value) => value.toUpperCase())
    .filter((value) => {
      if (!/^B0[A-Z0-9]{8}$/.test(value) || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, 5);
}

function offerTrackerBbPolicy(record: OfferRecord): Exclude<OfferTrackerBbPolicy, "all"> {
  const brand = normalizeText(firstString(record, ["merchantName", "brand"]));
  const matches = (brands: readonly string[]): boolean => brands.some((candidate) => {
    const normalized = normalizeText(candidate);
    return brand === normalized || brand.startsWith(normalized) || brand.endsWith(normalized);
  });
  if (matches(MIND_BB_BRANDS)) return "mind";
  if (matches(OPEN_BB_BRANDS)) return "open";
  return "unknown";
}

function offerTrackerScore(record: OfferRecord, asins = offerTrackerAsins(record)): number {
  const tier = canonicalTier(recordValue(record, "tier"));
  const tierPoints = tier === "Tier 1" ? 4 : tier === "Tier 2" ? 3 : tier === "Tier 3" ? 2 : tier === "Tier 4" ? 1 : 0;
  const commission = offerTrackerCommissionRate(record);
  const commissionPoints = commission >= 20 ? 4 : commission >= 15 ? 3 : commission >= 10 ? 2 : commission >= 5 ? 1 : 0;
  const aov = offerTrackerAov(record);
  const aovPoints = aov >= 75 && aov <= 350 ? 2 : aov > 350 ? 1 : 0;
  return tierPoints + commissionPoints + aovPoints + (asins.length ? 1 : 0);
}

function offerTrackerPriorityFor(record: OfferRecord, rules: OfferTrackerRules): OfferTrackerPriority {
  const score = offerTrackerScore(record);
  const aov = offerTrackerAov(record);
  if (score >= rules.highScore) return { key: "high", score, order: 0 };
  if (aov > 0 && aov <= rules.lowAovMax) return { key: "low-aov", score, order: 2 };
  return { key: "recommended", score, order: 1 };
}

function merchantName(record: OfferRecord): string {
  return firstString(record, ["merchantName", "brand"], "Unnamed merchant");
}

function offerKey(record: OfferRecord): string {
  const id = stringValue(recordValue(record, "id"));
  if (id) return id;
  return `${stringValue(recordValue(record, "merchantId"))}::${normalizeText(recordValue(record, "brand"))}`;
}

function compareRows(a: OfferTrackerRow, b: OfferTrackerRow): number {
  return a.priority.order - b.priority.order
    || b.priority.score - a.priority.score
    || b.commissionRate - a.commissionRate
    || b.aov - a.aov
    || a.merchantName.localeCompare(b.merchantName);
}

export function normalizeOfferTrackerFilters(
  input: OfferTrackerFilterInput = {},
  defaultDateRange: OfferTrackerDateRange = DEFAULT_DATE_RANGE
): OfferTrackerFilters {
  const fallback = validDateRange(defaultDateRange.startDate, defaultDateRange.endDate)
    ? defaultDateRange
    : DEFAULT_DATE_RANGE;
  const requestedStart = stringValue(input.startDate);
  const requestedEnd = stringValue(input.endDate);
  const dateRange = validDateRange(requestedStart, requestedEnd)
    ? { startDate: requestedStart, endDate: requestedEnd }
    : fallback;
  const bbPolicies = selectedValues(input.bbPolicies, input.bbPolicy)
    .map(value => value.toLowerCase())
    .filter((value): value is Exclude<OfferTrackerBbPolicy, "all"> => ["mind", "open", "unknown"].includes(value));
  const revenueStatus: OfferTrackerRevenueStatus = input.revenueStatus === "positive" || input.revenueStatus === "none"
    ? input.revenueStatus
    : "all";
  const revenueSort: OfferTrackerRevenueSort = input.revenueSort === "revenue-desc" || input.revenueSort === "revenue-asc"
    ? input.revenueSort
    : "priority";
  return Object.freeze({
    tiers: selectedValues(input.tiers, input.tier).map(canonicalTier),
    categories: selectedValues(input.categories, input.category),
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    minAov: input.minAov == null ? "" : stringValue(input.minAov),
    maxAov: input.maxAov == null ? "" : stringValue(input.maxAov),
    minCommission: input.minCommission == null ? "" : stringValue(input.minCommission),
    maxCommission: input.maxCommission == null ? "" : stringValue(input.maxCommission),
    networks: selectedValues(input.networks, input.network),
    bbPolicies,
    revenueStatus,
    revenueSort
  });
}

export function normalizeOfferRecord(
  source: OfferRecord,
  rules: OfferTrackerRules = DEFAULT_OFFER_TRACKER_RULES
): OfferTrackerRow {
  const normalizedRules = normalizedRulesForRow(rules);
  const asins = offerTrackerAsins(source);
  const priority = offerTrackerPriorityFor(source, normalizedRules);
  return Object.freeze({
    key: offerKey(source),
    source,
    merchantId: stringValue(recordValue(source, "merchantId")),
    merchantName: merchantName(source),
    tier: canonicalTier(recordValue(source, "tier")),
    network: stringValue(recordValue(source, "network")),
    category: displayCategory(source),
    commissionRate: offerTrackerCommissionRate(source),
    aov: offerTrackerAov(source),
    aovType: offerTrackerAovType(source),
    revenue: offerTrackerRevenue(source),
    bbPolicy: offerTrackerBbPolicy(source),
    asins,
    score: priority.score,
    priority
  });
}

function normalizedRulesForRow(rules: OfferTrackerRules): OfferTrackerRules {
  return normalizedRules(rules);
}

function matchesSearch(row: OfferTrackerRow, search: string): boolean {
  const query = stringValue(search).toLowerCase();
  if (!query) return true;
  return [row.merchantName, row.source.brand, row.merchantId, row.tier, row.network, row.category]
    .map(stringValue)
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

export function filterOfferTrackerRows(
  sourceRows: readonly OfferRecord[],
  filters: OfferTrackerFilters,
  search = "",
  rules: OfferTrackerRules = DEFAULT_OFFER_TRACKER_RULES
): readonly OfferTrackerRow[] {
  const normalizedRules = normalizedRulesForRow(rules);
  const minAov = toNullableNumber(filters.minAov);
  const maxAov = toNullableNumber(filters.maxAov);
  const minCommission = toNullableNumber(filters.minCommission);
  const maxCommission = toNullableNumber(filters.maxCommission);
  const selectedTiers = new Set(filters.tiers.map(canonicalTier));
  const selectedCategories = new Set(filters.categories.map(stringValue));
  const selectedNetworks = new Set(filters.networks.map(stringValue));
  const rows = sourceRows
    .map((source) => normalizeOfferRecord(source, normalizedRules))
    .filter((row) => {
      if (selectedTiers.size && !selectedTiers.has(row.tier)) return false;
      if (selectedCategories.size && !selectedCategories.has(row.category)) return false;
      if (selectedNetworks.size && !selectedNetworks.has(row.network)) return false;
      if (filters.bbPolicies.length && !filters.bbPolicies.includes(row.bbPolicy)) return false;
      if (minAov !== null && row.aov < minAov) return false;
      if (maxAov !== null && row.aov > maxAov) return false;
      if (minCommission !== null && row.commissionRate < minCommission) return false;
      if (maxCommission !== null && row.commissionRate > maxCommission) return false;
      if (filters.revenueStatus === "positive" && row.revenue <= 0) return false;
      if (filters.revenueStatus === "none" && row.revenue > 0) return false;
      return matchesSearch(row, search);
    });
  return [...rows].sort((a, b) => {
    if (filters.revenueSort === "revenue-desc" || filters.revenueSort === "revenue-asc") {
      const difference = b.revenue - a.revenue;
      if (difference) return filters.revenueSort === "revenue-desc" ? difference : -difference;
    }
    return compareRows(a, b);
  });
}

export function paginateOfferTrackerRows(
  rows: readonly OfferTrackerRow[],
  page: number,
  pageSize: number
): OfferTrackerPage {
  const safePageSize = Math.max(1, Math.floor(toFiniteNumber(pageSize, 25)));
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
  const safePage = Math.min(Math.max(1, Math.floor(toFiniteNumber(page, 1))), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    rows: rows.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    totalRows,
    totalPages
  };
}

export function updateOfferTrackerSelection(
  rows: readonly OfferTrackerRow[],
  selected: boolean,
  selectedKeys: ReadonlySet<string>
): ReadonlySet<string> {
  const nextKeys = new Set(selectedKeys);
  rows.forEach((row) => {
    if (selected) nextKeys.add(row.key);
    else nextKeys.delete(row.key);
  });
  return nextKeys;
}

export function offerTrackerSelectionSummary(
  rows: readonly OfferTrackerRow[],
  pageRows: readonly OfferTrackerRow[],
  selectedKeys: ReadonlySet<string>
): OfferTrackerSelectionSummary {
  const selectedCount = rows.reduce((count, row) => count + (selectedKeys.has(row.key) ? 1 : 0), 0);
  const currentPageSelectedCount = pageRows.reduce(
    (count, row) => count + (selectedKeys.has(row.key) ? 1 : 0),
    0
  );
  return {
    selectedCount,
    currentPageSelectedCount,
    allFilteredSelected: rows.length > 0 && selectedCount === rows.length,
    allPageSelected: pageRows.length > 0 && currentPageSelectedCount === pageRows.length
  };
}

export function offerTrackerExportRows(
  rows: readonly OfferTrackerRow[],
  selectedKeys: ReadonlySet<string>,
  selectedOnly: boolean
): readonly OfferRecord[] {
  return rows
    .filter((row) => !selectedOnly || selectedKeys.has(row.key))
    .map((row) => row.source);
}

export function offerTrackerExportColumns(view: OfferTrackerView): readonly OfferTrackerExportColumn[] {
  return view === "products" ? PRODUCT_COLUMNS : OFFER_COLUMNS;
}

export function priorityLabel(key: OfferTrackerPriorityKey, language: "zh" | "en" = "zh"): string {
  const fallback: Record<OfferTrackerPriorityKey, string> = {
    high: "高优先级 Offer",
    recommended: "推荐 Offer",
    "low-aov": "低 AOV 优选"
  };
  const messageKey = key === "low-aov"
    ? "offerTracker.priority.lowAov"
    : `offerTracker.priority.${key}`;
  return translateMessage(language, messageKey, fallback[key]);
}

export function aovTypeLabel(type: OfferTrackerAovType, language: "zh" | "en" = "zh"): string {
  const fallback: Record<OfferTrackerAovType, string> = {
    actual: "真实",
    estimated: "预估",
    unavailable: "无可用数据"
  };
  return translateMessage(language, `offerTracker.aovType.${type}`, fallback[type]);
}

export function bbPolicyLabel(policy: Exclude<OfferTrackerBbPolicy, "all">, language: "zh" | "en" = "zh"): string {
  const fallback: Record<Exclude<OfferTrackerBbPolicy, "all">, string> = {
    mind: "介意 BB",
    open: "不介意 BB",
    unknown: "未知"
  };
  return translateMessage(language, `offerTracker.bbPolicy.${policy}`, fallback[policy]);
}

export function offerTrackerTierValues(rows: readonly OfferTrackerRow[]): readonly string[] {
  const values = new Set(rows.map((row) => row.tier).filter(Boolean));
  return OFFER_TRACKER_TIERS.filter((tier) => values.has(tier));
}

export function offerTrackerCategoryValues(rows: readonly OfferTrackerRow[]): readonly string[] {
  return Array.from(new Set(rows.map((row) => cleanCategory(row.category)).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function offerTrackerNetworkValues(rows: readonly OfferTrackerRow[]): readonly string[] {
  return Array.from(new Set(rows.map((row) => row.network).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}
