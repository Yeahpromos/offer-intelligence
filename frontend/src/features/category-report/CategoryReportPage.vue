<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";

import { translateMessage, type UiLanguage } from "../../shared/i18n";
import {
  categoryKey,
  categoryPalette,
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

function message(key: string, fallback: string): string {
  return translateMessage(props.language, key, fallback);
}

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
  if (category.selection.value?.type === "category") return "Showing category: " + category.selection.value.category;
  if (category.selection.value?.type === "merchant") return "Showing merchant: " + category.selection.value.merchantName;
  return copy.value.searchHint;
});
const summaryCards = computed(() => [
  { key: "merchants", label: copy.value.merchants, value: formatCount(category.summary.value.merchantCount) },
  { key: "revenue", label: copy.value.revenue, value: formatMoney(category.summary.value.revenue) },
  { key: "orders", label: copy.value.orders, value: formatCount(category.summary.value.orders) },
  { key: "cvr", label: copy.value.cvr, value: formatPercent(category.summary.value.clicks ? category.summary.value.orders / category.summary.value.clicks : null) }
]);
const metricButtons: readonly { key: CategoryReportSortKey; label: string }[] = [
  { key: "revenue", label: "Revenue" },
  { key: "orders", label: "Orders" },
  { key: "clicks", label: "Clicks" },
  { key: "merchantCount", label: "Merchants" }
];
const selectedMetricLabel = computed(() =>
  metricButtons.find((item) => item.key === category.sortKey.value)?.label || copy.value.revenue
);
const firstSlice = computed(() => category.pieSlices.value[0] || null);

function formatCount(value: number): string {
  return (Number(value) || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatMoney(value: number | null): string {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1_000_000) return "$" + (numeric / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "M";
  if (Math.abs(numeric) >= 1_000) return "$" + (numeric / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "K";
  return "$" + numeric.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "-" : (value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
}

function formatEpc(value: number | null): string {
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
  return category.sortKey.value === "revenue" ? formatMoney(value) : formatCount(value);
}

function metricShare(group: CategoryReportGroup): string {
  const total = category.pieSlices.value.reduce((sum, slice) => sum + slice.value, 0);
  return total ? (metricValue(group) / total * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%" : "-";
}

function applySearch(): void {
  searchError.value = !category.applySearch();
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
  const slice = firstSlice.value;
  if (!slice || !props.download) return;
  props.download({
    label: slice.label,
    rows: slice.group.rows.map((row) => row.raw)
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
  <main class="category-page-modern" data-page="category" :aria-busy="category.loading.value ? 'true' : 'false'">
    <header class="tier-header">
      <div>
        <h2>{{ copy.title }}</h2>
        <p>{{ copy.subtitle }}</p>
      </div>
      <span class="category-report-source" :class="'is-' + category.source.value">
        {{ copy.source }} · {{ sourceLabel }}
      </span>
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
            :value="category.searchDraft.value"
            :placeholder="copy.searchPlaceholder"
            autocomplete="off"
            @input="category.setSearchDraft(($event.target as HTMLInputElement).value); searchError = false"
            @change="applySearch"
            @keydown.enter.prevent="applySearch"
          />
          <datalist id="category-report-options">
            <option
              v-for="entry in category.searchEntries.value"
              :key="entry.type + ':' + entry.value"
              :value="entry.value"
              :label="entry.type === 'category' ? 'Category' : 'Merchant'"
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
            <dd>{{ card.value }}</dd>
          </div>
        </dl>

        <section v-if="category.pieSlices.value.length" class="dashboard-category-pie" :class="{ 'category-pie-focused': Boolean(category.focusKey.value) }" aria-label="Category pie chart">
          <button v-if="category.focusKey.value" class="category-focus-back" data-category-action="clear-focus" type="button" @click="category.clearFocus">
            <span aria-hidden="true">←</span>
            <span>{{ copy.allCategories }}</span>
          </button>
          <div class="category-pie-visual" :style="{ '--leader-color': firstSlice?.color || '#2f80ff' }">
            <svg class="category-pie-svg" viewBox="0 0 100 100" role="img" :aria-label="selectedMetricLabel + ' mix by category'">
              <circle class="category-pie-track" cx="50" cy="50" r="40" />
              <g transform="rotate(-90 50 50)">
                <circle
                  v-for="slice in category.pieSlices.value"
                  :key="slice.key"
                  class="category-pie-slice"
                  cx="50"
                  cy="50"
                  r="40"
                  pathLength="100"
                  :stroke="slice.color"
                  :stroke-dasharray="slice.dash.toFixed(4) + ' ' + (100 - slice.dash).toFixed(4)"
                  :stroke-dashoffset="slice.dashOffset.toFixed(4)"
                  :data-category-highlight="slice.key"
                  :data-category-focus="slice.key"
                  :data-category-title="slice.label"
                  tabindex="0"
                  role="button"
                  @click="category.setFocus(slice.key)"
                  @keydown.enter="category.setFocus(slice.key)"
                >
                  <title>{{ slice.label }}: {{ metricText(slice.group) }} / {{ (slice.share * 100).toFixed(1) }}%</title>
                </circle>
              </g>
            </svg>
            <div class="category-pie-spotlight">
              <strong>{{ selectedMetricLabel }}</strong>
              <span>{{ firstSlice ? metricText(firstSlice.group) : "-" }}</span>
              <small>{{ firstSlice ? firstSlice.label + " leads at " + (firstSlice.share * 100).toFixed(1) + "%" : "-" }}</small>
            </div>
          </div>
          <div class="category-pie-copy">
            <h4>{{ selectedMetricLabel }} mix by category</h4>
            <p>{{ category.pieSlices.value.length }} categories from {{ category.selectedTierText.value }}.</p>
            <ul class="category-pie-legend" aria-label="Category legend">
              <li
                v-for="slice in category.pieSlices.value"
                :key="'legend-' + slice.key"
                :style="{ '--category-color': slice.color, '--category-tint': slice.tint }"
                :data-category-highlight="slice.key"
                :data-category-focus="slice.key"
                tabindex="0"
                role="button"
                @click="category.setFocus(slice.key)"
                @keydown.enter="category.setFocus(slice.key)"
              >
                <span class="category-pie-swatch" aria-hidden="true" />
                <strong>{{ slice.label }}</strong>
                <span>{{ metricText(slice.group) }} / {{ (slice.share * 100).toFixed(1) }}%</span>
              </li>
            </ul>
            <div v-if="firstSlice" class="category-pie-actions" :style="{ '--category-color': firstSlice.color, '--category-tint': firstSlice.tint }">
              <button class="category-focus-export" data-category-action="export" type="button" :disabled="!props.download" :title="copy.exportHint" @click="exportSlice">
                {{ copy.export }}
              </button>
              <span>{{ firstSlice.label }}: {{ firstSlice.group.rowCount.toLocaleString() }} rows in selected tiers</span>
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
                <span>{{ group.category }}</span>
                <strong>{{ metricText(group) }}</strong>
                <i aria-hidden="true"><b :style="{ width: Math.max(5, metricShare(group) === '-' ? 5 : parseFloat(metricShare(group))) + '%' }" /></i>
              </li>
            </ul>
          </article>
          <article v-if="category.visibleGroups.value[0]" class="category-idea-card category-idea-card-drawer" :style="{ '--category-color': categoryPalette(category.visibleGroups.value[0].category).color, '--category-tint': categoryPalette(category.visibleGroups.value[0].category).tint }">
            <div class="category-idea-heading">
              <span>{{ copy.drawer }}</span>
              <strong>{{ category.visibleGroups.value[0].category }}</strong>
            </div>
            <div class="category-drawer-preview">
              <dl>
                <div><dt>{{ copy.revenue }}</dt><dd>{{ formatMoney(category.visibleGroups.value[0].revenue) }}</dd></div>
                <div><dt>{{ copy.cvr }}</dt><dd>{{ formatPercent(category.visibleGroups.value[0].avgCvr) }}</dd></div>
                <div><dt>{{ copy.orders }}</dt><dd>{{ formatCount(category.visibleGroups.value[0].orders) }}</dd></div>
              </dl>
              <ul>
                <li v-for="row in category.visibleGroups.value[0].rows.slice(0, 4)" :key="row.key">
                  <span>{{ row.merchantName || "-" }}</span>
                  <strong>{{ formatMoney(row.revenue) }}</strong>
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
            <p>{{ category.visibleGroups.value[0].category }} has {{ formatCount(category.visibleGroups.value[0].rowCount) }} sheet rows across the selected tiers.</p>
          </article>
        </section>

        <Teleport v-if="fullView || category.visibleGroups.value.length" to="body" :disabled="!fullView">
        <div class="category-page-modern category-records-view" :class="{ 'is-full-view': fullView }" data-modern-root>
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
                    <strong class="category-name-chip" :style="{ '--category-color': categoryPalette(group.category).color, '--category-tint': categoryPalette(group.category).tint }">
                      <span class="category-dot" aria-hidden="true" />
                      {{ group.category }}
                    </strong>
                    <span class="category-rank-bar" aria-hidden="true"><span :style="{ width: Math.max(4, group.revenue / Math.max(...category.visibleGroups.value.map((item) => item.revenue), 1) * 100) + '%', '--category-color': categoryPalette(group.category).color }" /></span>
                  </td>
                  <td>{{ formatCount(group.merchantCount) }}</td>
                  <td>{{ formatMoney(group.revenue) }}</td>
                  <td>{{ formatCount(group.orders) }}</td>
                  <td>{{ formatCount(group.clicks) }}</td>
                  <td>{{ formatPercent(group.avgCvr) }}</td>
                  <td>{{ formatEpc(group.avgEpc) }}</td>
                  <td>{{ formatMoney(group.avgAov) }}</td>
                  <td>{{ group.previewMerchants || "-" }}</td>
                  <td>
                    <div class="category-tier-mix" :aria-label="group.category + ' tier mix'">
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
                            <td>{{ formatMoney(row.revenue) }}</td>
                            <td>{{ formatCount(row.orders) }}</td>
                            <td>{{ formatCount(row.clicks) }}</td>
                            <td>{{ formatEpc(row.epc) }}</td>
                            <td>{{ formatPercent(row.cvr) }}</td>
                            <td>{{ formatMoney(row.aov) }}</td>
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
