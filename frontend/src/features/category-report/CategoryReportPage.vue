<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import { translateMessage, type UiLanguage } from "../../shared/i18n";
import { categoryName } from "../../shared/i18n/categoryNames";
import {
  categoryKey,
  categoryPalette,
  categoryPieMetricKey,
  type CategoryPieSlice,
  type CategoryReportData,
  type CategoryReportGroup,
  type CategoryReportSortKey
} from "./categoryReportModel";
import { useCategoryReport, type CategoryTierLoader } from "./useCategoryReport";

export interface CategoryExportPayload {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly label: string;
}

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly reportData?: CategoryReportData;
  readonly loadTier?: CategoryTierLoader;
  readonly download?: (payload: CategoryExportPayload) => void;
  readonly autoLoad?: boolean;
  readonly today?: () => Date;
}>(), {
  reportData: () => ({ sheets: [] }),
  loadTier: undefined,
  download: undefined,
  autoLoad: true,
  today: undefined
});

const category = useCategoryReport({
  reportData: props.reportData,
  loadTier: props.loadTier,
  autoLoad: false,
  today: props.today
});
const startDraft = ref(category.startDate.value);
const endDraft = ref(category.endDate.value);
const searchError = ref(false);
const fullView = ref(false);
const revenueHidden = ref(false);
const privacyLabel = computed(() => revenueHidden.value
  ? (props.language === "zh" ? "显示营收" : "Show revenue")
  : (props.language === "zh" ? "隐藏营收" : "Hide revenue"));
const hiddenAmountLabel = computed(() => revenueHidden.value ? (props.language === "zh" ? "金额已隐藏" : "Amount hidden") : undefined);
const privacyHint = computed(() => props.language === "zh"
  ? "隐藏页面中的营收、AOV 和 EPC，保留百分比；导出文件仍包含原始金额。"
  : "Hide revenue, AOV and EPC on this page while keeping percentages. Export files still contain original amounts.");
const recordsPanel = ref<HTMLElement>();
const fullViewButton = ref<HTMLButtonElement>();
const recordsScroll = ref<HTMLElement>();
let previousBodyOverflow = "";

async function toggleFullView(): Promise<void> {
  const scrollTop = recordsScroll.value?.scrollTop ?? 0;
  const scrollLeft = recordsScroll.value?.scrollLeft ?? 0;
  if (!fullView.value) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  } else {
    document.body.style.overflow = previousBodyOverflow;
  }
  fullView.value = !fullView.value;
  await nextTick();
  fullViewButton.value?.focus({ preventScroll: true });
  if (recordsScroll.value) {
    recordsScroll.value.scrollTop = scrollTop;
    recordsScroll.value.scrollLeft = scrollLeft;
  }
}

function handleFullViewKey(event: KeyboardEvent): void {
  if (!fullView.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    void toggleFullView();
  } else if (event.key === "Tab") {
    const items = Array.from(recordsPanel.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [tabindex="0"]'
    ) ?? []);
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !recordsPanel.value?.contains(document.activeElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !recordsPanel.value?.contains(document.activeElement))) {
      event.preventDefault();
      first?.focus();
    }
  }
}

function message(key: string, fallback: string, values: Record<string, string | number> = {}): string {
  return translateMessage(props.language, key, fallback, values);
}

function displayCategory(value: string): string {
  if (value === "Other selected categories") return props.language === "zh" ? "其他" : "Other";
  return categoryName(value, props.language);
}

const searchOptions = computed(() => {
  const entries = category.searchEntries.value;
  const counts = new Map<string, number>();
  entries.filter(entry => entry.type === "category").forEach(entry => {
    const label = displayCategory(entry.value);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return entries.map(entry => {
    const label = entry.type === "category" ? displayCategory(entry.value) : entry.value;
    return { ...entry, displayValue: entry.type === "category" && (counts.get(label) ?? 0) > 1
      ? `${label}（${entry.value}）` : label };
  });
});
const searchDisplay = computed(() => {
  const selected = category.selection.value;
  return selected?.value === category.searchDraft.value
    ? searchOptions.value.find(entry => entry.value === selected.value)?.displayValue ?? category.searchDraft.value
    : category.searchDraft.value;
});

const copy = computed(() => ({
  title: message("categoryReport.title", "Category"),
  subtitle: message("categoryReport.subtitle", "Category-wise performance summary from tier sheets"),
  report: message("categoryReport.report", "Category-wise report"),
  reportHelp: message("categoryReport.reportHelp", "Revenue, orders, clicks, and merchant mix for the selected tiers"),
  allTiers: message("categoryReport.allTiers", "All Tier 1-4"),
  blackTier: message("categoryReport.blackTier", "Black Tier"),
  categoryMerchant: message("categoryReport.categoryMerchant", "Category / merchant"),
  searchPlaceholder: message("categoryReport.searchPlaceholder", "Select category or merchant"),
  searchHint: message("categoryReport.searchHint", "Choose a suggestion or press Enter to update the report."),
  searchAll: message("categoryReport.searchAll", "Clear the field and press Enter to show all categories."),
  searchInvalid: message("categoryReport.searchInvalid", "Select a category or merchant from the suggestions."),
  dateRange: message("categoryReport.dateRange", "Date / range"),
  apply: message("categoryReport.apply", "Apply"),
  loading: message("categoryReport.loading", "Loading selected tiers from YeahPromos DB…"),
  sourceSnapshot: message("categoryReport.sourceSnapshot", "Sheet snapshot"),
  sourceMixed: message("categoryReport.sourceMixed", "Snapshot + database"),
  sourceDatabase: message("categoryReport.sourceDatabase", "YeahPromos DB"),
  merchants: message("categoryReport.merchants", "Merchants"),
  revenue: message("categoryReport.revenue", "Revenue"),
  orders: message("categoryReport.orders", "Orders"),
  clicks: message("categoryReport.clicks", "Clicks"),
  cvr: message("categoryReport.cvr", "CVR"),
  category: message("categoryReport.category", "Category"),
  topMerchants: message("categoryReport.topMerchants", "Top merchants"),
  tierMix: message("categoryReport.tierMix", "Tier mix"),
  noRows: message("categoryReport.noRows", "No category rows match the selected tiers or category search."),
  metricLens: message("categoryReport.metricLens", "01 Metric lens"),
  metricLensTitle: message("categoryReport.metricLensTitle", "Switch the chart focus"),
  drawer: message("categoryReport.drawer", "02 Drill-down drawer"),
  tierMixCard: message("categoryReport.tierMixCard", "03 Tier mix bar"),
  readableDistribution: message("categoryReport.readableDistribution", "Readable distribution"),
  allCategories: message("categoryReport.allCategories", "All categories"),
  tableKicker: message("categoryReport.tableKicker", "Record view"),
  tableTitle: message("categoryReport.tableTitle", "Category Records"),
  fullView: message("categoryReport.fullView", "Full view"),
  exitFullView: message("categoryReport.exitFullView", "Exit full view"),
  merchantId: message("categoryReport.merchantId", "Merchant / ID"),
  tableHelp: message("categoryReport.tableHelp", "Performance by category · select a row to inspect merchants"),
  categoriesInView: message("categoryReport.categoriesInView", "categories in view"),
  export: message("categoryReport.export", "Export focused category"),
  exportHint: message("categoryReport.exportHint", "Export the selected category rows with the existing XLSX generator."),
  noData: message("categoryReport.noData", "No category data is available for the selected tiers."),
  source: message("categoryReport.source", "Source")
}));

const selectedTierSet = computed(() => new Set(category.selectedTiers.value));
const allStandardSelected = computed(() =>
  ["Tier 1", "Tier 2", "Tier 3", "Tier 4"].every((tier) => selectedTierSet.value.has(tier))
);
const sourceLabel = computed(() => category.source.value === "database"
  ? copy.value.sourceDatabase
  : category.source.value === "mixed" ? copy.value.sourceMixed : copy.value.sourceSnapshot);
const searchStatus = computed(() => {
  if (searchError.value) return copy.value.searchInvalid;
  if (!category.searchDraft.value) return copy.value.searchAll;
  if (category.selection.value?.type === "category") return message("categoryReport.showingCategory", "Showing category: {category}", { category: displayCategory(category.selection.value.category || "") });
  if (category.selection.value?.type === "merchant") return message("categoryReport.showingMerchant", "Showing merchant: {merchant}", { merchant: category.selection.value.merchantName || "" });
  return copy.value.searchHint;
});
const summaryCards = computed(() => [
  { key: "merchants", label: copy.value.merchants, value: formatCount(category.summary.value.merchantCount) },
  { key: "revenue", label: copy.value.revenue, value: formatMoney(category.summary.value.revenue) },
  { key: "orders", label: copy.value.orders, value: formatCount(category.summary.value.orders) },
  { key: "cvr", label: copy.value.cvr, value: formatPercent(category.summary.value.clicks ? category.summary.value.orders / category.summary.value.clicks : null) }
]);
const metricButtons = computed<readonly { key: CategoryReportSortKey; label: string }[]>(() => [
  { key: "revenue", label: copy.value.revenue },
  { key: "orders", label: copy.value.orders },
  { key: "clicks", label: copy.value.clicks },
  { key: "merchantCount", label: copy.value.merchants }
]);
const selectedMetricLabel = computed(() =>
  metricButtons.value.find((item) => item.key === category.sortKey.value)?.label || copy.value.revenue
);
const firstSlice = computed(() => category.pieSlices.value[0] || null);
const hoveredCategory = ref("");
const focusedCategory = ref("");
const highlightedCategory = computed(() => hoveredCategory.value || focusedCategory.value);
watch(category.pieSlices, () => { hoveredCategory.value = ""; focusedCategory.value = ""; });
const centerLabel = computed(() => !category.focusKey.value
  ? (props.language === "zh" ? "总营收" : "Total revenue")
  : category.focusKey.value === "other-categories" ? displayCategory("Other selected categories")
    : displayCategory(category.visibleGroups.value[0]?.category || ""));
function toggleCategoryList(): void {
  category.clearFocus();
  category.showAllCategories.value = !category.showAllCategories.value;
}

function slicePath(slice: CategoryPieSlice): string {
  if (slice.share <= 0) return "";
  const start = -slice.dashOffset / 100 * Math.PI * 2;
  const point = (angle: number) => `${50 + 40 * Math.cos(angle)} ${50 + 40 * Math.sin(angle)}`;
  if (slice.share >= 1) return `M ${point(start)} A 40 40 0 1 1 ${point(start + Math.PI)} A 40 40 0 1 1 ${point(start + 2 * Math.PI)}`;
  return `M ${point(start)} A 40 40 0 ${slice.share > .5 ? 1 : 0} 1 ${point(start + slice.share * 2 * Math.PI)}`;
}

function formatCount(value: number): string {
  return (Number(value) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null): string {
  if (revenueHidden.value) return "••••••";
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1_000_000) return "$" + (numeric / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "M";
  if (Math.abs(numeric) >= 1_000) return "$" + (numeric / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "K";
  return "$" + numeric.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "-" : (value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
}

function formatEpc(value: number | null): string {
  if (revenueHidden.value) return "••••••";
  return value === null || !Number.isFinite(value) ? "-" : "$" + value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function tierLabel(tier: string): string {
  return tier === "BLACK TIER" ? copy.value.blackTier : tier;
}

function tierEntries(group: CategoryReportGroup): Array<[string, number]> {
  return Object.entries(group.tierBreakdown).sort(([left], [right]) =>
    left.localeCompare(right, undefined, { numeric: true })
  );
}

function tierColor(tier: string): string {
  return tier === "Tier 1" ? "#2f80ff"
    : tier === "Tier 2" ? "#17b978"
      : tier === "Tier 3" ? "#f59e0b"
        : tier === "Tier 4" ? "#ff6b4a" : "#6b7280";
}

function metricValue(group: CategoryReportGroup): number {
  const key = category.sortKey.value;
  if (key === "merchantCount" || key === "revenue" || key === "orders" || key === "clicks") return group[key];
  return group.revenue;
}

function metricText(group: CategoryReportGroup): string {
  const value = metricValue(group);
  return categoryPieMetricKey(category.sortKey.value) === "revenue" ? formatMoney(value) : formatCount(value);
}

function metricShare(group: CategoryReportGroup): string {
  const total = category.pieSlices.value.reduce((sum, slice) => sum + slice.value, 0);
  return total ? (metricValue(group) / total * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%" : "-";
}

function applySearch(): void {
  const draft = category.searchDraft.value.trim();
  const rawEntry = category.searchEntries.value.find(entry => entry.value.toLowerCase() === draft.toLowerCase());
  const localized = searchOptions.value.filter(entry => entry.displayValue.toLowerCase() === draft.toLowerCase());
  searchError.value = !category.applySearch(rawEntry?.value ?? (localized.length === 1 ? localized[0]?.value ?? draft : draft));
}

function clearSearch(): void {
  category.clearSearch();
  searchError.value = false;
}

function applyDateRange(): void {
  category.setDateRange(startDraft.value, endDraft.value);
  if (!category.rangeError.value) void category.loadSelectedTiers();
}

function selectMetric(key: CategoryReportSortKey): void {
  category.setSort(key);
}

function exportSlice(): void {
  if (!category.visibleGroups.value.length || !props.download) return;
  props.download({
    label: category.visibleGroups.value.length === 1 ? category.visibleGroups.value[0]!.category : copy.value.allCategories,
    rows: category.visibleGroups.value.flatMap(group => group.rows.map(row => row.raw))
  });
}

onMounted(() => {
  document.addEventListener("keydown", handleFullViewKey);
  if (props.autoLoad && props.loadTier) void category.loadSelectedTiers();
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleFullViewKey);
  if (fullView.value) document.body.style.overflow = previousBodyOverflow;
  category.dispose();
});
</script>

<template>
  <main class="category-page-modern" :class="{ 'is-revenue-hidden': revenueHidden }" data-page="category" :aria-busy="category.loading.value ? 'true' : 'false'">
    <header class="tier-header">
      <div>
        <h2>{{ copy.title }}</h2>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="category-revenue-actions">
      <span class="category-report-source" :class="'is-' + category.source.value">
        {{ copy.source }} · {{ sourceLabel }}
      </span>
      <button class="category-revenue-toggle" type="button" :aria-pressed="revenueHidden" :title="privacyHint" @click="revenueHidden = !revenueHidden">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /><path v-if="revenueHidden" d="m3 3 18 18" /></svg>
        {{ privacyLabel }}
      </button>
      </div>
    </header>

    <section class="panel table-panel dashboard-category-report" aria-label="Category-wise report">
      <div class="tier-category-header dashboard-category-report-header">
        <div>
          <h3>{{ copy.report }}</h3>
          <p>{{ copy.reportHelp }}</p>
        </div>
        <div class="dashboard-category-tier-picker" aria-label="Category report tier selection">
          <label class="checkbox-row dashboard-category-tier-option">
            <input
              type="checkbox"
              data-category-tier="all"
              :checked="allStandardSelected"
              @change="category.setAllTiers(($event.target as HTMLInputElement).checked)"
            />
            <span>{{ copy.allTiers }}</span>
          </label>
          <label
            v-for="tier in ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4', 'BLACK TIER']"
            :key="tier"
            class="checkbox-row dashboard-category-tier-option"
          >
            <input
              type="checkbox"
              :data-category-tier="tier"
              :checked="category.selectedTiers.value.includes(tier)"
              @change="category.toggleTier(tier, ($event.target as HTMLInputElement).checked)"
            />
            <span>{{ tierLabel(tier) }}</span>
          </label>
        </div>
      </div>

      <div class="dashboard-category-controls" aria-label="Category report controls">
        <label class="dashboard-category-search-field">
          <span>{{ copy.categoryMerchant }}</span>
          <input
            id="category-report-search"
            data-category-action="search"
            type="search"
            list="category-report-options"
            :value="searchDisplay"
            :placeholder="copy.searchPlaceholder"
            autocomplete="off"
            @input="category.setSearchDraft(($event.target as HTMLInputElement).value); searchError = false"
            @change="applySearch"
            @keydown.enter.prevent="applySearch"
          />
          <datalist id="category-report-options">
            <option
              v-for="entry in searchOptions"
              :key="entry.type + ':' + entry.value"
              :value="entry.displayValue"
              :label="entry.type === 'category' ? entry.value : message('categoryReport.merchantOption', 'Merchant')"
            />
          </datalist>
          <small class="dashboard-category-search-status" :class="{ error: searchError }">
            {{ searchStatus }}
          </small>
        </label>
        <div class="tier-date-range-field dashboard-category-date-field">
          <span>{{ copy.dateRange }}</span>
          <div class="tier-date-range-controls">
            <input v-model="startDraft" data-category-date="start" type="date" aria-label="Category report start date" />
            <span class="tier-date-range-separator" aria-hidden="true">–</span>
            <input v-model="endDraft" data-category-date="end" type="date" aria-label="Category report end date" />
            <button class="secondary-button tier-date-apply" data-category-action="apply-date" type="button" :disabled="category.loading.value" @click="applyDateRange">
              {{ copy.apply }}
            </button>
          </div>
          <small class="tier-date-status" :class="{ error: Boolean(category.rangeError.value), loading: category.loading.value }">
            {{ category.rangeError.value || (category.loading.value ? copy.loading : sourceLabel) }}
          </small>
        </div>
      </div>

      <div class="category-report-vue-body" aria-live="polite">
        <p v-if="Object.keys(category.errors.value).length" class="category-report-error" role="alert">
          {{ Object.values(category.errors.value)[0] }}
        </p>
        <dl class="dashboard-category-report-totals">
          <div v-for="card in summaryCards" :key="card.key">
            <dt>{{ card.label }}</dt>
            <dd :data-sensitive-revenue="card.key === 'revenue' ? '' : undefined" :aria-label="card.key === 'revenue' ? hiddenAmountLabel : undefined">{{ card.value }}</dd>
          </div>
        </dl>

        <section v-if="category.pieSlices.value.length" class="dashboard-category-pie" :class="{ 'category-pie-focused': Boolean(category.focusKey.value) }" aria-label="Category pie chart">
          <button v-if="category.focusKey.value" class="category-focus-back" data-category-action="clear-focus" type="button" @click="category.clearFocus">
            <span aria-hidden="true">←</span>
            <span>{{ copy.allCategories }}</span>
          </button>
          <div class="category-pie-visual" :style="{ '--leader-color': firstSlice?.color || '#2f80ff' }">
            <svg class="category-pie-svg" viewBox="-4 -4 108 108" role="group" :aria-label="message('categoryReport.metricMix', '{metric} mix by category', { metric: selectedMetricLabel })">
              <circle class="category-pie-track" cx="50" cy="50" r="40" />
              <g transform="rotate(-90 50 50)">
                <path
                  v-for="slice in category.pieSlices.value"
                  :key="slice.key"
                  class="category-pie-slice"
                  :class="{ 'is-highlighted': highlightedCategory === slice.key, 'is-muted': Boolean(highlightedCategory) && highlightedCategory !== slice.key }"
                  :d="slicePath(slice)"
                  fill="none"
                  :stroke="slice.color"
                  :data-category-highlight="slice.key"
                  :data-category-focus="slice.key"
                  :data-category-title="displayCategory(slice.label)"
                  :tabindex="slice.share > 0 ? 0 : -1"
                  role="button"
                  :aria-label="`${displayCategory(slice.label)}: ${metricText(slice.group)}`"
                  @mouseenter="hoveredCategory = slice.key"
                  @mouseleave="hoveredCategory = ''"
                  @focus="focusedCategory = slice.key"
                  @blur="focusedCategory = ''"
                  @click="category.setFocus(slice.key)"
                  @keydown.enter="category.setFocus(slice.key)"
                  @keydown.space.prevent="category.setFocus(slice.key)"
                >
                  <title>{{ displayCategory(slice.label) }}: {{ metricText(slice.group) }} / {{ (slice.share * 100).toFixed(1) }}%</title>
                </path>
              </g>
            </svg>
            <div class="category-pie-spotlight">
              <strong>{{ category.focusKey.value ? copy.revenue : centerLabel }}</strong>
              <span data-sensitive-revenue :aria-label="hiddenAmountLabel">{{ formatMoney(category.summary.value.revenue) }}</span>
              <small>{{ centerLabel }}</small>
            </div>
          </div>
          <div class="category-pie-copy">
            <h4>{{ message("categoryReport.metricMix", "{metric} mix by category", { metric: selectedMetricLabel }) }}</h4>
            <p>{{ message("categoryReport.categoriesFrom", "{count} categories from {tiers}.", { count: category.visibleGroups.value.length, tiers: category.selectedTierText.value }) }}</p>
            <button type="button" class="category-list-toggle" :aria-expanded="category.showAllCategories.value" aria-controls="category-distribution-list" @click="toggleCategoryList">{{ category.showAllCategories.value ? (language === 'zh' ? '收起为主要品类' : 'Show major categories') : (language === 'zh' ? '展开全部品类' : 'Show all categories') }}</button>
            <p class="category-distribution-hint">{{ language === 'zh' ? '主要视图显示占比至少 2% 的前 7 个品类，其余合并为其他；展开后包含零营收品类。' : 'Major view shows up to 7 categories with at least 2% share; the rest are grouped as Other. Expand to include zero-revenue categories.' }}</p>
            <ul id="category-distribution-list" class="category-pie-legend" :class="{ 'is-expanded': category.showAllCategories.value }" aria-label="Category legend">
              <li
                v-for="slice in category.pieSlices.value"
                :key="'legend-' + slice.key"
                :class="{ 'is-highlighted': highlightedCategory === slice.key, 'is-muted': Boolean(highlightedCategory) && highlightedCategory !== slice.key }"
                :style="{ '--category-color': slice.color, '--category-tint': slice.tint }"
                :data-category-highlight="slice.key"
                :data-category-focus="slice.key"
                tabindex="0"
                role="button"
                @mouseenter="hoveredCategory = slice.key"
                @mouseleave="hoveredCategory = ''"
                @focus="focusedCategory = slice.key"
                @blur="focusedCategory = ''"
                @click="category.setFocus(slice.key)"
                @keydown.enter="category.setFocus(slice.key)"
                @keydown.space.prevent="category.setFocus(slice.key)"
              >
                <span class="category-pie-swatch" aria-hidden="true" />
                <strong>{{ displayCategory(slice.label) }}</strong>
                <span><span :data-sensitive-revenue="categoryPieMetricKey(category.sortKey.value) === 'revenue' ? '' : undefined" :aria-label="categoryPieMetricKey(category.sortKey.value) === 'revenue' ? hiddenAmountLabel : undefined">{{ metricText(slice.group) }}</span> / {{ (slice.share * 100).toFixed(1) }}%</span>
              </li>
            </ul>
            <div v-if="firstSlice" class="category-pie-actions" :style="{ '--category-color': firstSlice.color, '--category-tint': firstSlice.tint }">
              <button class="category-focus-export" data-category-action="export" type="button" :disabled="!props.download" :title="copy.exportHint" @click="exportSlice">
                {{ category.focusKey.value ? copy.export : (language === 'zh' ? '导出全部当前品类' : 'Export all visible categories') }}
              </button>
              <span>{{ message("categoryReport.categoryRows", "{category}: {count} rows in selected tiers", { category: category.focusKey.value ? centerLabel : copy.allCategories, count: formatCount(category.visibleGroups.value.reduce((sum, group) => sum + group.rowCount, 0)) }) }}</span>
            </div>
          </div>
        </section>
        <section v-else class="category-report-empty" role="status">
          {{ copy.noData }}
        </section>

        <section v-if="category.visibleGroups.value.length" class="category-optimization-previews" aria-label="Category optimization visual examples">
          <article class="category-idea-card category-idea-card-metrics">
            <div class="category-idea-heading">
              <span>{{ copy.metricLens }}</span>
              <strong>{{ copy.metricLensTitle }}</strong>
            </div>
            <div class="category-metric-pills" aria-label="Metric preview controls">
              <button
                v-for="metric in metricButtons"
                :key="metric.key"
                type="button"
                :class="{ active: category.sortKey.value === metric.key }"
                :data-category-sort="metric.key"
                @click="selectMetric(metric.key)"
              >{{ metric.label }}</button>
            </div>
            <ul class="category-preview-bars">
              <li v-for="group in category.visibleGroups.value.slice(0, 4)" :key="group.category" :style="{ '--category-color': categoryPalette(group.category).color }">
                <span>{{ displayCategory(group.category) }}</span>
                <strong :data-sensitive-revenue="categoryPieMetricKey(category.sortKey.value) === 'revenue' ? '' : undefined" :aria-label="categoryPieMetricKey(category.sortKey.value) === 'revenue' ? hiddenAmountLabel : undefined">{{ metricText(group) }}</strong>
                <i aria-hidden="true"><b :style="{ width: Math.max(5, metricShare(group) === '-' ? 5 : parseFloat(metricShare(group))) + '%' }" /></i>
              </li>
            </ul>
          </article>
          <article v-if="category.visibleGroups.value[0]" class="category-idea-card category-idea-card-drawer" :style="{ '--category-color': categoryPalette(category.visibleGroups.value[0].category).color, '--category-tint': categoryPalette(category.visibleGroups.value[0].category).tint }">
            <div class="category-idea-heading">
              <span>{{ copy.drawer }}</span>
              <strong>{{ displayCategory(category.visibleGroups.value[0].category) }}</strong>
            </div>
            <div class="category-drawer-preview">
              <dl>
                <div><dt>{{ copy.revenue }}</dt><dd data-sensitive-revenue :aria-label="hiddenAmountLabel">{{ formatMoney(category.visibleGroups.value[0].revenue) }}</dd></div>
                <div><dt>{{ copy.cvr }}</dt><dd>{{ formatPercent(category.visibleGroups.value[0].avgCvr) }}</dd></div>
                <div><dt>{{ copy.orders }}</dt><dd>{{ formatCount(category.visibleGroups.value[0].orders) }}</dd></div>
              </dl>
              <ul>
                <li v-for="row in category.visibleGroups.value[0].rows.slice(0, 4)" :key="row.key">
                  <span>{{ row.merchantName || "-" }}</span>
                  <strong data-sensitive-revenue :aria-label="hiddenAmountLabel">{{ formatMoney(row.revenue) }}</strong>
                </li>
              </ul>
            </div>
          </article>
          <article v-if="category.visibleGroups.value[0]" class="category-idea-card category-idea-card-tier">
            <div class="category-idea-heading">
              <span>{{ copy.tierMixCard }}</span>
              <strong>{{ copy.readableDistribution }}</strong>
            </div>
            <div class="category-tier-mix category-tier-mix-large">
              <div class="category-tier-mix-bar" aria-hidden="true">
                <span v-for="[tier, count] in tierEntries(category.visibleGroups.value[0])" :key="tier" :style="{ width: (count / category.visibleGroups.value[0].rowCount * 100).toFixed(2) + '%', '--tier-color': tierColor(tier) }" />
              </div>
              <div class="category-tier-mix-labels">
                <span v-for="[tier, count] in tierEntries(category.visibleGroups.value[0])" :key="'label-' + tier" :style="{ '--tier-color': tierColor(tier) }"><i aria-hidden="true" />{{ tierLabel(tier) }} {{ formatCount(count) }}</span>
              </div>
            </div>
            <p>{{ message("categoryReport.categoryRows", "{category}: {count} rows in selected tiers", { category: displayCategory(category.visibleGroups.value[0].category), count: formatCount(category.visibleGroups.value[0].rowCount) }) }}</p>
          </article>
        </section>

        <Teleport v-if="fullView || category.visibleGroups.value.length" to="body" :disabled="!fullView">
        <div class="category-page-modern category-records-view" :class="{ 'is-full-view': fullView, 'is-revenue-hidden': revenueHidden }" data-modern-root>
        <section ref="recordsPanel" class="dashboard-category-records" :role="fullView ? 'dialog' : 'region'" :aria-modal="fullView ? 'true' : undefined" aria-labelledby="category-records-title">
          <div class="dashboard-category-table-toolbar">
            <div class="dashboard-category-table-heading">
              <span class="dashboard-category-table-kicker">{{ copy.tableKicker }}</span>
              <h3 id="category-records-title">{{ copy.tableTitle }}</h3>
              <p>{{ copy.tableHelp }}</p>
            </div>
            <div class="dashboard-category-table-actions">
            <div class="dashboard-category-table-meta" data-category-table-count>
              <strong>{{ formatCount(category.visibleGroups.value.length) }}</strong>
              <span>{{ copy.categoriesInView }}</span>
            </div>
            <button ref="fullViewButton" class="category-full-view-button" type="button" :aria-expanded="fullView" @click="toggleFullView">
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path :d="fullView ? 'M9 3v6H3m18 0h-6V3M3 15h6v6m6 0v-6h6' : 'M9 3H3v6m12-6h6v6M3 15v6h6m6 0h6v-6'" /></svg>
              {{ fullView ? copy.exitFullView : copy.fullView }}
            </button>
            <button v-if="fullView" class="category-revenue-toggle" type="button" :aria-pressed="revenueHidden" :title="privacyHint" @click="revenueHidden = !revenueHidden">{{ privacyLabel }}</button>
            </div>
          </div>
          <div ref="recordsScroll" class="table-wrap tier-category-table-wrap dashboard-category-table-wrap" tabindex="0" :aria-label="copy.tableTitle">
            <table class="sheet-table tier-category-table dashboard-category-report-table">
            <thead>
              <tr>
                <th v-for="column in [
                  ['category', copy.category],
                  ['merchantCount', copy.merchants],
                  ['revenue', copy.revenue],
                  ['orders', copy.orders],
                  ['clicks', copy.clicks],
                  ['avgCvr', copy.cvr],
                  ['avgEpc', 'EPC'],
                  ['avgAov', 'AOV']
                ]" :key="column[0]">
                  <button class="table-sort-button" :class="{ active: category.sortKey.value === column[0] }" :data-category-sort="column[0]" type="button" @click="selectMetric(column[0] as CategoryReportSortKey)">
                    <span>{{ column[1] }}</span>
                    <span class="sort-indicator" aria-hidden="true">{{ category.sortKey.value === column[0] ? (category.sortDirection.value === 'asc' ? '↑' : '↓') : '↕' }}</span>
                  </button>
                </th>
                <th>{{ copy.topMerchants }}</th>
                <th>{{ copy.tierMix }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!category.visibleGroups.value.length"><td colspan="10">{{ copy.noRows }}</td></tr>
              <template v-for="group in category.visibleGroups.value" :key="group.category">
                <tr
                  class="dashboard-category-row"
                  :class="{ 'category-expanded': category.expandedKey.value === categoryKey(group.category) }"
                  data-category-action="toggle-expanded"
                  :data-category-highlight="categoryKey(group.category)"
                  tabindex="0"
                  :aria-expanded="category.expandedKey.value === categoryKey(group.category)"
                  @click="category.toggleExpanded(categoryKey(group.category))"
                  @keydown.enter="category.toggleExpanded(categoryKey(group.category))"
                  @keydown.space.prevent="category.toggleExpanded(categoryKey(group.category))"
                >
                  <td>
                    <span class="category-expand-chevron" aria-hidden="true">›</span>
                    <strong class="category-name-chip" :title="group.category" :style="{ '--category-color': categoryPalette(group.category).color, '--category-tint': categoryPalette(group.category).tint }">
                      <span class="category-dot" aria-hidden="true" />
                      {{ displayCategory(group.category) }}
                    </strong>
                    <span class="category-rank-bar" aria-hidden="true"><span :style="{ width: Math.max(4, group.revenue / Math.max(...category.visibleGroups.value.map((item) => item.revenue), 1) * 100) + '%', '--category-color': categoryPalette(group.category).color }" /></span>
                  </td>
                  <td>{{ formatCount(group.merchantCount) }}</td>
                  <td data-sensitive-revenue :aria-label="hiddenAmountLabel">{{ formatMoney(group.revenue) }}</td>
                  <td>{{ formatCount(group.orders) }}</td>
                  <td>{{ formatCount(group.clicks) }}</td>
                  <td>{{ formatPercent(group.avgCvr) }}</td>
                  <td data-sensitive-revenue :aria-label="hiddenAmountLabel">{{ formatEpc(group.avgEpc) }}</td>
                  <td data-sensitive-revenue :aria-label="hiddenAmountLabel">{{ formatMoney(group.avgAov) }}</td>
                  <td>{{ group.previewMerchants || "-" }}</td>
                  <td>
                    <div class="category-tier-mix" :aria-label="message('categoryReport.categoryTierMix', '{category} tier mix', { category: displayCategory(group.category) })">
                      <div class="category-tier-mix-bar" aria-hidden="true">
                        <span v-for="[tier, count] in tierEntries(group)" :key="tier" :style="{ width: (count / group.rowCount * 100).toFixed(2) + '%', '--tier-color': tierColor(tier) }" />
                      </div>
                      <div class="category-tier-mix-labels">
                        <span v-for="[tier, count] in tierEntries(group)" :key="'table-' + tier" :style="{ '--tier-color': tierColor(tier) }"><i aria-hidden="true" />{{ tierLabel(tier) }} {{ formatCount(count) }}</span>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr v-if="category.expandedKey.value === categoryKey(group.category)" class="category-expanded-detail">
                  <td colspan="10">
                    <div class="category-detail-scroll">
                      <table class="category-detail-inner-table">
                        <thead><tr><th>{{ copy.merchantId }}</th><th>Tier</th><th>{{ copy.revenue }}</th><th>{{ copy.orders }}</th><th>{{ copy.clicks }}</th><th>EPC</th><th>CVR</th><th>AOV</th></tr></thead>
                        <tbody>
                          <tr v-for="row in group.rows" :key="'detail-' + row.key" class="category-detail-merchant-row">
                            <td><strong>{{ row.merchantName || "-" }}</strong><br /><small>{{ row.merchantId || "-" }}</small></td>
                            <td>{{ tierLabel(row.tier) }}</td>
                            <td data-sensitive-revenue :aria-label="hiddenAmountLabel">{{ formatMoney(row.revenue) }}</td>
                            <td>{{ formatCount(row.orders) }}</td>
                            <td>{{ formatCount(row.clicks) }}</td>
                            <td data-sensitive-revenue :aria-label="hiddenAmountLabel">{{ formatEpc(row.epc) }}</td>
                            <td>{{ formatPercent(row.cvr) }}</td>
                            <td data-sensitive-revenue :aria-label="hiddenAmountLabel">{{ formatMoney(row.aov) }}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
            </table>
          </div>
        </section>
        </div>
        </Teleport>
        <p v-else class="category-report-empty">{{ copy.noRows }}</p>
      </div>
    </section>
  </main>
</template>
