<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import DatePicker from "../../shared/components/DatePicker.vue";
import { publisherDonutPath, publisherOverviewColor } from "./publisherPresentation";
import type { I18nMessageValues, UiLanguage } from "../../shared/i18n";
import { translateMessage } from "../../shared/i18n";
import {
  DEFAULT_PUBLISHER_FILTERS,
  PUBLISHER_KPI_DEFINITIONS,
  PUBLISHER_TABLE_COLUMNS,
  aggregatePublisherMetrics,
  applyDateFilter,
  filteredPublishers,
  paginate,
  publisherAffinitySummary,
  publisherAssociationSummary,
  publisherManagerMatches,
  publisherMerchantOptions,
  publisherMetricAffCommission,
  publisherMetricAffCommissionRate,
  publisherMetricAffEpc,
  publisherMetricAov,
  publisherMetricConversionRate,
  publisherMetricForMarket,
  publisherMetricIsActive,
  publisherOverviewRows,
  publisherQuickDateRange,
  publisherTableRows,
  publisherTierOptions,
  portfolioRowsForState,
  publishersForManager,
  type PublisherAggregate,
  type PublisherExportPayload,
  type PublisherFilters,
  type PublisherMetric,
  type PublisherMetricKey,
  type PublisherOverviewRow,
  type PublisherPortfolioRow,
  type PublisherRecord,
  type PublisherSort,
  type PublisherTableRow,
  type PublisherTableSortKey
} from "./publisherModel";
import { usePublishers, type PublisherLoader, type PublisherPortfolioLoader } from "./usePublishers";

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly loadData: PublisherLoader;
  readonly loadPortfolio?: PublisherPortfolioLoader;
  readonly download?: (payload: PublisherExportPayload) => void;
  readonly autoLoad?: boolean;
}>(), {
  loadPortfolio: undefined,
  download: undefined,
  autoLoad: true
});

const publishers = usePublishers({ loadData: props.loadData, loadPortfolio: props.loadPortfolio });
const filters = publishers.filters;
const layout = publishers.layout;
const layoutEditing = publishers.layoutEditing;
const loading = publishers.loading;
const loadError = publishers.error;
const portfolioLoading = publishers.portfolioLoading;
const portfolioError = publishers.portfolioError;
const publisherQuery = ref("");
const publisherSelectorOpen = ref(false);
const merchantDropdownOpen = ref(false);
const managerDropdownOpen = ref(false);
const columnsOpen = ref(false);
const highlightedOverviewKey = ref("");
const draggingSection = ref("");
const draggedSectionIndex = ref(-1);
const visibleColumnKeys = ref<readonly PublisherTableSortKey[]>(PUBLISHER_TABLE_COLUMNS.map((column) => column.key));
const startDraft = ref(filters.value.startDate);
const endDraft = ref(filters.value.endDate);
const dateError = ref("");
watch(() => [filters.value.startDate, filters.value.endDate], ([start, end]) => { startDraft.value = start || ""; endDraft.value = end || ""; dateError.value = ""; });

const sort = ref<PublisherSort>({ key: "", direction: "asc" });
const tablePageSize = 100;

const copy = computed(() => ({
  title: message("publishers.title", "Publisher Affinity"),
  subtitle: message("publishers.subtitle", "Understand which merchants, categories, order values and commissions each publisher prefers."),
  customize: message("publishers.customizeLayout", "Customize layout"),
  editing: message("publishers.editing", "Editing layout"),
  layoutHint: message("publishers.layoutHint", "Drag the handle on the left to reorder sections"),
  resetLayout: message("publishers.resetLayout", "Reset layout"),
  cancel: message("publishers.cancel", "Cancel"),
  save: message("publishers.save", "Done"),
  selectPublisher: message("publishers.selectPublisher", "选择要分析的媒体"),
  selectPublisherHint: message("publishers.selectPublisherHint", "输入媒体名称或 ID，查看其合作商家与偏好。"),
  publisher: message("publishers.publisher", "Publisher"),
  period: message("publishers.period", "Period"),
  market: message("publishers.market", "Market"),
  network: message("publishers.network", "Affiliate Network"),
  linkType: message("publishers.linkType", "Link Type"),
  merchant: message("publishers.merchant", "Merchant"),
  manager: message("publishers.manager", "Manager"),
  apply: message("common.apply", "Apply filters"),
  reset: message("common.reset", "Reset"),
  export: message("publishers.export", "Export"),
  exportPage: message("publishers.exportPage", "Export current page"),
  exportAll: message("publishers.exportAll", "Export all"),
  allMarkets: message("publishers.allMarkets", "All markets"),
  allNetworks: message("publishers.allNetworks", "All networks"),
  allLinkTypes: message("publishers.allLinkTypes", "All link types"),
  merchantPlaceholder: message("publishers.merchantPlaceholder", "商家名称或 ID"),
  managerPlaceholder: message("publishers.managerPlaceholder", "经理名称"),
  publisherPlaceholder: message("publishers.publisherPlaceholder", "媒体名称或 ID"),
  noPublisherMatch: message("publishers.noPublisherMatch", "No matching publisher"),
  noMerchantMatch: message("publishers.merchantNoMatch", "No matching merchant"),
  affinityEmptyTitle: message("publishers.affinityEmptyTitle", "选择媒体后生成倾向画像"),
  affinityEmptyBody: message("publishers.affinityEmptyBody", "系统会按该媒体实际合作的商家，计算品类贡献、AOV 区间与佣金偏好。"),
  backToAll: message("publishers.backToAll", "返回全部媒体"),
  categoryAffinity: message("publishers.categoryAffinity", "品类倾向"),
  bySales: message("publishers.bySales", "按销售额贡献"),
  affinitySignals: message("publishers.affinitySignals", "倾向信号"),
  signalHint: message("publishers.signalHint", "用于判断合作偏好"),
  merchantPortfolio: message("publishers.merchantPortfolio", "合作商家组合"),
  conversion: message("publishers.conversion", "Conversion"),
  commissionRate: message("publishers.commissionRate", "AFF commission rate"),
  orders: message("publishers.orders", "Orders"),
  sales: message("publishers.sales", "Sales"),
  earnedCommission: message("publishers.earnedCommission", "AFF earned commission"),
  portfolioShare: message("publishers.portfolioShare", "Sales share"),
  portfolioMethod: message("publishers.portfolioMethod", "AOV = Sales ÷ Orders; AFF EPC = Sales × AFF commission rate ÷ Clicks; Conversion = Orders ÷ Clicks. AFF earned commission = ALL earned commission × 75%; AFF commission rate = AFF earned commission ÷ Sales."),
  activeMerchants: message("publishers.activeMerchants", "Active merchants"),
  inCurrentView: message("publishers.inCurrentView", "in current view"),
  topCategory: message("publishers.topCategory", "Top category"),
  ofSales: message("publishers.ofSales", "of sales"),
  weightedCommission: message("publishers.weightedCommission", "AFF weighted commission rate"),
  weightedBySales: message("publishers.weightedBySales", "weighted by merchant sales"),
  typicalAovBand: message("publishers.typicalAovBand", "Typical AOV band"),
  categoryConcentration: message("publishers.categoryConcentration", "Category concentration"),
  commissionProfile: message("publishers.commissionProfile", "AFF commission profile"),
  effectiveEarned: message("publishers.effectiveEarned", "effective AFF rate"),
  marketReach: message("publishers.marketReach", "Market reach"),
  leadsWith: message("publishers.leadsWith", "Leads with"),
  merchantsInView: message("publishers.merchantsInView", "merchants in view"),
  portfolioLoading: message("publishers.portfolioLoading", "Loading merchant-level activity for the selected period…"),
  portfolioError: message("publishers.portfolioError", "Could not load merchant-level activity"),
  noPortfolioRows: message("publishers.noPortfolioRows", "No merchants match the current filters"),
  loading: message("publishers.loading", "Loading…"),
  error: message("publishers.error", "Error"),
  empty: message("publishers.empty", "No data"),
  marketSummary: message("publishers.marketSummary", "Overview"),
  publisherCount: message("publishers.publisherCount", "Publishers"),
  commission: message("publishers.commission", "Commission"),
  total: message("publishers.total", "Total"),
  tableTitle: message("publishers.tableTitle", "Publisher Records"),
  columnsButton: message("publishers.columnsButton", "Display"),
  columnsTitle: message("publishers.columnsTitle", "Display columns"),
  columnsHint: message("publishers.columnsHint", "Choose fields to display"),
  coreColumns: message("publishers.coreColumns", "Default"),
  allColumns: message("publishers.allColumns", "All"),
  previous: message("publishers.previous", "Previous"),
  next: message("publishers.next", "Next"),
  noActivity: message("publishers.noActivity", "No activity"),
  merchants: message("publishers.merchants", "merchants")
}));

function message(key: string, fallback: string, values: I18nMessageValues = {}): string {
  return translateMessage(props.language, key, fallback, values);
}

const effectivePayload = computed(() => applyDateFilter(
  publishers.payload.value,
  filters.value.startDate,
  filters.value.endDate
));

const filteredRows = computed(() => filteredPublishers(effectivePayload.value, filters.value));
const selectedPublisher = computed<PublisherRecord | null>(() => {
  const selectedId = filters.value.selectedId;
  return effectivePayload.value.publishers.find((publisher) => publisher.userId === selectedId)
    || publishers.payload.value.publishers.find((publisher) => publisher.userId === selectedId)
    || null;
});
const selectedProfile = computed(() => Boolean(selectedPublisher.value));
const aggregate = computed<PublisherAggregate>(() => aggregatePublisherMetrics(filteredRows.value, filters.value.market));
const isDateFiltered = computed(() => Boolean(filters.value.startDate || filters.value.endDate));

const managerOptions = computed(() => {
  const counts = new Map<string, number>();
  publishers.payload.value.publishers.forEach((publisher) => {
    const name = publisher.adminName || "Unknown";
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((left, right) => {
    if (left.name === "Unknown") return 1;
    if (right.name === "Unknown") return -1;
    return left.name.localeCompare(right.name);
  });
});

const visibleManagerOptions = computed(() => {
  const query = filters.value.managerSearch.toLowerCase().trim();
  return managerOptions.value.filter((option) => !query || option.name.toLowerCase().includes(query));
});

const publisherOptions = computed(() => {
  const query = publisherQuery.value.toLowerCase().trim();
  return publishersForManager(effectivePayload.value.publishers, filters.value.managerSearch)
    .filter((publisher) => !query || publisher.userName.toLowerCase().includes(query) || publisher.userId.includes(query) || publisher.adminName.toLowerCase().includes(query))
    .slice(0, 60);
});

const merchantOptions = computed(() => {
  const query = filters.value.merchantSearch.toLowerCase().trim();
  return publisherMerchantOptions(effectivePayload.value).filter((merchant) => {
    return !query || merchant.name.toLowerCase().includes(query) || merchant.merchantId.toLowerCase().includes(query);
  }).slice(0, 60);
});

type ComboKind = "publisher" | "merchant" | "manager";
const comboIndex = ref<Record<ComboKind, number>>({ publisher: -1, merchant: -1, manager: -1 });
const comboOpen = { publisher: publisherSelectorOpen, merchant: merchantDropdownOpen, manager: managerDropdownOpen };
function comboId(kind: ComboKind, index: number): string { return `publisher-${kind}-option-${index}`; }
function closeCombo(kind: ComboKind): void { comboOpen[kind].value = false; comboIndex.value[kind] = -1; }
function comboKey(event: KeyboardEvent, kind: ComboKind): void {
  const options = kind === "publisher" ? publisherOptions.value : kind === "merchant" ? merchantOptions.value : visibleManagerOptions.value;
  if (event.key === "Escape" || event.key === "Tab") { closeCombo(kind); return; }
  if (event.key === "Enter" && comboOpen[kind].value && comboIndex.value[kind] >= 0) {
    event.preventDefault();
    const index = comboIndex.value[kind];
    if (kind === "publisher" && publisherOptions.value[index]) selectPublisher(publisherOptions.value[index]!);
    if (kind === "merchant" && merchantOptions.value[index]) { const option = merchantOptions.value[index]!; selectMerchant(option.merchantId, option.name); }
    if (kind === "manager" && visibleManagerOptions.value[index]) selectManager(visibleManagerOptions.value[index]!.name);
    closeCombo(kind);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  comboOpen[kind].value = true;
  if (!options.length) return;
  comboIndex.value[kind] = comboIndex.value[kind] < 0
    ? (event.key === "ArrowDown" ? 0 : options.length - 1)
    : (comboIndex.value[kind] + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
  void nextTick(() => document.getElementById(comboId(kind, comboIndex.value[kind]))?.scrollIntoView?.({ block: "nearest" }));
}
watch([publisherOptions, merchantOptions, visibleManagerOptions], () => { comboIndex.value = { publisher: -1, merchant: -1, manager: -1 }; });

const association = computed(() => publisherAssociationSummary(
  effectivePayload.value,
  filteredRows.value,
  filters.value.merchantSearch,
  filters.value.merchantSelectedId
));
const associationPublishers = computed(() => [...association.value.publishers].sort((left, right) => right.total.sales - left.total.sales).slice(0, 8));
const associationRemaining = computed(() => Math.max(0, association.value.publisherCount - associationPublishers.value.length));

const profileMerchants = computed(() => publishers.portfolio.value?.merchants || []);
const profileAllRows = computed<readonly PublisherPortfolioRow[]>(() => portfolioRowsForState(profileMerchants.value, filters.value, false));
const profileRows = computed<readonly PublisherPortfolioRow[]>(() => portfolioRowsForState(profileMerchants.value, filters.value, true));
const profileSummary = computed(() => publisherAffinitySummary(profileAllRows.value, filters.value.market));
type PublisherKpiAggregate = Pick<PublisherAggregate, PublisherMetricKey>;
const profileKpiAggregate = computed<PublisherKpiAggregate>(() => ({
  clicks: profileSummary.value.clicks,
  dpv: profileSummary.value.dpv,
  atc: profileSummary.value.atc,
  orders: profileSummary.value.orders,
  sales: profileSummary.value.sales,
  allCommission: profileSummary.value.allCommission
}));
const kpiAggregate = computed<PublisherKpiAggregate>(() => selectedProfile.value && publishers.portfolio.value
  ? profileKpiAggregate.value
  : aggregate.value);
const profileCategories = computed(() => [...new Set(profileAllRows.value.map((row) => row.merchant.category || "Uncategorized"))].sort());
const profileTiers = computed(() => publisherTierOptions(profileAllRows.value, filters.value.portfolioTier));
const portfolioStatus = computed(() => {
  if (publishers.portfolioError.value) return `${copy.value.portfolioError}: ${publishers.portfolioError.value}`;
  return publishers.portfolioLoading.value ? copy.value.portfolioLoading : "";
});

const overviewAllRows = computed(() => publisherOverviewRows(filteredRows.value, filters.value.overviewType, filters.value.chartMetric));
const overviewRows = computed(() => filters.value.overviewFocus
  ? overviewAllRows.value.filter((row) => row.key === filters.value.overviewFocus)
  : overviewAllRows.value);
const overviewTotal = computed(() => overviewRows.value.reduce((sum, row) => sum + row.value, 0));
const overviewTotals = computed(() => overviewRows.value.reduce((totals, row) => ({
  clicks: totals.clicks + row.clicks,
  orders: totals.orders + row.orders,
  allCommission: totals.allCommission + row.allCommission
}), { clicks: 0, orders: 0, allCommission: 0 }));
const overviewColor = (row: PublisherOverviewRow): string => publisherOverviewColor(filters.value.overviewType, row.key);
const overviewSegments = computed(() => {
  const total = overviewTotal.value || 1;
  let current = 0;
  return overviewRows.value.filter((row) => row.value > 0).map((row) => {
    const fraction = row.value / total;
    const segment = { ...row, color: overviewColor(row), path: publisherDonutPath(current, fraction), percentage: fraction * 100 };
    current += fraction;
    return segment;
  });
});

const chartRows = computed(() => [...filteredRows.value].sort((left, right) => {
  const leftMetric = filters.value.market !== "all" ? left.markets[filters.value.market] : left.total;
  const rightMetric = filters.value.market !== "all" ? right.markets[filters.value.market] : right.total;
  return (rightMetric?.[filters.value.chartMetric] || 0) - (leftMetric?.[filters.value.chartMetric] || 0);
}).slice(0, 15));
const chartMax = computed(() => {
  const first = chartRows.value[0];
  if (!first) return 1;
  const metric = filters.value.market !== "all" ? first.markets[filters.value.market] : first.total;
  return Math.max(1, metric?.[filters.value.chartMetric] || 0);
});

function chartMetricValue(publisher: PublisherRecord): number {
  const metric = filters.value.market !== "all" ? publisher.markets[filters.value.market] : publisher.total;
  return metric?.[filters.value.chartMetric] || 0;
}

function chartBarWidth(publisher: PublisherRecord): string {
  return `${Math.max(2, Number((chartMetricValue(publisher) / chartMax.value * 100).toFixed(1)))}%`;
}

function chartValueLabel(publisher: PublisherRecord): string {
  const value = chartMetricValue(publisher);
  return value / chartMax.value * 100 > 5 ? formatMetric(value, filters.value.chartMetric) : "";
}

function metricLabel(key: string, fallback = key): string {
  return message(`publishers.${key}`, fallback);
}

function chartMetricLabel(): string {
  return metricLabel(filters.value.chartMetric);
}

const allTableRows = computed(() => publisherTableRows(filteredRows.value, filters.value.market, aggregate.value, sort.value));
const tablePagination = computed(() => paginate(allTableRows.value, filters.value.tablePage, tablePageSize));
const totalTableRow = computed<PublisherTableRow>(() => ({
  rank: 0,
  userId: "",
  userName: "Total",
  adminName: "",
  clicks: aggregate.value.clicks,
  conversionRate: aggregate.value.conversionRate,
  dpv: aggregate.value.dpv,
  atc: aggregate.value.atc,
  orders: aggregate.value.orders,
  sales: aggregate.value.sales,
  allCommission: aggregate.value.allCommission,
  affCommission: aggregate.value.affCommission,
  grossProfit: aggregate.value.grossProfit
}));
const displayTableRows = computed(() => [totalTableRow.value, ...tablePagination.value.rows]);
const displayColumns = computed(() => PUBLISHER_TABLE_COLUMNS.filter((column) => visibleColumnKeys.value.includes(column.key)));

function formatNumber(value: unknown, maximumFractionDigits = 0): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-US", { maximumFractionDigits }) : "-";
}

function formatMoney(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "-";
}

function formatCompactNumber(value: unknown): string {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1_000_000) return `${(numeric / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (Math.abs(numeric) >= 1_000) return `${(numeric / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return formatNumber(numeric);
}

function formatCompactMoney(value: unknown): string {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1_000_000) return `$${(numeric / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 })}M`;
  if (Math.abs(numeric) >= 1_000) return `$${(numeric / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}K`;
  return formatMoney(numeric);
}

function formatMetric(value: unknown, metric: PublisherMetricKey): string {
  return metric === "sales" || metric === "allCommission" ? formatCompactMoney(value) : formatCompactNumber(value);
}

function formatFullMetric(value: unknown, metric: PublisherMetricKey): string {
  return metric === "sales" || metric === "allCommission" ? formatMoney(value) : formatNumber(value);
}

function formatPercent(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : "-";
}

function formatRate(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "N/A" : `${value.toFixed(2)}%`;
}

function formatEpc(value: number): string {
  return Number.isFinite(value) ? `$${value.toFixed(3)}` : "-";
}

function formatAov(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "N/A" : formatMoney(value);
}

function portfolioMetric(row: PublisherPortfolioRow): PublisherMetric {
  return row.metrics;
}

function profileMarketText(row: PublisherPortfolioRow): string {
  const names = Object.keys(row.merchant.markets);
  const visible = filters.value.market !== "all" ? names.filter((market) => market === filters.value.market) : names;
  const result = visible.slice(0, 2).join(" · ");
  return visible.length > 2 ? `${result} +${visible.length - 2}` : result || "Unknown";
}

function tierTone(tier: string): string {
  const match = /^Tier ([1-4])$/.exec(tier);
  if (tier === "BLACK TIER") return "black";
  return match ? `tier-${match[1]}` : "unknown";
}

function setFilters(patch: Partial<PublisherFilters>, resetPage = true): void {
  publishers.setFilters(resetPage ? { ...patch, tablePage: 1 } : patch);
}

function setMarket(value: string): void { setFilters({ market: value || "all", overviewFocus: "" }); }
function setNetwork(value: string): void { setFilters({ network: value || "all", overviewFocus: "" }); }
function setLinkType(value: string): void { setFilters({ linkType: value || "all" }); }

function setMerchantSearch(value: string): void {
  setFilters({ merchantSearch: value, merchantSelectedId: "" });
  merchantDropdownOpen.value = true;
}

function selectMerchant(merchantId: string, name: string): void {
  setFilters({ merchantSearch: name, merchantSelectedId: merchantId });
  merchantDropdownOpen.value = false;
}

function setManagerSearch(value: string): void {
  setFilters({ managerSearch: value, selectedId: "" });
  managerDropdownOpen.value = true;
  publisherSelectorOpen.value = true;
}

function selectManager(name: string): void {
  setFilters({ managerSearch: name, selectedId: "" });
  managerDropdownOpen.value = false;
}

function setPublisherSearch(value: string): void {
  publisherQuery.value = value;
  if (selectedPublisher.value && value !== selectedPublisher.value.userName) setFilters({ selectedId: "" });
  publisherSelectorOpen.value = true;
}

function selectPublisher(publisher: PublisherRecord): void {
  publisherQuery.value = publisher.userName;
  setFilters({ selectedId: publisher.userId, portfolioSearch: "", portfolioCategory: "all", portfolioTier: "all", portfolioSort: "sales" });
  publisherSelectorOpen.value = false;
}

function clearPublisherSelection(): void {
  publisherQuery.value = "";
  publishers.portfolio.value = null;
  setFilters({ selectedId: "", portfolioSearch: "", portfolioCategory: "all", portfolioTier: "all", portfolioSort: "sales" });
}

function resetFilters(): void {
  publisherQuery.value = "";
  startDraft.value = ""; endDraft.value = ""; dateError.value = "";
  publishers.portfolio.value = null;
  setFilters({ ...DEFAULT_PUBLISHER_FILTERS });
}

function applyFilters(): void {
  const valid = (value: string) => {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00`);
    const [year, month, day] = value.split("-").map(Number);
    return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
  };
  dateError.value = !valid(startDraft.value) || !valid(endDraft.value) ? "invalidDate" : startDraft.value && endDraft.value && startDraft.value > endDraft.value ? "reversedDate" : "";
  if (dateError.value) return;
  setFilters({ startDate: startDraft.value, endDate: endDraft.value, tablePage: 1 }, false);
}

function applyQuickDate(range: "lastMonth" | "past30" | "past3m" | "past6m"): void {
  const dates = publisherQuickDateRange(range);
  startDraft.value = dates.startDate;
  endDraft.value = dates.endDate;
  dateError.value = "";
}

function setPortfolioFilter(key: "portfolioSearch" | "portfolioCategory" | "portfolioTier" | "portfolioSort", value: string): void {
  setFilters({ [key]: value } as Partial<PublisherFilters>);
}

function chooseChartMetric(metric: PublisherMetricKey): void {
  setFilters({ chartMetric: metric });
}

function toggleOverview(): void {
  setFilters({ overviewExpanded: !filters.value.overviewExpanded }, false);
}

function toggleChart(): void {
  setFilters({ chartExpanded: !filters.value.chartExpanded }, false);
}

function focusOverview(row: PublisherOverviewRow): void {
  const isNetwork = filters.value.overviewType === "network";
  const currentFilter = isNetwork ? filters.value.network : filters.value.market;
  if (filters.value.overviewFocus === row.key || currentFilter === row.key) {
    setFilters({ [isNetwork ? "network" : "market"]: "all", overviewFocus: "" } as Partial<PublisherFilters>);
    return;
  }
  setFilters({ [isNetwork ? "network" : "market"]: row.key, overviewFocus: row.key } as Partial<PublisherFilters>);
}

function clearOverviewFocus(): void {
  setFilters({ network: filters.value.overviewType === "network" ? "all" : filters.value.network, market: filters.value.overviewType === "market" ? "all" : filters.value.market, overviewFocus: "" });
}

function setOverviewType(value: "market" | "network"): void {
  setFilters({ overviewType: value, overviewFocus: "" });
}

function changeSort(key: PublisherTableSortKey): void {
  const direction = sort.value.key === key ? (sort.value.direction === "asc" ? "desc" : "asc") : (key === "userName" || key === "adminName" || key === "userId" ? "asc" : "desc");
  sort.value = { key, direction };
}

function pageChange(delta: number): void {
  const next = Math.min(tablePagination.value.totalPages, Math.max(1, tablePagination.value.page + delta));
  setFilters({ tablePage: next }, false);
}

function tableCell(row: PublisherTableRow, key: PublisherTableSortKey): string {
  switch (key) {
    case "rank": return row.rank ? String(row.rank) : "";
    case "userId": return row.userId;
    case "userName": return !row.userId && row.userName === "Total" ? copy.value.total : row.userName;
    case "adminName": return row.adminName || (row.userName === "Total" ? "" : "Unknown");
    case "clicks": return formatNumber(row.clicks);
    case "conversionRate": return formatPercent(row.conversionRate);
    case "dpv": return formatNumber(row.dpv);
    case "atc": return formatNumber(row.atc);
    case "orders": return formatNumber(row.orders);
    case "sales": return formatMoney(row.sales);
    case "allCommission": return formatMoney(row.allCommission);
    case "affCommission": return formatMoney(row.affCommission);
    case "grossProfit": return formatMoney(row.grossProfit);
  }
  return "";
}

function ariaSort(key: PublisherTableSortKey): "ascending" | "descending" | "none" {
  if (sort.value.key !== key) return "none";
  return sort.value.direction === "desc" ? "descending" : "ascending";
}

function toggleColumn(key: PublisherTableSortKey): void {
  const next = visibleColumnKeys.value.includes(key)
    ? visibleColumnKeys.value.filter((candidate) => candidate !== key)
    : [...visibleColumnKeys.value, key];
  if (next.length) visibleColumnKeys.value = next;
}

function setCoreColumns(): void {
  visibleColumnKeys.value = ["rank", "userId", "userName", "adminName", "clicks", "conversionRate", "orders", "sales", "allCommission", "grossProfit"];
}

function setAllColumns(): void {
  visibleColumnKeys.value = PUBLISHER_TABLE_COLUMNS.map((column) => column.key);
}

function tableExportRow(row: PublisherTableRow): Readonly<Record<string, unknown>> {
  return {
    Rank: row.rank,
    "Publisher ID": row.userId,
    "Publisher Name": row.userName,
    Manager: row.adminName,
    Clicks: row.clicks,
    CVR: row.conversionRate,
    DPV: row.dpv,
    ATC: row.atc,
    Orders: row.orders,
    Sales: row.sales,
    "All Commission": row.allCommission,
    "Aff Commission": row.affCommission,
    "Gross Profit": row.grossProfit
  };
}

function portfolioExportRow(row: PublisherPortfolioRow, summarySales: number): Readonly<Record<string, unknown>> {
  const metric = row.metrics;
  return {
    Merchant: row.merchant.merchantName,
    "Merchant ID": row.merchant.merchantId,
    Network: row.merchant.network,
    Market: profileMarketText(row),
    Category: row.merchant.category,
    Tier: row.merchant.tier,
    AOV: publisherMetricAov(metric),
    "AFF EPC": publisherMetricAffEpc(metric),
    Conversion: publisherMetricConversionRate(metric),
    "AFF Commission Rate": publisherMetricAffCommissionRate(metric),
    Orders: metric.orders,
    Sales: metric.sales,
    "AFF Earned Commission": publisherMetricAffCommission(metric) || 0,
    "Sales Share": summarySales > 0 ? metric.sales / summarySales : 0
  };
}

function emitExport(scope: "page" | "all"): void {
  if (!props.download) return;
  if (selectedProfile.value) {
    const rows = scope === "page" ? profileRows.value : profileRows.value;
    if (!rows.length) return;
    props.download({ scope: "portfolio", rows: rows.map((row) => portfolioExportRow(row, profileSummary.value.sales)), filters: filters.value, publisherId: selectedPublisher.value?.userId });
    return;
  }
  const rows = scope === "page" ? tablePagination.value.rows : allTableRows.value;
  if (!rows.length) return;
  props.download({ scope, rows: rows.map(tableExportRow), filters: filters.value });
}

function moveSection(index: number, direction: number): void {
  const next = [...layout.value];
  const target = index + direction;
  if (target < 0 || target >= next.length) return;
  [next[index], next[target]] = [next[target]!, next[index]!];
  publishers.setLayout(next);
}

function layoutDragStart(section: string, index: number): void {
  if (!layoutEditing.value) return;
  draggingSection.value = section;
  draggedSectionIndex.value = index;
}

function layoutDrop(index: number): void {
  if (!draggingSection.value || draggedSectionIndex.value < 0 || draggedSectionIndex.value === index) return;
  const next = [...layout.value];
  const [moved] = next.splice(draggedSectionIndex.value, 1);
  if (!moved) return;
  next.splice(index, 0, moved);
  publishers.setLayout(next);
  draggingSection.value = "";
  draggedSectionIndex.value = -1;
}

function layoutDragEnd(): void {
  draggingSection.value = "";
  draggedSectionIndex.value = -1;
}

function layoutSectionClass(section: string): Record<string, boolean> {
  return { "layout-dragging": draggingSection.value === section, "layout-drag-target": Boolean(draggingSection.value) && draggingSection.value !== section };
}

function publisherMerchantCount(publisher: PublisherRecord): number {
  return publisher.merchantIds.length;
}

function formatOverviewMetric(row: PublisherOverviewRow): string {
  return formatMetric(row.value, filters.value.chartMetric);
}

function highlightOverview(key: string): void { highlightedOverviewKey.value = key; }
function clearHighlight(): void { highlightedOverviewKey.value = ""; }

async function load(): Promise<void> {
  await publishers.load();
}

watch(selectedPublisher, (publisher) => {
  publisherQuery.value = publisher?.userName || "";
}, { immediate: true });

watch(() => [filters.value.selectedId, filters.value.managerSearch] as const, ([selectedId, managerSearch]) => {
  if (!selectedId) return;
  const publisher = publishers.payload.value.publishers.find((row) => row.userId === selectedId);
  if (!publisher || !publisherManagerMatches(publisher, managerSearch)) clearPublisherSelection();
});

watch(() => [filters.value.selectedId, filters.value.startDate, filters.value.endDate] as const, ([selectedId, startDate, endDate]) => {
  if (!selectedId) {
    publishers.portfolio.value = null;
    return;
  }
  void publishers.requestPortfolio(selectedId, startDate, endDate);
}, { immediate: true });

onMounted(() => {
  if (props.autoLoad) void load();
  const closeDropdowns = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest(".publisher-selector-combobox")) publisherSelectorOpen.value = false;
    if (!target.closest(".publishers-combobox")) {
      merchantDropdownOpen.value = false;
      managerDropdownOpen.value = false;
    }
  };
  document.addEventListener("click", closeDropdowns);
  onBeforeUnmount(() => document.removeEventListener("click", closeDropdowns));
});

defineExpose({ load });
</script>

<template>
  <section
    class="publishers-page publishers-modern-page"
    :class="{ 'layout-editing': layoutEditing, 'publisher-focused': selectedProfile }"
    data-page="publishers"
    :aria-busy="loading ? 'true' : 'false'"
  >
    <div class="publishers-header">
      <div>
        <span class="publishers-eyebrow">{{ message("publishers.eyebrow", "PARTNER INTELLIGENCE") }}</span>
        <h2>{{ copy.title }}</h2>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="publishers-header-actions">
        <button
          type="button"
          class="layout-customize-btn"
          :class="{ active: layoutEditing }"
          :aria-label="layoutEditing ? copy.editing : copy.customize"
          :title="layoutEditing ? copy.editing : copy.customize"
          @click="layoutEditing ? publishers.cancelLayout() : publishers.beginLayoutEdit()"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 8h16M4 16h16"/><circle cx="8" cy="8" r="2"/><circle cx="16" cy="16" r="2"/></svg>
          <span>{{ layoutEditing ? copy.editing : copy.customize }}</span>
        </button>
      </div>
    </div>

    <div v-if="layoutEditing" class="layout-toolbar">
      <span class="layout-toolbar-hint">{{ copy.layoutHint }}</span>
      <div class="layout-toolbar-actions">
        <button type="button" class="layout-reset-btn" @click="publishers.resetLayout">{{ copy.resetLayout }}</button>
        <div class="layout-toolbar-divider"></div>
        <button type="button" class="layout-cancel-btn" @click="publishers.cancelLayout">{{ copy.cancel }}</button>
        <button type="button" class="layout-save-btn" @click="publishers.saveLayout">{{ copy.save }}</button>
      </div>
    </div>

    <template v-for="(section, sectionIndex) in layout" :key="section">
      <section
        v-if="section === 'filters'"
        class="panel publishers-filters publisher-lens-controls"
        :class="layoutSectionClass(section)"
        data-layout-id="filters"
        :aria-label="message('publishers.filtersLabel', 'Publisher filters')"
        :draggable="layoutEditing"
        @dragstart="layoutDragStart(section, sectionIndex)"
        @dragover.prevent
        @drop="layoutDrop(sectionIndex)"
        @dragend="layoutDragEnd"
      >
        <div v-if="layoutEditing" class="publisher-section-move"><span aria-hidden="true">⋮⋮</span><span>{{ message(`publishers.section.${section}`, section) }}</span><button type="button" :disabled="sectionIndex === 0" :aria-label="message('publishers.moveUp', 'Move {name} up', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, -1)">↑</button><button type="button" :disabled="sectionIndex === layout.length - 1" :aria-label="message('publishers.moveDown', 'Move {name} down', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, 1)">↓</button></div>
        <div class="publisher-focus-selector">
          <div class="publisher-focus-copy">
            <span class="publisher-focus-step">{{ message("publishers.selectStep", "01 · SELECT PUBLISHER") }}</span>
            <strong>{{ copy.selectPublisher }}</strong>
            <p>{{ copy.selectPublisherHint }}</p>
          </div>
          <label class="publisher-selector-field">
            <span>{{ copy.publisher }}</span>
            <div class="publishers-combobox publisher-selector-combobox">
              <input
                :value="publisherQuery"
                type="text"
                :placeholder="copy.publisherPlaceholder"
                autocomplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="publishers-modern-selector"
                :aria-expanded="publisherSelectorOpen ? 'true' : 'false'"
                :aria-label="copy.publisher"
                @focus="publisherSelectorOpen = true"
                @input="setPublisherSearch(($event.target as HTMLInputElement).value)"
                :aria-activedescendant="publisherSelectorOpen && comboIndex.publisher >= 0 ? comboId('publisher', comboIndex.publisher) : undefined"
                @keydown="comboKey($event, 'publisher')"
              />
              <div v-if="publisherSelectorOpen" id="publishers-modern-selector" class="publishers-combobox-dropdown publisher-selector-dropdown show" role="listbox">
                <button
                  v-for="(publisher, optionIndex) in publisherOptions"
                  :key="publisher.userId"
                  type="button"
                  class="publisher-selector-option"
                  :id="comboId('publisher', optionIndex)"
                  tabindex="-1"
                  @mousedown.prevent
                  :class="{ selected: publisher.userId === filters.selectedId, 'is-active-option': comboIndex.publisher === optionIndex }"
                  role="option"
                  :aria-selected="publisher.userId === filters.selectedId ? 'true' : 'false'"
                  @click="selectPublisher(publisher)"
                >
                  <span class="publisher-selector-option-avatar">{{ publisher.userName.slice(0, 1).toUpperCase() }}</span>
                  <span class="publisher-selector-option-copy">
                    <strong>{{ publisher.userName }}</strong>
                    <small>ID {{ publisher.userId }} · {{ publisher.adminName || 'Unknown' }}</small>
                  </span>
                  <span class="publisher-selector-option-count">{{ publisherMerchantCount(publisher).toLocaleString() }} {{ copy.merchants }}</span>
                </button>
                <div v-if="!publisherOptions.length" class="publisher-selector-no-results">{{ copy.noPublisherMatch }}</div>
              </div>
            </div>
          </label>
        </div>

        <div class="publisher-filter-workspace">
          <h3 class="publisher-filter-heading">{{ message("publishers.filterStep", "02 · DEFINE SCOPE") }}</h3>
          <div class="publishers-filter-row row-1">
            <div class="publishers-filter-group">
              <div class="publisher-date-field">
                <span class="publisher-field-label">{{ copy.period }}</span>
                <div class="publishers-filter-date-range">
                  <DatePicker v-model="startDraft" :language="language" :label="message('publishers.startDate', 'Start date')" aria-describedby="publisher-date-status" :aria-invalid="Boolean(dateError)" data-publisher-date="start" />
                  <span class="date-separator">—</span>
                  <DatePicker v-model="endDraft" :language="language" :label="message('publishers.endDate', 'End date')" aria-describedby="publisher-date-status" :aria-invalid="Boolean(dateError)" data-publisher-date="end" />
                </div>
              <div class="date-quick-btns" :aria-label="message('publishers.quickDates', 'Quick date ranges')">
                <button type="button" @click="applyQuickDate('lastMonth')">{{ message("publishers.lastMonth", "Last month") }}</button>
                <button type="button" @click="applyQuickDate('past30')">{{ message("publishers.past30", "Past 30 days") }}</button>
                <button type="button" @click="applyQuickDate('past3m')">{{ message("publishers.past3m", "Past 3 months") }}</button>
                <button type="button" @click="applyQuickDate('past6m')">{{ message("publishers.past6m", "Past 6 months") }}</button>
              </div>
                <p id="publisher-date-status" class="publisher-date-status" :class="{ error: dateError }" role="status">{{ dateError ? message(`publishers.${dateError}`, dateError) : message("publishers.dateHint", "Apply filters to update the date range.") }}</p>
              </div>
              <label>
                <span>{{ copy.market }}</span>
                <select :value="filters.market" :aria-label="copy.market" @change="setMarket(($event.target as HTMLSelectElement).value)">
                  <option value="all">{{ copy.allMarkets }}</option>
                  <option v-for="market in effectivePayload.markets" :key="market" :value="market">{{ market }}</option>
                </select>
              </label>
              <label>
                <span>{{ copy.network }}</span>
                <select :value="filters.network" :aria-label="copy.network" @change="setNetwork(($event.target as HTMLSelectElement).value)">
                  <option value="all">{{ copy.allNetworks }}</option>
                  <option v-for="network in effectivePayload.networks" :key="network" :value="network">{{ network }}</option>
                </select>
              </label>
              <label>
                <span>{{ copy.linkType }}</span>
                <select :value="filters.linkType" :aria-label="copy.linkType" @change="setLinkType(($event.target as HTMLSelectElement).value)">
                  <option value="all">{{ copy.allLinkTypes }}</option>
                  <option v-for="linkType in effectivePayload.linkTypes" :key="linkType" :value="linkType">{{ linkType }}</option>
                </select>
              </label>
            </div>
          </div>
          <div class="publishers-filter-row row-2">
            <div class="publishers-filter-group">

              <label>
                <span>{{ copy.merchant }}</span>
                <div class="publishers-combobox">
                  <input
                    :value="filters.merchantSearch"
                    type="text"
                    :placeholder="copy.merchantPlaceholder"
                    autocomplete="off"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="publishers-modern-merchants"
                    :aria-expanded="merchantDropdownOpen ? 'true' : 'false'"
                    :aria-label="copy.merchant"
                    @focus="merchantDropdownOpen = true"
                    @input="setMerchantSearch(($event.target as HTMLInputElement).value)"
                    :aria-activedescendant="merchantDropdownOpen && comboIndex.merchant >= 0 ? comboId('merchant', comboIndex.merchant) : undefined"
                    @keydown="comboKey($event, 'merchant')"
                  />
                  <div v-if="merchantDropdownOpen" id="publishers-modern-merchants" class="publishers-combobox-dropdown show" role="listbox">
                    <div v-for="(merchant, optionIndex) in merchantOptions" :key="merchant.merchantId" class="combobox-option merchant-combobox-option" role="option" :id="comboId('merchant', optionIndex)" :class="{ 'is-active-option': comboIndex.merchant === optionIndex }" @mousedown.prevent :aria-selected="filters.merchantSelectedId === merchant.merchantId ? 'true' : 'false'" @click="selectMerchant(merchant.merchantId, merchant.name)">
                      <span class="opt-label">{{ merchant.name }}</span>
                      <span class="opt-count">({{ formatNumber(merchant.count) }})</span>
                      <span class="opt-id">ID {{ merchant.merchantId }}</span>
                    </div>
                    <div v-if="!merchantOptions.length" class="combobox-option combobox-no-results">{{ copy.noMerchantMatch }}</div>
                  </div>
                </div>
              </label>
              <label>
                <span>{{ copy.manager }}</span>
                <div class="publishers-combobox">
                  <input
                    :value="filters.managerSearch"
                    type="text"
                    :placeholder="copy.managerPlaceholder"
                    autocomplete="off"
                    :aria-label="copy.manager"
                    @focus="managerDropdownOpen = true"
                    @input="setManagerSearch(($event.target as HTMLInputElement).value)"
                    role="combobox" aria-autocomplete="list" aria-controls="publishers-modern-managers" :aria-expanded="managerDropdownOpen" :aria-activedescendant="managerDropdownOpen && comboIndex.manager >= 0 ? comboId('manager', comboIndex.manager) : undefined" @keydown="comboKey($event, 'manager')"
                  />
                  <div v-if="managerDropdownOpen" id="publishers-modern-managers" class="publishers-combobox-dropdown show" role="listbox">
                    <div v-for="(option, optionIndex) in visibleManagerOptions" :key="option.name" class="combobox-option" role="option" :id="comboId('manager', optionIndex)" :aria-selected="filters.managerSearch === option.name" :class="{ 'is-active-option': comboIndex.manager === optionIndex }" @mousedown.prevent @click="selectManager(option.name)">{{ option.name }} <span class="opt-count">({{ option.count }})</span></div>
                    <div v-if="!visibleManagerOptions.length" class="combobox-option combobox-no-results">{{ copy.noPublisherMatch }}</div>
                  </div>
                </div>
              </label>
            </div>
            <div class="publishers-filter-actions">
              <button class="btn-search" type="button" :aria-label="copy.apply" @click="applyFilters">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                <span>{{ copy.apply }}</span>
              </button>
              <button class="btn-reset" type="button" :aria-label="copy.reset" @click="resetFilters">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                <span>{{ copy.reset }}</span>
              </button>
              <div class="btn-group">
                <button class="btn-export" type="button" :aria-label="message('publishers.exportCurrentAria', 'Export current publisher results')" @click="emitExport('all')">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                  <span>{{ copy.export }}</span>
                </button>
                <div v-if="false" class="btn-group-dropdown"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        v-else-if="section === 'kpi'"
        class="publishers-kpi"
        :class="layoutSectionClass(section)"
        data-layout-id="kpi"
        :aria-label="message('publishers.summaryLabel', 'Publisher KPI summary')"
        :draggable="layoutEditing"
        @dragstart="layoutDragStart(section, sectionIndex)"
        @dragover.prevent
        @drop="layoutDrop(sectionIndex)"
        @dragend="layoutDragEnd"
      >
        <div v-if="layoutEditing" class="publisher-section-move"><span aria-hidden="true">⋮⋮</span><span>{{ message(`publishers.section.${section}`, section) }}</span><button type="button" :disabled="sectionIndex === 0" :aria-label="message('publishers.moveUp', 'Move {name} up', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, -1)">↑</button><button type="button" :disabled="sectionIndex === layout.length - 1" :aria-label="message('publishers.moveDown', 'Move {name} down', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, 1)">↓</button></div>
        <div class="publishers-kpi-row">
          <button
            type="button"
            v-for="definition in PUBLISHER_KPI_DEFINITIONS"
            :key="definition.key"
            class="metric"
            :class="{ 'metric-active': filters.chartMetric === definition.key }"
            :aria-pressed="filters.chartMetric === definition.key"
            :aria-label="message('publishers.chooseMetric', 'View {metric} distribution', { metric: metricLabel(definition.key, definition.label) })"
            @click="chooseChartMetric(definition.key)"
          >
            <div class="metric-icon" :class="definition.tone" aria-hidden="true">{{ definition.icon }}</div>
            <div class="metric-body">
              <span class="metric-label">{{ metricLabel(definition.key, definition.label) }}</span>
              <strong class="metric-value">{{ formatMetric(kpiAggregate[definition.key], definition.key) }}</strong>
              <span class="metric-full">{{ formatFullMetric(kpiAggregate[definition.key], definition.key) }}</span>
            </div>
          </button>
        </div>
      </section>

      <section
        v-else-if="section === 'affinity'"
        class="panel publisher-affinity-panel"
        :class="layoutSectionClass(section)"
        data-layout-id="affinity"
        :aria-label="message('publishers.affinityLabel', 'Publisher merchant affinity')"
        :draggable="layoutEditing"
        @dragstart="layoutDragStart(section, sectionIndex)"
        @dragover.prevent
        @drop="layoutDrop(sectionIndex)"
        @dragend="layoutDragEnd"
      >
        <div v-if="layoutEditing" class="publisher-section-move"><span aria-hidden="true">⋮⋮</span><span>{{ message(`publishers.section.${section}`, section) }}</span><button type="button" :disabled="sectionIndex === 0" :aria-label="message('publishers.moveUp', 'Move {name} up', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, -1)">↑</button><button type="button" :disabled="sectionIndex === layout.length - 1" :aria-label="message('publishers.moveDown', 'Move {name} down', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, 1)">↓</button></div>
        <div v-if="!selectedProfile" class="publisher-affinity-empty">

          <div v-if="!filters.merchantSearch">
            <strong>{{ copy.affinityEmptyTitle }}</strong>
            <p>{{ copy.affinityEmptyBody }}</p>
          </div>
          <div v-else class="publisher-merchant-match-result">
            <span class="publisher-merchant-match-kicker">{{ message("publishers.merchantMatchKicker", "Merchant associations") }}</span>
            <div class="publisher-merchant-match-heading">
              <strong class="publisher-merchant-match-count">{{ formatNumber(association.publisherCount) }}</strong>
              <span>{{ message("publishers.associatedPublishers", "Associated publishers") }}</span>
            </div>
            <p class="publisher-merchant-match-title">{{ association.merchantCount ? `${message("publishers.merchantMatches", "Matched merchants")} · ${association.merchantCount}` : copy.noMerchantMatch }}</p>
            <p class="publisher-merchant-match-merchants">{{ association.merchants.map((merchant) => `${merchant.merchantName} · ID ${merchant.merchantId}`).join(" / ") || `“${filters.merchantSearch}”` }}</p>
            <p>{{ message("publishers.merchantMatchHint", "Results reflect the current page filters. Select a publisher to open its profile.") }}</p>
            <div v-if="associationPublishers.length" class="publisher-merchant-match-list">
              <button v-for="publisher in associationPublishers" :key="publisher.userId" type="button" class="publisher-merchant-match-chip" @click="selectPublisher(publisher)">
                {{ publisher.userName }}<small>ID {{ publisher.userId }}</small>
              </button>
              <span v-if="associationRemaining" class="publisher-merchant-match-more">+{{ associationRemaining }}</span>
            </div>
          </div>
        </div>
        <div v-else class="publisher-affinity-content">
          <header class="publisher-affinity-header">
            <div class="publisher-identity">
              <span class="publisher-avatar">{{ selectedPublisher?.userName.slice(0, 1).toUpperCase() }}</span>
              <div>
                <span class="publisher-affinity-kicker">{{ message("publishers.mediaProfile", "Media profile") }}</span>
                <h3>{{ selectedPublisher?.userName }}</h3>
                <p>ID {{ selectedPublisher?.userId }} · {{ selectedPublisher?.adminName || 'Unknown' }} · {{ selectedPublisher?.networks.join(', ') }}</p>
              </div>
            </div>
            <button type="button" class="publisher-clear-focus" @click="clearPublisherSelection"><span aria-hidden="true">←</span><span>{{ copy.backToAll }}</span></button>
          </header>
          <div v-if="portfolioStatus" class="publisher-affinity-status" :class="{ error: Boolean(portfolioError), loading: portfolioLoading }" role="status" aria-live="polite">{{ portfolioStatus }}</div>
          <div class="publisher-affinity-metrics">
            <article class="publisher-affinity-metric"><span>{{ copy.activeMerchants }}</span><strong :title="formatNumber(profileSummary.merchantCount)">{{ formatNumber(profileSummary.merchantCount) }}</strong><small>{{ copy.inCurrentView }}</small></article>
            <article class="publisher-affinity-metric"><span>AOV</span><strong :title="formatAov(profileSummary.aov)">{{ formatAov(profileSummary.aov) }}</strong><small>{{ formatNumber(profileSummary.orders) }} {{ copy.orders }}</small></article>
            <article class="publisher-affinity-metric"><span>{{ copy.topCategory }}</span><strong :title="profileSummary.categories[0]?.category || 'N/A'">{{ profileSummary.categories[0]?.category || 'N/A' }}</strong><small>{{ profileSummary.categories[0] ? `${(profileSummary.categories[0].salesShare * 100).toFixed(1)}% ${copy.ofSales}` : copy.noActivity }}</small></article>
            <article class="publisher-affinity-metric"><span>{{ copy.weightedCommission }}</span><strong :title="formatRate(profileSummary.weightedCommissionRate)">{{ formatRate(profileSummary.weightedCommissionRate) }}</strong><small>{{ copy.weightedBySales }}</small></article>
          </div>
          <div class="publisher-affinity-grid">
            <article class="publisher-affinity-card">
              <div class="publisher-affinity-card-title"><div><span class="publisher-section-index">A</span><h4>{{ copy.categoryAffinity }}</h4></div><small>{{ copy.bySales }}</small></div>
              <div class="publisher-category-bars">
                <div v-for="(category, categoryIndex) in profileSummary.categories.slice(0, 6)" :key="category.category" class="publisher-category-row">
                  <div class="publisher-category-copy"><span class="publisher-category-rank">{{ categoryIndex + 1 }}</span><strong :title="category.category">{{ category.category }}</strong><small>{{ formatNumber(category.merchantCount) }} {{ copy.merchants }}</small></div>
                  <div class="publisher-category-track" :aria-label="`${category.category} ${(category.salesShare * 100).toFixed(1)}%`"><span :style="{ width: `${Math.max(2, category.salesShare * 100).toFixed(1)}%` }"></span></div>
                  <span class="publisher-category-share">{{ (category.salesShare * 100).toFixed(1) }}%</span>
                </div>
                <div v-if="!profileSummary.categories.length" class="publisher-affinity-inline-empty">{{ copy.noActivity }}</div>
              </div>
            </article>
            <article class="publisher-affinity-card">
              <div class="publisher-affinity-card-title"><div><span class="publisher-section-index">B</span><h4>{{ copy.affinitySignals }}</h4></div><small>{{ copy.signalHint }}</small></div>
              <div class="publisher-affinity-signals">
                <div class="publisher-signal-row"><span class="publisher-signal-index">01</span><div><small>{{ copy.typicalAovBand }}</small><strong>{{ profileSummary.aovBands.find((band) => band.label !== 'N/A')?.label || 'N/A' }}</strong><p>{{ profileSummary.aovBands[0] ? `${(profileSummary.aovBands[0].salesShare * 100).toFixed(1)}% ${copy.ofSales}` : copy.noActivity }}</p></div></div>
                <div class="publisher-signal-row"><span class="publisher-signal-index">02</span><div><small>{{ copy.categoryConcentration }}</small><strong>{{ profileSummary.categories[0] ? `${(profileSummary.categories[0].salesShare * 100).toFixed(1)}%` : 'N/A' }}</strong><p>{{ profileSummary.categories[0]?.category || copy.noActivity }}</p></div></div>
                <div class="publisher-signal-row"><span class="publisher-signal-index">03</span><div><small>{{ copy.commissionProfile }}</small><strong>{{ formatRate(profileSummary.weightedCommissionRate) }}</strong><p>{{ formatRate(profileSummary.effectiveCommissionRate) }} {{ copy.effectiveEarned }}</p></div></div>
                <div class="publisher-signal-row"><span class="publisher-signal-index">04</span><div><small>{{ copy.marketReach }}</small><strong>{{ formatNumber(profileSummary.markets.length) }}</strong><p>{{ profileSummary.markets[0] ? `${copy.leadsWith} ${profileSummary.markets[0].market}` : copy.noActivity }}</p></div></div>
              </div>
            </article>
          </div>
          <section class="publisher-portfolio">
            <div class="publisher-portfolio-toolbar">
              <div><span class="publisher-section-index">C</span><h4>{{ copy.merchantPortfolio }}</h4><p>{{ formatNumber(profileRows.length) }} {{ copy.merchantsInView }}</p></div>
              <div class="publisher-portfolio-controls">
                <input :value="filters.portfolioSearch" type="search" :placeholder="message('publishers.portfolioSearchPlaceholder', '搜索商家或 ID')" :aria-label="message('publishers.portfolioSearchPlaceholder', 'Search merchants or ID')" @input="setPortfolioFilter('portfolioSearch', ($event.target as HTMLInputElement).value)" />
                <select :value="filters.portfolioCategory" :aria-label="message('label.Category', 'Category')" @change="setPortfolioFilter('portfolioCategory', ($event.target as HTMLSelectElement).value)"><option value="all">{{ message('publishers.allCategories', '全部品类') }}</option><option v-for="category in profileCategories" :key="category" :value="category">{{ category }}</option></select>
                <select :value="filters.portfolioTier" :aria-label="message('publishers.allTiers', 'All tiers')" @change="setPortfolioFilter('portfolioTier', ($event.target as HTMLSelectElement).value)"><option value="all">{{ message('publishers.allTiers', '全部 Tier') }}</option><option v-for="tier in profileTiers" :key="tier" :value="tier">{{ tier }}</option></select>
                <select :value="filters.portfolioSort" :aria-label="message('publishers.portfolioSort', 'Sort merchant portfolio')" @change="setPortfolioFilter('portfolioSort', ($event.target as HTMLSelectElement).value)">
                  <option value="sales">{{ message('publishers.sortSales', '销售额从高到低') }}</option>
                  <option value="orders">{{ message('publishers.sortOrders', '订单数从高到低') }}</option>
                  <option value="aov">{{ message('publishers.sortAov', 'AOV 从高到低') }}</option>
                  <option value="affCommissionRate">{{ message('publishers.sortAffRate', 'AFF 佣金率从高到低') }}</option>
                  <option value="affCommission">{{ message('publishers.sortAffCommission', 'AFF 实际佣金从高到低') }}</option>
                  <option value="merchantName">{{ message('publishers.sortMerchantName', '商家名称') }}</option>
                </select>
              </div>
            </div>
            <div class="publisher-portfolio-table-wrap">
              <table class="publisher-portfolio-table">
                <thead><tr><th>{{ copy.merchant }}</th><th>{{ message('publishers.networkMarket', 'Network / Market') }}</th><th>{{ message('label.Category', 'Category') }}</th><th>Tier</th><th class="publisher-numeric">AOV</th><th class="publisher-numeric">AFF EPC</th><th class="publisher-numeric">{{ copy.conversion }}</th><th class="publisher-numeric">{{ copy.commissionRate }}</th><th class="publisher-numeric">{{ copy.orders }}</th><th class="publisher-numeric">{{ copy.sales }}</th><th class="publisher-numeric">{{ copy.earnedCommission }}</th><th class="publisher-numeric">{{ copy.portfolioShare }}</th></tr></thead>
                <tbody>
                  <tr v-for="row in profileRows" :key="row.merchant.merchantId">
                    <td><div class="publisher-merchant-cell"><strong>{{ row.merchant.merchantName }}</strong><small>ID {{ row.merchant.merchantId }}</small></div></td>
                    <td><div class="publisher-network-market"><span>{{ row.merchant.network }}</span><small>{{ profileMarketText(row) }}</small></div></td>
                    <td><span class="publisher-category-pill">{{ row.merchant.category }}</span></td>
                    <td><span class="publisher-tier-pill" :class="tierTone(row.merchant.tier)">{{ row.merchant.tier }}</span></td>
                    <td class="publisher-numeric publisher-aov-cell">{{ formatAov(publisherMetricAov(portfolioMetric(row))) }}</td>
                    <td class="publisher-numeric">{{ formatEpc(publisherMetricAffEpc(portfolioMetric(row))) }}</td>
                    <td class="publisher-numeric">{{ formatPercent(publisherMetricConversionRate(portfolioMetric(row))) }}</td>
                    <td class="publisher-numeric">{{ formatRate(publisherMetricAffCommissionRate(portfolioMetric(row))) }}</td>
                    <td class="publisher-numeric">{{ formatNumber(row.metrics.orders) }}</td>
                    <td class="publisher-numeric">{{ formatMoney(row.metrics.sales) }}</td>
                    <td class="publisher-numeric">{{ formatMoney(publisherMetricAffCommission(portfolioMetric(row)) || 0) }}</td>
                    <td class="publisher-numeric publisher-share-column"><div class="publisher-share-cell"><span>{{ profileSummary.sales > 0 ? ((row.metrics.sales / profileSummary.sales) * 100).toFixed(1) : '0.0' }}%</span><i><b :style="{ width: `${Math.max(1, profileSummary.sales > 0 ? (row.metrics.sales / profileSummary.sales) * 100 : 1).toFixed(1)}%` }"></b></i></div></td>
                  </tr>
                  <tr v-if="!profileRows.length"><td colspan="12" class="publisher-portfolio-empty">{{ copy.noPortfolioRows }}</td></tr>
                </tbody>
              </table>
            </div>
            <p class="publisher-portfolio-method">{{ copy.portfolioMethod }}</p>
          </section>
        </div>
      </section>

      <section
        v-else-if="section === 'overview'"
        class="panel publishers-market-summary"
        :class="[{ hidden: selectedProfile }, layoutSectionClass(section)]"
        data-layout-id="overview"
        :aria-label="message('publishers.overviewLabel', 'Market aggregate summary')"
        :draggable="layoutEditing"
        @dragstart="layoutDragStart(section, sectionIndex)"
        @dragover.prevent
        @drop="layoutDrop(sectionIndex)"
        @dragend="layoutDragEnd"
      >
        <div v-if="layoutEditing" class="publisher-section-move"><span aria-hidden="true">⋮⋮</span><span>{{ message(`publishers.section.${section}`, section) }}</span><button type="button" :disabled="sectionIndex === 0" :aria-label="message('publishers.moveUp', 'Move {name} up', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, -1)">↑</button><button type="button" :disabled="sectionIndex === layout.length - 1" :aria-label="message('publishers.moveDown', 'Move {name} down', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, 1)">↓</button></div>
        <div class="panel-title publisher-overview-header">
          <div><h3>{{ copy.marketSummary }}</h3><p id="publisher-overview-hint">{{ message("publishers.overviewHint", "Select a segment or name to filter its market or network; select again to show all.") }}</p></div>
          <div class="publisher-overview-actions">
            <span class="overview-toggle" :aria-label="copy.marketSummary" role="group">
              <button type="button" class="overview-toggle-btn" :class="{ active: filters.overviewType === 'market' }" :aria-pressed="filters.overviewType === 'market'" @click="setOverviewType('market')">{{ copy.market }}</button>
              <button type="button" class="overview-toggle-btn" :class="{ active: filters.overviewType === 'network' }" :aria-pressed="filters.overviewType === 'network'" @click="setOverviewType('network')">{{ copy.network }}</button>
            </span>
            <button type="button" class="overview-chevron" :aria-expanded="filters.overviewExpanded" aria-controls="publisher-overview-content" :aria-label="message(filters.overviewExpanded ? 'publishers.collapse' : 'publishers.expand', 'Toggle section')" @click="toggleOverview">{{ filters.overviewExpanded ? '−' : '+' }}</button>
          </div>
        </div>
        <div v-if="filters.overviewExpanded" id="publisher-overview-content">
          <div v-if="filters.overviewFocus" class="publisher-overview-selection">
            <span role="status">{{ message("publishers.overviewSelection", "Filtered to: {name}", { name: filters.overviewFocus }) }}</span>
            <button type="button" class="overview-back" @click="clearOverviewFocus">{{ message("publishers.clearOverview", "Clear chart filter") }} ×</button>
          </div>
          <div v-if="overviewRows.length" class="publisher-overview-grid">
            <div class="publisher-donut-wrap">
              <svg class="publisher-donut" viewBox="0 0 100 100" role="group" :aria-label="copy.marketSummary + ' · ' + chartMetricLabel()" aria-describedby="publisher-overview-hint">
                <circle cx="50" cy="50" r="38" class="publisher-donut-track" />
                <path v-for="segment in overviewSegments" :key="segment.key" :d="segment.path" :fill="overviewColor(segment)" class="publisher-donut-segment" :class="{ 'is-highlighted': highlightedOverviewKey === segment.key }" :data-overview-key="segment.key" role="button" tabindex="0" :aria-pressed="filters.overviewFocus === segment.key" :aria-label="message('publishers.showOnly', 'Filter {name}, {percent}% share', { name: segment.key, percent: segment.percentage.toFixed(1) })" @click="focusOverview(segment)" @keydown.enter.prevent="focusOverview(segment)" @keydown.space.prevent="focusOverview(segment)" @pointerenter="highlightOverview(segment.key)" @pointerleave="clearHighlight" @focus="highlightOverview(segment.key)" @blur="clearHighlight"><title>{{ segment.key }} · {{ formatOverviewMetric(segment) }} · {{ segment.percentage.toFixed(1) }}%</title></path>
              </svg>
              <div class="publisher-donut-center"><span>{{ chartMetricLabel() }}</span><strong>{{ formatMetric(overviewTotal, filters.chartMetric) }}</strong><small>{{ filters.overviewFocus || copy.total }}</small></div>
            </div>
            <ol class="publisher-overview-legend" :aria-label="copy.marketSummary">
              <li v-for="(row, index) in overviewRows" :key="row.key">
                <button type="button" :data-overview-legend="row.key" :class="{ 'is-highlighted': highlightedOverviewKey === row.key, 'is-selected': filters.overviewFocus === row.key }" :aria-pressed="filters.overviewFocus === row.key" :aria-label="message('publishers.showOnly', 'Filter {name}, {percent}% share', { name: row.key, percent: (row.value / (overviewTotal || 1) * 100).toFixed(1) })" :style="{ '--series-color': overviewColor(row) }" @click="focusOverview(row)" @pointerenter="highlightOverview(row.key)" @pointerleave="clearHighlight" @focus="highlightOverview(row.key)" @blur="clearHighlight">
                  <span class="publisher-legend-number" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
                  <span class="publisher-legend-copy"><strong><i :style="{ background: overviewColor(row) }" aria-hidden="true" />{{ row.key }}</strong><span class="publisher-share-track" aria-hidden="true"><i :style="{ width: (row.value / (overviewTotal || 1) * 100) + '%', background: overviewColor(row) }" /></span></span>
                  <span class="publisher-legend-value"><strong>{{ formatOverviewMetric(row) }}</strong><small>{{ (row.value / (overviewTotal || 1) * 100).toFixed(1) }}% {{ message("publishers.share", "Share") }}</small></span>
                </button>
              </li>
            </ol>
          </div>
          <p v-else class="publishers-empty">{{ copy.empty }}</p>
          <div class="publisher-overview-table-wrap" tabindex="0" role="region" :aria-label="copy.marketSummary + ' · ' + copy.tableTitle">
            <table class="publishers-market-table">
              <thead><tr><th scope="col">{{ filters.overviewType === 'network' ? copy.network : copy.market }}</th><th scope="col">{{ copy.publisherCount }}</th><th scope="col">{{ chartMetricLabel() }}</th><th scope="col">{{ copy.orders }}</th><th scope="col">{{ copy.commission }}</th></tr></thead>
              <tbody><tr v-for="row in overviewRows" :key="row.key" :data-overview-row="row.key" :class="{ 'is-selected': filters.overviewFocus === row.key, 'is-highlighted': highlightedOverviewKey === row.key }"><th scope="row"><button type="button" class="publisher-overview-row-button" :aria-pressed="filters.overviewFocus === row.key" @click="focusOverview(row)"><i :style="{ background: overviewColor(row) }" aria-hidden="true" />{{ row.key }}</button></th><td>{{ formatNumber(row.publisherCount) }}</td><td>{{ formatOverviewMetric(row) }}</td><td>{{ formatNumber(row.orders) }}</td><td>{{ formatMoney(row.allCommission) }}</td></tr></tbody>
              <tfoot><tr class="market-table-total"><th scope="row">{{ copy.total }}</th><td>{{ formatNumber(filteredRows.length) }}</td><td>{{ formatMetric(overviewTotal, filters.chartMetric) }}</td><td>{{ formatNumber(overviewTotals.orders) }}</td><td>{{ formatMoney(overviewTotals.allCommission) }}</td></tr></tfoot>
            </table>
          </div>
        </div>
      </section>

      <section
        v-else-if="section === 'chart'"
        class="panel publishers-chart-panel"
        :class="[{ hidden: selectedProfile }, layoutSectionClass(section)]"
        data-layout-id="chart"
        :aria-label="message('publishers.chartTitle', '{metric} by publisher', { metric: chartMetricLabel() })"
        :draggable="layoutEditing"
        @dragstart="layoutDragStart(section, sectionIndex)"
        @dragover.prevent
        @drop="layoutDrop(sectionIndex)"
        @dragend="layoutDragEnd"
      >
        <div v-if="layoutEditing" class="publisher-section-move"><span aria-hidden="true">⋮⋮</span><span>{{ message(`publishers.section.${section}`, section) }}</span><button type="button" :disabled="sectionIndex === 0" :aria-label="message('publishers.moveUp', 'Move {name} up', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, -1)">↑</button><button type="button" :disabled="sectionIndex === layout.length - 1" :aria-label="message('publishers.moveDown', 'Move {name} down', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, 1)">↓</button></div>
        <div class="panel-title"><h3>{{ message("publishers.chartTitle", "{metric} by publisher", { metric: chartMetricLabel() }) }}</h3><button type="button" class="chart-chevron" :aria-expanded="filters.chartExpanded" :aria-label="message(filters.chartExpanded ? 'publishers.collapse' : 'publishers.expand', 'Toggle section')" :class="{ collapsed: !filters.chartExpanded }" @click="toggleChart">{{ filters.chartExpanded ? '▼' : '▶' }}</button></div>
        <div v-if="filters.chartExpanded" class="publishers-chart">
          <div v-for="publisher in chartRows" :key="publisher.userId" class="chart-bar-row">
            <span class="chart-bar-label" :title="publisher.userName">{{ publisher.userName }}</span>
            <div class="chart-bar-track"><div class="chart-bar-fill" :style="{ width: chartBarWidth(publisher) }">{{ chartValueLabel(publisher) }}</div></div>
            <span class="chart-bar-value">{{ formatMetric(chartMetricValue(publisher), filters.chartMetric) }}</span>
          </div>
          <div v-if="!chartRows.length" class="publishers-empty">{{ copy.empty }}</div>
        </div>
      </section>

      <section
        v-else-if="section === 'table'"
        class="panel table-panel publishers-table-panel"
        :class="[{ hidden: selectedProfile }, layoutSectionClass(section)]"
        data-layout-id="table"
        :aria-label="copy.tableTitle"
        :draggable="layoutEditing"
        @dragstart="layoutDragStart(section, sectionIndex)"
        @dragover.prevent
        @drop="layoutDrop(sectionIndex)"
        @dragend="layoutDragEnd"
      >
        <div v-if="layoutEditing" class="publisher-section-move"><span aria-hidden="true">⋮⋮</span><span>{{ message(`publishers.section.${section}`, section) }}</span><button type="button" :disabled="sectionIndex === 0" :aria-label="message('publishers.moveUp', 'Move {name} up', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, -1)">↑</button><button type="button" :disabled="sectionIndex === layout.length - 1" :aria-label="message('publishers.moveDown', 'Move {name} down', { name: message(`publishers.section.${section}`, section) })" @click="moveSection(sectionIndex, 1)">↓</button></div>
        <div class="table-toolbar">
          <div><h3>{{ copy.tableTitle }}</h3><p>{{ message("publishers.recordCount", "{count} publishers", { count: formatNumber(filteredRows.length) }) }}</p><nav v-if="tablePagination.totalPages > 1" class="publishers-pagination" :aria-label="copy.tableTitle"><button type="button" class="secondary-button" :disabled="tablePagination.page <= 1" :aria-label="copy.previous" @click="pageChange(-1)">{{ copy.previous }}</button><span aria-live="polite">{{ message("publishers.pageCount", "Page {page} of {total}", { page: tablePagination.page, total: tablePagination.totalPages }) }}</span><button type="button" class="secondary-button" :disabled="tablePagination.page >= tablePagination.totalPages" :aria-label="copy.next" @click="pageChange(1)">{{ copy.next }}</button></nav></div>
          <div class="table-toolbar-actions"><div class="column-picker"><button type="button" class="icon-button table-select-button" :aria-expanded="columnsOpen ? 'true' : 'false'" @click="columnsOpen = !columnsOpen">{{ copy.columnsButton }}</button><div v-if="columnsOpen" class="column-picker-panel" role="dialog" :aria-label="copy.columnsTitle" @keydown.esc="columnsOpen = false"><div class="column-picker-header"><strong>{{ copy.columnsTitle }}</strong><span>{{ copy.columnsHint }}</span></div><div class="column-picker-actions"><button type="button" @click="setCoreColumns">{{ copy.coreColumns }}</button><button type="button" @click="setAllColumns">{{ copy.allColumns }}</button></div><div class="column-picker-list"><label v-for="column in PUBLISHER_TABLE_COLUMNS" :key="column.key"><input type="checkbox" :checked="visibleColumnKeys.includes(column.key)" @change="toggleColumn(column.key)" />{{ metricLabel(column.key, column.label) }}</label></div></div></div></div>
        </div>
        <div class="table-wrap publishers-table-wrap">
          <table class="publishers-table"><thead><tr><th v-for="column in displayColumns" :key="column.key" :aria-sort="ariaSort(column.key)"><button type="button" class="table-sort-button" :class="{ active: sort.key === column.key }" @click="changeSort(column.key)"><span>{{ metricLabel(column.key, column.label) }}</span><span class="sort-indicator" aria-hidden="true">{{ sort.key === column.key ? (sort.direction === 'asc' ? '▲' : '▼') : '↕' }}</span></button></th></tr></thead><tbody><tr v-for="(row, rowIndex) in displayTableRows" :key="rowIndex" :class="{ 'total-row': rowIndex === 0 }"><td v-for="column in displayColumns" :key="column.key">{{ tableCell(row, column.key) }}</td></tr><tr v-if="!displayTableRows.length"><td :colspan="displayColumns.length" class="publishers-empty">{{ copy.empty }}</td></tr></tbody></table>
        </div>
      </section>
    </template>

    <p v-if="loading" class="publishers-loading" role="status">{{ copy.loading }}</p>
    <p v-if="loadError" class="publishers-empty" role="alert">{{ copy.error }}: {{ loadError }}</p>
  </section>
</template>
