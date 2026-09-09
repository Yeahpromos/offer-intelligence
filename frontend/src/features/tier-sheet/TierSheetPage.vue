<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

import { tierCategoryLabel, tierHeaderLabel, tierStatusLabel } from "./tierSheetLabels";
import DatePicker from "../../shared/components/DatePicker.vue";
import { translateMessage, type I18nMessageValues, type UiLanguage } from "../../shared/i18n";
import {
  formatTierCell,
  TIER_NAMES,
  type TierName,
  type TierSheetReportData
} from "./tierSheetModel";
import {
  useTierSheet,
  type SharedTierMoveLoader,
  type SharedTierMoveSaver,
  type Tier1AdditionsLoader,
  type Tier1MerchantAddLoader,
  type Tier1MerchantSearchLoader,
  type TierReportLoader,
  type TierStorage
} from "./useTierSheet";

export interface TierExportPayload {
  readonly tier: TierName;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly headers: readonly string[];
  readonly sheets?: readonly TierExportSheetPayload[];
}

export interface TierExportSheetPayload {
  readonly sheetName: string;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly headers: readonly string[];
}

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly reportData?: TierSheetReportData;
  readonly initialTier?: string;
  readonly today?: () => Date;
  readonly autoLoad?: boolean;
  readonly storage?: TierStorage;
  readonly loadTier?: TierReportLoader;
  readonly loadSharedMoves?: SharedTierMoveLoader;
  readonly saveSharedMoves?: SharedTierMoveSaver;
  readonly loadTier1Additions?: Tier1AdditionsLoader;
  readonly searchTier1Merchants?: Tier1MerchantSearchLoader;
  readonly addTier1Merchant?: Tier1MerchantAddLoader;
  readonly download?: (payload: TierExportPayload) => void;
}>(), {
  reportData: () => ({ sheets: [] }),
  initialTier: "Tier 1",
  today: undefined,
  autoLoad: true,
  storage: undefined,
  loadTier: undefined,
  loadSharedMoves: undefined,
  saveSharedMoves: undefined,
  loadTier1Additions: undefined,
  searchTier1Merchants: undefined,
  addTier1Merchant: undefined,
  download: undefined
});

const tier = useTierSheet({
  reportData: props.reportData,
  initialTier: props.initialTier,
  today: props.today,
  autoLoad: false,
  storage: props.storage,
  loadTier: props.loadTier,
  loadSharedMoves: props.loadSharedMoves,
  saveSharedMoves: props.saveSharedMoves,
  loadTier1Additions: props.loadTier1Additions,
  searchTier1Merchants: props.searchTier1Merchants,
  addTier1Merchant: props.addTier1Merchant
});

const startDraft = ref(tier.startDate.value);
const endDraft = ref(tier.endDate.value);
const selectedTierSheet = computed(() => {
  const sheets = Array.isArray(props.reportData?.sheets) ? props.reportData.sheets : [];
  return sheets.find((sheet) => String(sheet.name || sheet.sheetName || "").trim().toLowerCase() === tier.selectedTier.value.toLowerCase()) || null;
});
const selectedTierTitle = computed(() => String(selectedTierSheet.value?.title || tier.selectedTier.value));
const selectedTierIntro = computed(() => {
  const rows = selectedTierSheet.value?.introRows;
  if (!Array.isArray(rows)) return [];
  const typedRows: readonly (readonly unknown[])[] = rows;
  return typedRows.map((row) => row.map((value: unknown) => String(value ?? "").trim()).filter(Boolean).join(" / ")).filter(Boolean).slice(0, 6);
});
const isDateTier = computed(() => tier.selectedTier.value !== "BLACK TIER");
const sourceLabel = computed(() => tier.source.value === "database"
  ? message("tierSheet.sourceDatabase", "YeahPromos DB")
  : tier.source.value === "mixed" ? message("tierSheet.sourceMixed", "Snapshot + database") : message("tierSheet.sourceSnapshot", "Sheet snapshot"));
const summaryCards = computed(() => [
  { label: message("tierSheet.merchants", "Brand Count"), value: shortNumber(tier.summary.value.merchantCount) },
  { label: message("tierSheet.clicks", "Total Clicks"), value: shortNumber(tier.summary.value.clicks) },
  { label: message("tierSheet.orders", "Order Count"), value: shortNumber(tier.summary.value.orders) },
  { label: message("tierSheet.revenue", "Revenue"), value: shortMoney(tier.summary.value.revenue) },
  { label: message("tierSheet.conversion", "Avg Conversion"), value: formatPercent(tier.summary.value.avgConversion) }
]);
const tierLabel = (name: TierName): string => name === "BLACK TIER"
  ? message("tierSheet.blackTier", "Black Tier")
  : name;
const hasData = computed(() => Boolean(tier.allHeaders.value.length || tier.rows.value.length));
const tableMinWidth = computed(() => `${Math.min(2600, Math.max(1200, tier.displayHeaders.value.length * 130))}px`);
const firstCategory = computed(() => tier.categorySummaries.value[0] || null);
const allVisibleSelected = computed(() => tier.allVisibleSelected.value);

function message(key: string, fallback: string, values: I18nMessageValues = {}): string {
  return translateMessage(props.language, key, fallback, values);
}

const rangeErrorLabel = computed(() => {
  const keys: Record<string, string> = { "Use a valid date.": "invalidDate", "Start date must be before end date.": "reversedDate", "Date range cannot exceed 366 days.": "longRange" };
  const error = tier.rangeError.value;
  return keys[error] ? message(`tierSheet.${keys[error]}`, error) : error;
});

function shortNumber(value: number): string {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1_000_000) return (numeric / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "M";
  if (Math.abs(numeric) >= 1_000) return (numeric / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "K";
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function shortMoney(value: number): string {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1_000_000) return "$" + (numeric / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "M";
  if (Math.abs(numeric) >= 1_000) return "$" + (numeric / 1_000).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "K";
  return "$" + numeric.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return (Number(value) * 100).toLocaleString("en-US", { maximumFractionDigits: 2 }) + "%";
}

function formatCell(row: Readonly<Record<string, unknown>>, header: string): string {
  const value = formatTierCell(tier.selectedTier.value, row, header);
  return header.toLowerCase() === "category" ? tierCategoryLabel(props.language, value) : value;
}

const TIER_CATEGORY_EXPORT_HEADERS = [
  "Category", "Merchant Count", "Row Count", "Revenue", "Orders", "Clicks",
  "Avg Conversion", "Avg EPC", "AOV", "Top Merchant", "Top Merchants"
] as const;

const TIER_OFFER_LIST_EXPORT_HEADERS = [
  "Merchant ID", "Merchant Name", "Category", "Avg Commission Rate"
] as const;

function recordText(record: Readonly<Record<string, unknown>>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function offerRowsForMerchant(merchantId: string): readonly Readonly<Record<string, unknown>>[] {
  if (!merchantId || !Array.isArray(props.reportData?.offers)) return [];
  return props.reportData.offers.filter((offer): offer is Readonly<Record<string, unknown>> => {
    if (typeof offer !== "object" || offer === null || Array.isArray(offer)) return false;
    const row = offer as Readonly<Record<string, unknown>>;
    return recordText(row, ["merchantId", "merchant_id", "Merchant ID", "id"]).replace(/\.0$/, "") === merchantId;
  });
}

function averageCommissionRate(merchantId: string): string {
  const rates = offerRowsForMerchant(merchantId)
    .map((offer) => Number(offer.commissionRate ?? offer.commission_rate))
    .filter((rate) => Number.isFinite(rate));
  if (!rates.length) return "";
  return `${Math.ceil(rates.reduce((sum, rate) => sum + rate, 0) / rates.length * 100)}%`;
}

function offerCategory(merchantId: string, fallback: string): string {
  const category = offerRowsForMerchant(merchantId)
    .map((offer) => recordText(offer, ["category", "mainCategory", "sheetCategory", "Category", "Main Category"]))
    .find(Boolean);
  return category || fallback || "Uncategorized";
}

function rowClass(row: { readonly visualStatus: string }): string {
  const status = row.visualStatus.toLowerCase();
  return ["green", "yellow", "red"].includes(status) ? `tier-highlight-row tier-highlight-${status}` : "";
}

function tierMixEntries(category: Readonly<Record<string, number>>): Array<[string, number]> {
  return Object.entries(category).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
}

function applyDateRange(): void {
  tier.setDateRange(startDraft.value, endDraft.value);
  if (!tier.rangeError.value) void tier.loadSelectedTier();
}

function selectTier(next: TierName): void {
  tier.selectTier(next);
  startDraft.value = tier.startDate.value;
  endDraft.value = tier.endDate.value;
  if (props.autoLoad && props.loadTier) void tier.loadSelectedTier();
}

function exportRows(): void {
  if (!props.download) return;
  const selectedRows = tier.sortedRows.value;
  const rows = selectedRows.map((row) => row.raw);
  const categoryRows = tier.categorySummaries.value.map((category) => ({
    "Category": category.category,
    "Merchant Count": category.merchantCount,
    "Row Count": category.rowCount,
    "Revenue": category.revenue,
    "Orders": category.orders,
    "Clicks": category.clicks,
    "Avg Conversion": category.avgConversion,
    "Avg EPC": category.avgEpc,
    "AOV": category.avgAov,
    "Top Merchant": category.topMerchant,
    "Top Merchants": category.previewMerchants
  }));
  const offerListRows = selectedRows.map((row) => ({
    "Merchant ID": row.merchantId,
    "Merchant Name": row.merchantName,
    "Category": offerCategory(row.merchantId, row.category),
    "Avg Commission Rate": averageCommissionRate(row.merchantId)
  }));
  props.download({
    tier: tier.selectedTier.value,
    rows,
    headers: tier.displayHeaders.value,
    sheets: [
      { sheetName: tier.selectedTier.value, rows, headers: tier.displayHeaders.value },
      { sheetName: "Category Summary", rows: categoryRows, headers: TIER_CATEGORY_EXPORT_HEADERS },
      { sheetName: "Offer List", rows: offerListRows, headers: TIER_OFFER_LIST_EXPORT_HEADERS }
    ]
  });
}

function moveRowSelection(event: Event, key: string): void {
  tier.toggleRowSelection(key, (event.target as HTMLInputElement).checked);
}

function searchMerchant(): void {
  void tier.searchMerchants();
}

onMounted(() => {
  if (props.autoLoad) {
    if (props.loadSharedMoves) void tier.loadSharedMoves();
    if (props.loadTier) void tier.loadSelectedTier();
    if (props.loadTier1Additions && tier.selectedTier.value === "Tier 1") void tier.loadAdditions();
  }
});

onUnmounted(() => tier.dispose());
</script>

<template>
  <main class="tier-page-modern" data-page="tier" :aria-busy="tier.loading.value ? 'true' : 'false'">
    <header class="tier-header">
      <div>
        <h2>{{ selectedTierTitle }}</h2>
        <p>{{ message("tierSheet.subtitle", "Google Sheet report view") }}</p>
      </div>
      <div class="tier-modern-header-actions">
        <span class="tier-report-source" :class="'is-' + tier.source.value">{{ message("tierSheet.source", "Source") }} · {{ sourceLabel }}</span>
        <div v-if="tier.selectedTier.value === 'Tier 1'" class="tier1-management-actions">
          <button class="tier1-additions-toggle" type="button" :aria-expanded="tier.additionsOpen.value ? 'true' : 'false'" @click="tier.openAdditions">
            <span class="tier1-info-mark" aria-hidden="true">i</span>
            <span>{{ message("tierSheet.addedMerchants", "Added merchants") }}</span>
            <span class="tier1-additions-count">{{ tier.additions.value.length }}</span>
          </button>
          <button class="tier1-add-merchant-button" type="button" @click="tier.openMerchantDialog">
            <span aria-hidden="true">+</span>{{ message("tierSheet.addMerchant", "Add merchant") }}
          </button>
        </div>
      </div>
    </header>

    <nav class="tier-modern-tabs" :aria-label="message('tierSheet.navLabel', 'Tier pages')">
      <button
        v-for="name in TIER_NAMES"
        :key="name"
        type="button"
        :class="{ active: tier.selectedTier.value === name }"
        :data-tier-tab="name"
        :data-tier-select="name"
        :aria-current="tier.selectedTier.value === name ? 'page' : undefined"
        @click="selectTier(name)"
      >{{ tierLabel(name) }}</button>
    </nav>

    <section class="tier-summary" :aria-label="message('tierSheet.summaryLabel', 'Tier summary')">
      <div v-for="card in summaryCards" :key="card.label" class="metric">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }}</strong>
      </div>
    </section>

    <section class="panel sheet-notes" :aria-label="message('tierSheet.notesLabel', 'Tier assignment notes')">
      <div class="logic-summary">
        <div>
          <strong>{{ selectedTierTitle }}</strong>
          <p>{{ selectedTierIntro[1] || message("tierSheet.notes", "Tier assignments and metadata are loaded from the offer database.") }}</p>
        </div>
        <div v-if="selectedTierIntro.length > 2" class="logic-list">
          <span v-for="line in selectedTierIntro.slice(2)" :key="line">{{ line }}</span>
        </div>
      </div>
    </section>

    <section class="panel tier-category-summary" :aria-label="message('tierSheet.categoryReport', 'Category-wise tier report')">
      <div class="tier-category-header">
        <div>
          <h3>{{ message("tierSheet.categoryReport", "Category-wise report") }}</h3>
          <p>{{ message("tierSheet.categoryCount", "{rows} rows / {categories} categories", { rows: tier.filteredRows.value.length, categories: tier.categorySummaries.value.length }) }}</p>
        </div>
        <dl>
          <div><dt>{{ message("tierSheet.merchants", "Merchants") }}</dt><dd>{{ tier.summary.value.merchantCount.toLocaleString() }}</dd></div>
          <div><dt>{{ message("tierSheet.revenue", "Revenue") }}</dt><dd>{{ shortMoney(tier.summary.value.revenue) }}</dd></div>
          <div><dt>{{ message("tierSheet.orders", "Orders") }}</dt><dd>{{ tier.summary.value.orders.toLocaleString() }}</dd></div>
          <div><dt>{{ message("tierSheet.conversion", "CVR") }}</dt><dd>{{ formatPercent(tier.summary.value.avgConversion) }}</dd></div>
        </dl>
      </div>
      <div class="table-wrap tier-category-table-wrap">
        <table class="sheet-table tier-category-table">
          <thead><tr><th>{{ message("tierSheet.category", "Category") }}</th><th>{{ message("tierSheet.merchants", "Merchants") }}</th><th>{{ message("tierSheet.revenue", "Revenue") }}</th><th>{{ message("tierSheet.orders", "Orders") }}</th><th>{{ message("tierSheet.conversion", "CVR") }}</th><th>EPC</th><th>{{ message("tierSheet.topMerchant", "Top merchant") }}</th></tr></thead>
          <tbody>
            <tr v-for="category in tier.categorySummaries.value" :key="category.category">
              <td><strong>{{ tierCategoryLabel(language, category.category) }}</strong><p>{{ category.previewMerchants || '-' }}</p></td>
              <td>{{ category.merchantCount.toLocaleString() }}</td>
              <td>{{ shortMoney(category.revenue) }}</td>
              <td>{{ category.orders.toLocaleString() }}</td>
              <td>{{ category.avgConversion === null ? '-' : formatPercent(category.avgConversion) }}</td>
              <td>{{ category.avgEpc === null ? '-' : '$' + category.avgEpc.toFixed(2) }}</td>
              <td>{{ category.topMerchant || '-' }}</td>
            </tr>
            <tr v-if="!tier.categorySummaries.value.length"><td colspan="7">{{ message("tierSheet.noCategoryRows", "No category rows match the current filters.") }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel tier-sheet-filters" :aria-label="message('tierSheet.filtersLabel', 'Tier filters')">
      <label>
        <span>{{ message("tierSheet.search", "Search") }}</span>
        <input type="search" data-tier-action="search" :value="tier.filters.value.search" :placeholder="message('tierSheet.searchPlaceholder', 'Merchant, ID, reason, recommendation')" @input="tier.setFilter('search', ($event.target as HTMLInputElement).value)" />
      </label>
      <div class="tier-date-range-field">
        <span>{{ message("tierSheet.dateRange", "Date / range") }}</span>
        <small id="tier-date-status" role="status" aria-live="polite" class="tier-date-status" :class="{ error: Boolean(tier.rangeError.value), loading: tier.loading.value }">{{ rangeErrorLabel || (tier.loading.value ? message("tierSheet.loading", "Loading YeahPromos data…") : sourceLabel) }}</small>
        <div class="tier-date-range-controls">
          <DatePicker v-model="startDraft" data-tier-date="start" aria-describedby="tier-date-status" :aria-invalid="Boolean(tier.rangeError.value)" :language="language" :today="today" :disabled="!isDateTier || tier.loading.value" :label="message('tierSheet.startDate', 'Start date')" />
          <span class="tier-date-range-separator" aria-hidden="true">–</span>
          <DatePicker v-model="endDraft" data-tier-date="end" aria-describedby="tier-date-status" :aria-invalid="Boolean(tier.rangeError.value)" :language="language" :today="today" :disabled="!isDateTier || tier.loading.value" :label="message('tierSheet.endDate', 'End date')" />
          <button class="secondary-button tier-date-apply" data-tier-action="date-apply" type="button" :disabled="!isDateTier || tier.loading.value" @click="applyDateRange">{{ message("tierSheet.apply", "Apply") }}</button>
        </div>
      </div>
      <label>
        <span>{{ message("tierSheet.networkAgency", "Network / Agency") }}</span>
        <select data-tier-filter="network" :value="tier.filters.value.network" @change="tier.setFilter('network', ($event.target as HTMLSelectElement).value)"><option value="all">{{ message("tierSheet.allNetworks", "All networks") }}</option><option v-for="network in tier.availableNetworks.value" :key="network" :value="network">{{ network }}</option></select>
      </label>
      <label>
        <span>{{ message("tierSheet.country", "Country") }}</span>
        <select data-tier-filter="country" :value="tier.filters.value.country" @change="tier.setFilter('country', ($event.target as HTMLSelectElement).value)"><option value="all">{{ message("tierSheet.allCountries", "All countries") }}</option><option v-for="country in tier.availableCountries.value" :key="country" :value="country">{{ country }}</option></select>
      </label>
      <label><span>{{ message("tierSheet.minEpc", "Min EPC") }}</span><input type="number" step="0.01" min="0" placeholder="0.00" :value="tier.filters.value.minEpc" @input="tier.setFilter('minEpc', ($event.target as HTMLInputElement).value)" /></label>
      <label><span>{{ message("tierSheet.minRevenue", "Min revenue") }}</span><input type="number" step="1" min="0" placeholder="0" :value="tier.filters.value.minRevenue" @input="tier.setFilter('minRevenue', ($event.target as HTMLInputElement).value)" /></label>
      <button class="secondary-button tier-filter-reset" data-tier-action="reset-filters" type="button" @click="tier.resetFilters">{{ message("tierSheet.reset", "Reset") }}</button>
    </section>

    <section class="table-panel tier-table-panel" :class="{ 'sheet-expanded-panel': tier.expanded.value }" aria-label="Tier table" :role="tier.expanded.value ? 'dialog' : undefined" :aria-modal="tier.expanded.value ? 'true' : undefined">
      <div class="table-toolbar">
        <div>
          <h3>{{ selectedTierTitle }} {{ message("tierSheet.records", "Sheet Records") }}</h3>
          <p>{{ message("tierSheet.recordCount", "{rows} rows / showing {start}–{end} / {visible} of {total} columns", { rows: tier.sortedRows.value.length, start: tier.pagination.value.totalRows ? tier.pagination.value.startIndex + 1 : 0, end: tier.pagination.value.endIndex, visible: tier.displayHeaders.value.length, total: tier.allHeaders.value.length }) }}</p>
          <nav v-if="tier.selectedTier.value === 'Tier 4'" class="tier-pagination" :aria-label="message('tierSheet.navLabel', 'Tier 4 pages')">
            <button class="secondary-button" type="button" :disabled="tier.pagination.value.page <= 1" @click="tier.setPage(tier.pagination.value.page - 1)">{{ message("tierSheet.previous", "Previous") }}</button>
            <span>{{ message("tierSheet.pageCount", "Page {page} of {total}", { page: tier.pagination.value.page, total: tier.pagination.value.totalPages }) }}</span>
            <button class="secondary-button" type="button" :disabled="tier.pagination.value.page >= tier.pagination.value.totalPages" @click="tier.setPage(tier.pagination.value.page + 1)">{{ message("tierSheet.next", "Next") }}</button>
          </nav>
        </div>
        <div class="table-toolbar-actions">
          <div class="column-picker">
            <button class="icon-button table-select-button" type="button" data-tier-action="columns" :aria-expanded="tier.columnPanelOpen.value ? 'true' : 'false'" @click="tier.columnPanelOpen.value = !tier.columnPanelOpen.value">{{ message("tierSheet.columnsButton", "Display") }}</button>
            <div class="column-picker-panel" :class="{ hidden: !tier.columnPanelOpen.value }">
              <div class="column-picker-header"><strong>{{ message("tierSheet.columnsTitle", "Display columns") }}</strong><span>{{ message("tierSheet.columnsHint", "Choose fields to display") }}</span></div>
              <div class="column-picker-actions"><button type="button" @click="tier.resetVisibleHeaders">{{ message("tierSheet.coreColumns", "Default") }}</button><button type="button" @click="tier.setVisibleHeaders(tier.allHeaders.value)">{{ message("tierSheet.allColumns", "All") }}</button></div>
              <div class="column-picker-list">
                <label v-for="header in tier.allHeaders.value" :key="header" class="column-check"><input type="checkbox" :checked="tier.displayHeaders.value.includes(header)" @change="tier.setVisibleHeaders(Array.from(new Set([...tier.displayHeaders.value.filter((item) => item !== header), ...(($event.target as HTMLInputElement).checked ? [header] : [])])))" /><span>{{ tierHeaderLabel(language, header) }}</span></label>
              </div>
            </div>
          </div>
          <button class="icon-button table-move-button" type="button" data-tier-action="move" :disabled="!tier.selectedCount.value" @click="tier.openMoveDialog">{{ message("tierSheet.move", "Move") }}</button>
          <button v-if="Object.keys(tier.manualMoves.value).length" class="icon-button table-reset-moves-button" data-tier-action="reset-moves" type="button" :disabled="tier.moveSyncing.value" @click="tier.resetMoves">{{ message("tierSheet.resetMoves", "Reset") }}</button>
          <button v-if="!tier.expanded.value" class="icon-button table-expand-button" type="button" data-tier-action="expand" :disabled="tier.selectedTier.value === 'BLACK TIER'" @click="tier.openOverlay">{{ message("tierSheet.expand", "Expand") }}</button>
          <button v-else class="icon-button table-close-button" type="button" data-tier-action="close-overlay" @click="tier.closeOverlay">{{ message("tierSheet.close", "Close") }}</button>
          <button class="icon-button table-download-button" data-tier-action="download" type="button" :disabled="!tier.sortedRows.value.length" @click="exportRows">{{ message("tierSheet.download", "Download") }}</button>
          <span class="tier-move-inline-status" aria-live="polite">{{ tierStatusLabel(language, tier.moveStatus.value) }}</span>
        </div>
      </div>
      <div class="table-wrap sheet-table-wrap">
        <table class="sheet-table" :style="{ minWidth: tableMinWidth }">
          <thead><tr><th class="tier-select-cell"><input class="tier-row-checkbox" type="checkbox" data-tier-select-all :checked="allVisibleSelected" :indeterminate.prop="tier.visibleSelectedCount.value > 0 && !allVisibleSelected" :disabled="!tier.visibleRows.value.length" :aria-label="message('tierSheet.selectAll', 'Select all visible merchants')" @change="tier.selectAllVisible(($event.target as HTMLInputElement).checked)" /></th><th v-for="header in tier.displayHeaders.value" :key="header" scope="col" :aria-sort="tier.sortKey.value === header ? (tier.sortDirection.value === 'asc' ? 'ascending' : 'descending') : 'none'"><button class="table-sort-button" :class="{ active: tier.sortKey.value === header }" type="button" :data-tier-sort="header" @click="tier.setSort(header)"><span>{{ tierHeaderLabel(language, header) }}</span><span class="sort-indicator" aria-hidden="true">{{ tier.sortKey.value === header ? (tier.sortDirection.value === 'asc' ? '▲' : '▼') : '↕' }}</span></button></th></tr></thead>
          <tbody>
            <tr v-for="row in tier.visibleRows.value" :key="row.key" :class="[rowClass(row), { 'is-selected': tier.selectedKeys.value.has(row.key) }]" :data-tier-row-key="row.key">
              <td class="tier-select-cell"><input class="tier-row-checkbox" type="checkbox" :data-tier-select-row="row.key" :checked="tier.selectedKeys.value.has(row.key)" :aria-label="message('tierSheet.selectMerchant', 'Select merchant {name}', { name: row.merchantName || row.merchantId })" @change="moveRowSelection($event, row.key)" /></td>
              <td v-for="header in tier.displayHeaders.value" :key="header" :data-tier-column="header">{{ formatCell(row.raw, header) }}</td>
            </tr>
            <tr v-if="!tier.visibleRows.value.length"><td :colspan="tier.displayHeaders.value.length + 1">{{ hasData ? message("tierSheet.empty", "No rows match the current filters.") : message("tierSheet.noData", "No tier data is available.") }}</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="tier.expanded.value" class="sheet-expanded-backdrop" aria-hidden="false" @click="tier.closeOverlay" />

    <div v-if="tier.moveDialogOpen.value" class="tier-move-dialog" role="dialog" aria-modal="true" :aria-label="message('tierSheet.moveTitle', 'Move selected merchants')">
      <div class="tier-move-card">
        <div class="tier-move-header"><div><h3>{{ message("tierSheet.moveTitle", "Move selected merchants") }}</h3><p>{{ message("tierSheet.selectedCount", "{count} selected from {tier}", { count: tier.selectedCount.value, tier: tierLabel(tier.selectedTier.value) }) }}</p></div><button class="icon-button tier-move-close" type="button" @click="tier.closeMoveDialog">{{ message("tierSheet.close", "Close") }}</button></div>
        <div class="tier-move-targets" :aria-label="message('tierSheet.targetLabel', 'Move target tier')"><button v-for="name in TIER_NAMES" :key="name" class="tier-move-target" :class="{ active: tier.moveTarget.value === name }" :data-tier-move-target="name" :disabled="name === tier.selectedTier.value" type="button" @click="tier.setMoveTarget(name)"><span>{{ tierLabel(name) }}</span><small>{{ name === tier.selectedTier.value ? message("tierSheet.currentTier", "Current tier") : '' }}</small></button></div>
        <p class="tier-move-status" :aria-busy="tier.moveSyncing.value ? 'true' : 'false'">{{ tierStatusLabel(language, tier.moveStatus.value) }}</p>
        <div class="tier-move-footer"><button class="secondary-button" type="button" :disabled="tier.moveSyncing.value" @click="tier.closeMoveDialog">{{ message("tierSheet.cancel", "Cancel") }}</button><button class="secondary-button tier-move-confirm" data-tier-action="confirm-move" type="button" :disabled="!tier.moveTarget.value || tier.moveSyncing.value" @click="tier.moveSelectedRows">{{ tier.moveSyncing.value ? message("tierSheet.saving", "Saving…") : message("tierSheet.confirmMove", "Move merchants") }}</button></div>
      </div>
    </div>

    <div v-if="tier.additionsOpen.value" class="tier1-additions-overlay" role="dialog" aria-modal="true" :aria-label="message('tierSheet.additionsTitle', 'Tier 1 migration history')" @click.self="tier.closeAdditions">
      <section class="tier1-additions-panel"><div class="tier1-additions-header"><div><span class="tier1-additions-eyebrow">{{ message("tierSheet.historyEyebrow", "Tier 1 / database history") }}</span><h3>{{ message("tierSheet.additionsTitle", "Merchant migration history") }}</h3></div><button class="tier1-additions-close" type="button" @click="tier.closeAdditions">{{ message("tierSheet.close", "Close") }}</button></div><p class="tier1-additions-status">{{ tier.additionsLoading.value ? message("tierSheet.loading", "Loading…") : tier.additionsError.value }}</p><div class="tier1-additions-list"><div v-if="!tier.additions.value.length && !tier.additionsLoading.value" class="tier1-additions-empty">{{ message("tierSheet.noAdditions", "No merchants have been added through this tool yet.") }}</div><article v-for="merchant in tier.additions.value" :key="merchant.merchantId" class="tier1-addition-row"><strong>{{ merchant.merchantName || merchant.merchantId }}<small>ID {{ merchant.merchantId }}</small></strong><span>{{ merchant.network || message('common.unknown', 'Unknown') }}</span><span>{{ merchant.currentTier || 'Tier 1' }}</span></article></div></section>
    </div>

    <div v-if="tier.merchantDialogOpen.value" class="tier1-merchant-dialog" role="dialog" aria-modal="true" :aria-label="message('tierSheet.addMerchantTitle', 'Add merchant to Tier 1')" @click.self="tier.closeMerchantDialog">
      <div class="tier1-merchant-card"><div class="tier1-merchant-header"><div><h3>{{ message("tierSheet.addMerchantTitle", "Add merchant to Tier 1") }}</h3><p>{{ message("tierSheet.addMerchantHint", "Find an active merchant in the YeahPromos database, review the match, then confirm the assignment.") }}</p></div><button class="tier1-merchant-close" type="button" @click="tier.closeMerchantDialog">{{ message("tierSheet.close", "Close") }}</button></div>
        <form class="tier1-merchant-search-form" @submit.prevent="searchMerchant"><label><span>{{ message("tierSheet.merchantIdName", "Merchant ID or merchant name") }}</span><div class="tier1-merchant-search-row"><input v-model="tier.merchantQuery.value" type="search" autocomplete="off" :placeholder="message('tierSheet.merchantPlaceholder', 'Enter a merchant ID or name')" /><button type="submit" :disabled="tier.merchantLoading.value">{{ message("tierSheet.findMerchant", "Find merchant") }}</button></div></label></form>
        <p class="tier1-merchant-status" :class="{ error: tier.merchantStatus.value.includes('No ') || tier.merchantStatus.value.includes('Enter ') }">{{ tierStatusLabel(language, tier.merchantStatus.value) }}</p>
        <div class="tier1-merchant-results" role="group" :aria-label="message('tierSheet.findMerchant', 'Find merchant')"><button v-for="merchant in tier.merchantResults.value" :key="merchant.merchantId" class="tier1-merchant-result" type="button" :disabled="merchant.currentTier === 'Tier 1'" @click="tier.selectMerchant(merchant.merchantId)"><strong>{{ merchant.merchantName || merchant.merchantId }}<small>ID {{ merchant.merchantId }}</small></strong><span>{{ merchant.network || message('common.unknown', 'Unknown') }}</span><span>{{ merchant.currentTier || message('tierSheet.unassigned', 'Not assigned') }}</span></button></div>
        <section v-if="tier.selectedMerchant.value" class="tier1-merchant-confirmation"><div class="tier1-confirmation-heading"><div><span>{{ message("tierSheet.confirmMerchant", "Confirm merchant") }}</span><h4>{{ tier.selectedMerchant.value.merchantName || tier.selectedMerchant.value.merchantId }}</h4></div><button type="button" @click="tier.selectedMerchant.value = null">{{ message("tierSheet.changeSelection", "Change selection") }}</button></div><dl class="tier1-confirmation-details"><div><dt>{{ message("tierSheet.merchantId", "Merchant ID") }}</dt><dd>{{ tier.selectedMerchant.value.merchantId }}</dd></div><div><dt>{{ message("tierSheet.network", "Network") }}</dt><dd>{{ tier.selectedMerchant.value.network || message('common.unknown', 'Unknown') }}</dd></div><div><dt>{{ message("tierSheet.currentTier", "Current tier") }}</dt><dd>{{ tier.selectedMerchant.value.currentTier || message('tierSheet.unassigned', 'Not assigned') }}</dd></div></dl></section>
        <div class="tier1-merchant-footer"><button class="secondary-button" type="button" @click="tier.closeMerchantDialog">{{ message("tierSheet.cancel", "Cancel") }}</button><button class="tier1-merchant-confirm" type="button" :disabled="!tier.selectedMerchant.value || tier.selectedMerchant.value.currentTier === 'Tier 1' || tier.merchantSubmitting.value" @click="tier.addMerchant">{{ message("tierSheet.addToTier1", "Add to Tier 1") }}</button></div>
      </div>
    </div>
  </main>
</template>
