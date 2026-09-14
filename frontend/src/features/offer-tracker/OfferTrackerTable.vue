<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import { formatMoney } from "../../shared/format/money";
import { formatInteger } from "../../shared/format/number";
import { formatPercentage } from "../../shared/format/percentage";
import { translateMessage } from "../../shared/i18n";
import type {
  OfferTrackerColumnVisibility,
  OfferTrackerOptionalColumn,
  OfferTrackerRow,
  OfferTrackerRules,
  OfferTrackerSelectionSummary,
  OfferTrackerView,
  UiLanguage
} from "../../shared/contracts/offer";
import {
  DEFAULT_OFFER_TRACKER_RULES,
  aovTypeLabel,
  bbPolicyLabel,
  normalizeOfferTrackerRules,
  priorityLabel
} from "./offerTrackerModel";

type OptionalColumnKey = OfferTrackerOptionalColumn;
type PanelName = "columns" | "rules" | null;

const DEFAULT_VISIBLE_COLUMNS: Readonly<Record<OptionalColumnKey, boolean>> = Object.freeze({
  tier: true,
  commission: true,
  aov: true,
  revenue: true,
  bbPolicy: true,
  category: true,
  asins: true,
  recommendation: true
});

const PRODUCT_HIDDEN_COLUMNS = new Set<OptionalColumnKey>(["tier", "commission", "recommendation"]);
const OFFER_TRACKER_COLUMNS_STORAGE_KEY = "offerListTrackerColumnsV1";

const props = defineProps<{
  rows: readonly OfferTrackerRow[];
  totalRows: number;
  page: number;
  totalPages: number;
  pageSize: number;
  selectedKeys: ReadonlySet<string>;
  summary: OfferTrackerSelectionSummary;
  view: OfferTrackerView;
  search: string;
  rules: OfferTrackerRules;
  language: UiLanguage;
}>();

const emit = defineEmits<{
  (event: "update:search", value: string): void;
  (event: "toggle-row", key: string, selected: boolean): void;
  (event: "toggle-page", selected: boolean): void;
  (event: "toggle-all"): void;
  (event: "page-change", page: number): void;
  (event: "view-change", view: OfferTrackerView): void;
  (event: "rules-change", rules: OfferTrackerRules): void;
  (event: "columns-change", columns: OfferTrackerColumnVisibility): void;
}>();

const isProductsView = computed(() => props.view === "products");
const visibleColumns = ref<Record<OptionalColumnKey, boolean>>({ ...DEFAULT_VISIBLE_COLUMNS });
watch(visibleColumns, columns => emit("columns-change", { ...columns }), { immediate: true });
const openPanel = ref<PanelName>(null);
const draftHighScore = ref(DEFAULT_OFFER_TRACKER_RULES.highScore);
const draftLowAovMax = ref(DEFAULT_OFFER_TRACKER_RULES.lowAovMax);
const copy = computed(() => {
  const message = (key: string, fallback: string) => translateMessage(props.language, key, fallback);
  return {
    selected: message("offerTracker.selected", "已选择"),
    selectAll: message("offerTracker.selectAll", "选择全部匹配"),
    clearAll: message("offerTracker.clearAll", "清除匹配选择"),
    currentPage: message("offerTracker.currentPage", "选择当前页"),
    offersView: message("offerTracker.offersView", "Offers 视图"),
    productsView: message("offerTracker.productsView", "产品视图"),
    productTab: props.language === "zh"
      ? message("offerTracker.productList", "品牌产品清单")
      : message("offerTracker.productsView", "Products view"),
    offerTab: props.language === "zh"
      ? message("offerTracker.offerList", "Offer 清单")
      : message("offerTracker.offersView", "Offers view"),
    search: message("offerTracker.search", "搜索 Offer"),
    searchPlaceholder: message("offerTracker.searchPlaceholder", "搜索商家或 ID"),
    priority: message("offerTracker.priority", "优先级"),
    merchant: message("offerTracker.tableMerchant", props.language === "zh" ? "商家" : "Merchant"),
    tier: message("offerTracker.tableTier", props.language === "zh" ? "层级" : "Tier"),
    commission: message("offerTracker.commission", "AFF 佣金"),
    aov: message("offerTracker.aov", "AOV"),
    revenue: message("offerTracker.revenue", "REVENUE"),
    bbPolicy: message("offerTracker.tableBbPolicy", props.language === "zh" ? "是否介意 BB" : "BB Preference"),
    category: message("offerTracker.category", "品类"),
    recommendation: message("offerTracker.tableRecommendation", props.language === "zh" ? "推荐信息" : "Recommendation"),
    topAsins: message("offerTracker.topAsins", "Revenue-first ASINs · Top 5"),
    topAsinsHelp: message("offerTracker.topAsinsHelp", "Rank by period revenue; fill remaining slots by ASIN code."),
    columns: message("offerTracker.columns", "列设置"),
    visibleColumns: message("offerTracker.visibleColumns", props.language === "zh" ? "显示列" : "Visible columns"),
    priorityRules: message("offerTracker.priorityRules", "优先级规则"),
    rulesSubtitle: message("offerTracker.rulesSubtitle", props.language === "zh" ? "使用透明评分对导出内容分组。" : "A transparent score groups the export."),
    highScore: message("offerTracker.highScore", props.language === "zh" ? "高优先级最低分" : "High priority score"),
    lowAovCeiling: message("offerTracker.lowAovCeiling", props.language === "zh" ? "低 AOV 上限" : "Low-AOV ceiling"),
    resetRules: message("offerTracker.resetRules", props.language === "zh" ? "重置规则" : "Reset rules"),
    saveRules: message("offerTracker.saveRules", props.language === "zh" ? "保存规则" : "Save rules"),
    tierLegend: props.language === "zh" ? "层级：Tier 1 +4 / Tier 2 +3 / Tier 3 +2 / Tier 4 +1" : "Tier: T1 +4 / T2 +3 / T3 +2 / T4 +1",
    commissionLegend: props.language === "zh" ? "AFF 佣金：≥20% +4 / ≥15% +3 / ≥10% +2 / ≥5% +1" : "AFF Commission: ≥20% +4 / ≥15% +3 / ≥10% +2 / ≥5% +1",
    aovLegend: props.language === "zh" ? "AOV：$75–$350 +2 / >$350 +1；有 ASIN +1" : "AOV: $75–$350 +2 / >$350 +1; ASIN coverage +1",
    close: message("common.close", props.language === "zh" ? "关闭" : "Close"),
    empty: message("offerTracker.empty", "没有符合当前筛选条件的 Offer，请调整筛选条件。"),
    previous: message("offerTracker.previous", "上一页"),
    next: message("offerTracker.next", "下一页"),
    results: message("offerTracker.results", "Offer Tracker 结果"),
    pagination: message("offerTracker.pagination", "Offer Tracker 分页"),
    selectRow: message("offerTracker.selectRow", "选择"),
    unknown: message("common.unknown", "未知")
  };
});

const columnOptions = computed<readonly { key: OptionalColumnKey; label: string }[]>(() => {
  const message = (key: string, fallback: string) => translateMessage(props.language, key, fallback);
  const options: readonly { key: OptionalColumnKey; label: string }[] = [
    { key: "tier", label: message("offerTracker.tableTier", props.language === "zh" ? "层级" : "Tier") },
    { key: "commission", label: message("offerTracker.commission", "AFF 佣金") },
    { key: "aov", label: message("offerTracker.aov", "AOV") },
    { key: "revenue", label: message("offerTracker.revenue", "Revenue") },
    { key: "bbPolicy", label: message("offerTracker.tableBbPolicy", props.language === "zh" ? "是否介意 BB" : "BB Preference") },
    { key: "category", label: message("offerTracker.category", "品类") },
    { key: "asins", label: message("offerTracker.topAsins", "Top Rank ASINs") },
    { key: "recommendation", label: message("offerTracker.tableRecommendation", props.language === "zh" ? "推荐信息" : "Recommendation") }
  ];
  return isProductsView.value ? options.filter((column) => !PRODUCT_HIDDEN_COLUMNS.has(column.key)) : options;
});

const visibleColumnCount = computed(() => {
  const optionalCount = columnOptions.value.reduce(
    (count, column) => count + (visibleColumns.value[column.key] !== false ? 1 : 0),
    0
  );
  return 2 + optionalCount;
});

function isColumnVisible(key: OptionalColumnKey): boolean {
  return !PRODUCT_HIDDEN_COLUMNS.has(key) || !isProductsView.value
    ? visibleColumns.value[key] !== false
    : false;
}

function togglePanel(panel: Exclude<PanelName, null>): void {
  openPanel.value = openPanel.value === panel ? null : panel;
}

function setColumnVisibility(key: OptionalColumnKey, value: boolean): void {
  visibleColumns.value = { ...visibleColumns.value, [key]: value };
  try {
    window.localStorage.setItem(OFFER_TRACKER_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns.value));
  } catch (_error) {
    // 本地存储不可用时仍保留当前页面状态。
  }
}

function saveRules(): void {
  emit("rules-change", normalizeOfferTrackerRules({
    highScore: draftHighScore.value,
    lowAovMax: draftLowAovMax.value
  }));
  openPanel.value = null;
}

function resetRules(): void {
  draftHighScore.value = DEFAULT_OFFER_TRACKER_RULES.highScore;
  draftLowAovMax.value = DEFAULT_OFFER_TRACKER_RULES.lowAovMax;
}

onMounted(() => {
  try {
    const stored = window.localStorage.getItem(OFFER_TRACKER_COLUMNS_STORAGE_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const next = { ...DEFAULT_VISIBLE_COLUMNS };
    (Object.keys(DEFAULT_VISIBLE_COLUMNS) as OptionalColumnKey[]).forEach((key) => {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "boolean") next[key] = value;
    });
    visibleColumns.value = next;
  } catch (_error) {
    visibleColumns.value = { ...DEFAULT_VISIBLE_COLUMNS };
  }
});

watch(
  () => [props.rules.highScore, props.rules.lowAovMax] as const,
  ([highScore, lowAovMax]) => {
    draftHighScore.value = highScore;
    draftLowAovMax.value = lowAovMax;
  }
);

function checked(event: Event): boolean {
  return event.target instanceof HTMLInputElement && event.target.checked;
}

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

function rangeLabel(): string {
  if (!props.totalRows) return translateMessage(props.language, "offerTracker.rangeEmpty", "0 个 Offer");
  const start = (props.page - 1) * props.pageSize + 1;
  const end = Math.min(props.page * props.pageSize, props.totalRows);
  return translateMessage(props.language, "offerTracker.range", "显示第 {start}–{end} 条，共 {total} 个 Offer", {
    start: formatInteger(start),
    end: formatInteger(end),
    total: formatInteger(props.totalRows)
  });
}

function selectedLabel(): string {
  return translateMessage(props.language, "offerTracker.selectedCount", "已选择 {count} 个", {
    count: formatInteger(props.summary.selectedCount)
  });
}

function recommendation(row: OfferTrackerRow): string {
  if (row.priority.key === "high") return props.language === "zh" ? "优先联系并安排推广" : "Prioritize outreach and placement";
  if (row.priority.key === "low-aov") return props.language === "zh" ? "适合低客单价测试" : "Good fit for low-AOV testing";
  return props.language === "zh" ? "进入常规机会池" : "Keep in the standard opportunity pool";
}
</script>

<template>
  <section class="offer-tracker-modern-table-panel offer-tracker-table-panel" :aria-label="copy.results">
    <div class="offer-tracker-table-toolbar table-toolbar">
      <div class="offer-tracker-view-tabs" role="tablist" :aria-label="copy.results">
        <button
          type="button"
          :class="{ active: view === 'offers' }"
          :aria-label="copy.offersView"
          :aria-selected="view === 'offers' ? 'true' : 'false'"
          role="tab"
          @click="emit('view-change', 'offers')"
        >{{ copy.offerTab }}</button>
        <button
          type="button"
          :class="{ active: view === 'products' }"
          :aria-label="copy.productsView"
          :aria-selected="view === 'products' ? 'true' : 'false'"
          role="tab"
          @click="emit('view-change', 'products')"
        >{{ copy.productTab }}</button>
      </div>

      <div class="offer-tracker-table-actions">
        <label class="offer-tracker-search">
          <span class="sr-only">{{ copy.search }}</span>
          <input
            :value="search"
            type="search"
            :aria-label="copy.search"
            :placeholder="copy.searchPlaceholder"
            autocomplete="off"
            @input="emit('update:search', inputValue($event))"
          >
        </label>
        <button
          type="button"
          class="offer-tracker-select-all"
          :aria-label="summary.allFilteredSelected ? copy.clearAll : copy.selectAll"
          :aria-pressed="summary.allFilteredSelected ? 'true' : 'false'"
          :disabled="!totalRows"
          @click="emit('toggle-all')"
        >
          <input type="checkbox" tabindex="-1" :checked="summary.allFilteredSelected" aria-hidden="true">
          <span>{{ summary.allFilteredSelected ? copy.clearAll : copy.selectAll }}</span>
          <b>{{ formatInteger(totalRows) }}</b>
        </button>
        <div class="offer-tracker-menu-wrap">
          <button
            type="button"
            class="offer-tracker-table-tool-button"
            :aria-label="copy.columns"
            aria-controls="offerTrackerColumnsPanel"
            :aria-expanded="openPanel === 'columns' ? 'true' : 'false'"
            @click="togglePanel('columns')"
          >▥ <span>{{ copy.columns }}</span></button>
          <section
            v-if="openPanel === 'columns'"
            id="offerTrackerColumnsPanel"
            class="offer-tracker-popover offer-tracker-columns-panel"
            :aria-label="copy.visibleColumns"
          >
            <div class="offer-tracker-popover-header">
              <strong>{{ copy.visibleColumns }}</strong>
              <button type="button" :aria-label="copy.close" @click="openPanel = null">×</button>
            </div>
            <label v-for="column in columnOptions" :key="column.key" class="offer-tracker-column-option">
              <input
                :id="`offerTrackerColumn-${column.key}`"
                type="checkbox"
                :data-offer-tracker-column="column.key"
                :checked="visibleColumns[column.key] !== false"
                @change="setColumnVisibility(column.key, checked($event))"
              >
              <span>{{ column.label }}</span>
            </label>
          </section>
        </div>
        <div class="offer-tracker-menu-wrap">
          <button
            type="button"
            class="offer-tracker-table-tool-button"
            :aria-label="copy.priorityRules"
            aria-controls="offerTrackerRulesPanel"
            :aria-expanded="openPanel === 'rules' ? 'true' : 'false'"
            @click="togglePanel('rules')"
          >⌘ <span>{{ copy.priorityRules }}</span></button>
          <section
            v-if="openPanel === 'rules'"
            id="offerTrackerRulesPanel"
            class="offer-tracker-popover offer-tracker-rules-panel"
            :aria-label="copy.priorityRules"
          >
            <div class="offer-tracker-popover-header">
              <div>
                <strong>{{ copy.priorityRules }}</strong>
                <small>{{ copy.rulesSubtitle }}</small>
              </div>
              <button type="button" :aria-label="copy.close" @click="openPanel = null">×</button>
            </div>
            <div class="offer-tracker-score-legend">
              <span>{{ copy.tierLegend }}</span>
              <span>{{ copy.commissionLegend }}</span>
              <span>{{ copy.aovLegend }}</span>
            </div>
            <label class="offer-tracker-rule-field">
              <span>{{ copy.highScore }}</span>
              <input id="offerTrackerHighScore" v-model.number="draftHighScore" type="number" min="4" max="11" step="1">
            </label>
            <label class="offer-tracker-rule-field">
              <span>{{ copy.lowAovCeiling }}</span>
              <span class="offer-tracker-money-input"><b>$</b><input id="offerTrackerLowAovMax" v-model.number="draftLowAovMax" type="number" min="1" step="1"></span>
            </label>
            <div class="offer-tracker-rule-actions">
              <button type="button" :aria-label="copy.resetRules" @click="resetRules">{{ copy.resetRules }}</button>
              <button type="button" class="offer-tracker-popover-primary" :aria-label="copy.saveRules" @click="saveRules">{{ copy.saveRules }}</button>
            </div>
          </section>
        </div>
      </div>
    </div>

    <div class="offer-tracker-table-scroll offer-tracker-table-wrap">
      <table class="offer-tracker-table">
        <thead>
          <tr>
            <th scope="col" data-column="priority">
              <span class="offer-tracker-priority-cell">
                <input
                  type="checkbox"
                  :aria-label="copy.currentPage"
                  :checked="summary.allPageSelected"
                  :disabled="!rows.length"
                  @change="emit('toggle-page', checked($event))"
                >
                <span>{{ copy.priority }}</span>
              </span>
            </th>
            <th scope="col" data-column="merchant">{{ copy.merchant }}</th>
            <th v-if="isColumnVisible('tier')" scope="col" data-column="tier">{{ copy.tier }}</th>
            <th v-if="isColumnVisible('commission')" scope="col" data-column="commission">{{ copy.commission }}</th>
            <th v-if="isColumnVisible('aov')" scope="col" data-column="aov">{{ copy.aov }}</th>
            <th v-if="isColumnVisible('revenue')" scope="col" data-column="revenue">{{ copy.revenue }}</th>
            <th v-if="isColumnVisible('bbPolicy')" scope="col" data-column="bbPolicy">{{ copy.bbPolicy }}</th>
            <th v-if="isColumnVisible('category')" scope="col" data-column="category">{{ copy.category }}</th>
            <th v-if="isColumnVisible('asins')" scope="col" data-column="asins" :title="copy.topAsinsHelp" :aria-description="copy.topAsinsHelp">{{ copy.topAsins }}</th>
            <th v-if="isColumnVisible('recommendation')" scope="col" data-column="recommendation">{{ copy.recommendation }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key" :data-row-key="row.key" :class="{ 'is-selected': selectedKeys.has(row.key) }">
            <td data-column="priority">
              <div class="offer-tracker-priority-cell">
                <input
                  type="checkbox"
                  :data-row-select="row.key"
                  :aria-label="`${copy.selectRow} ${row.merchantName}`"
                  :checked="selectedKeys.has(row.key)"
                  @change="emit('toggle-row', row.key, checked($event))"
                >
                <span :class="['offer-tracker-priority-badge', row.priority.key]">{{ priorityLabel(row.priority.key, language) }}</span>
              </div>
            </td>
            <td data-column="merchant">
              <div class="offer-tracker-merchant-cell">
                <strong :title="row.merchantName">{{ row.merchantName }}</strong>
                <span>ID {{ row.merchantId || "—" }}</span>
              </div>
            </td>
            <td v-if="isColumnVisible('tier')" data-column="tier"><span class="offer-tracker-tier-badge">{{ row.tier || copy.unknown }}</span></td>
            <td v-if="isColumnVisible('commission')" data-column="commission"><span class="offer-tracker-number-cell">{{ formatPercentage(row.commissionRate) }}</span></td>
            <td v-if="isColumnVisible('aov')" data-column="aov">
              <span class="offer-tracker-number-cell">{{ row.aov > 0 ? formatMoney(row.aov) : "—" }}</span>
              <span :class="['offer-tracker-aov-type', row.aovType]">{{ aovTypeLabel(row.aovType, language) }}</span>
            </td>
            <td v-if="isColumnVisible('revenue')" data-column="revenue"><span class="offer-tracker-number-cell">{{ formatMoney(row.revenue) }}</span></td>
            <td v-if="isColumnVisible('bbPolicy')" data-column="bbPolicy"><span :class="['offer-tracker-bb-policy', row.bbPolicy]">{{ bbPolicyLabel(row.bbPolicy, language) }}</span></td>
            <td v-if="isColumnVisible('category')" data-column="category"><span class="offer-tracker-category-cell">{{ row.category }}</span></td>
            <td v-if="isColumnVisible('asins')" data-column="asins">
              <div v-if="row.asins.length" class="offer-tracker-asins">
                <span v-for="asin in row.asins" :key="asin" class="offer-tracker-asin">{{ asin }}</span>
              </div>
              <span v-else>—</span>
            </td>
            <td v-if="isColumnVisible('recommendation')" data-column="recommendation"><span class="offer-tracker-recommendation-cell">{{ recommendation(row) }}</span></td>
          </tr>
          <tr v-if="!rows.length" data-empty-state>
            <td :colspan="visibleColumnCount">{{ copy.empty }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="offer-tracker-table-footer">
      <div>
        <span>{{ rangeLabel() }}</span>
        <small>{{ selectedLabel() }}</small>
      </div>
      <div class="offer-tracker-table-footer-actions">
        <slot name="footer-actions" />
        <nav class="offer-tracker-pagination" :aria-label="copy.pagination">
          <button
            type="button"
            :aria-label="copy.previous"
            :disabled="page <= 1"
            @click="emit('page-change', page - 1)"
          >‹</button>
          <span>{{ translateMessage(language, "offerTracker.page", "第 {page} / {total} 页", { page, total: totalPages }) }}</span>
          <button
            type="button"
            :aria-label="copy.next"
            :disabled="page >= totalPages"
            @click="emit('page-change', page + 1)"
          >›</button>
        </nav>
      </div>
    </footer>
  </section>
</template>
