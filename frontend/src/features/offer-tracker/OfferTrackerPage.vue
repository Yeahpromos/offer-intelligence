<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import type {
  OfferRecord,
  OfferTrackerDateRange,
  OfferTrackerExportPayload,
  OfferTrackerRules,
  OfferTrackerFilters as TrackerFilterState,
  OfferTrackerView,
  UiLanguage
} from "../../shared/contracts/offer";
import { translateMessage } from "../../shared/i18n";
import OfferTrackerFilters from "./OfferTrackerFilters.vue";
import OfferTrackerTable from "./OfferTrackerTable.vue";
import { useOfferTracker, type OfferTrackerLoader } from "./useOfferTracker";

const props = withDefaults(defineProps<{
  offers: readonly OfferRecord[];
  language: UiLanguage;
  defaultDateRange: OfferTrackerDateRange;
  download?: (payload: OfferTrackerExportPayload) => void;
  loadRange?: OfferTrackerLoader;
}>(), {
  download: undefined,
  loadRange: undefined
});

const tracker = useOfferTracker({
  offers: props.offers,
  defaultDateRange: props.defaultDateRange,
  loadRange: props.loadRange
});

const copy = computed(() => {
  const message = (key: string, fallback: string) => translateMessage(props.language, key, fallback);
  return {
    eyebrow: message("offerTracker.eyebrow", "Offer 规划工作台"),
    subtitle: message("offerTracker.subtitle", "按优先级生成 Offer 清单，并导出可直接分享的工作簿。"),
    offersView: message("offerTracker.offersView", "Offers 视图"),
    productsView: message("offerTracker.productsView", "产品视图"),
    savedViews: message("offerTracker.savedViews", "已保存视图"),
    saveView: message("offerTracker.saveView", "保存当前视图"),
    savedViewName: message("offerTracker.savedViewName", "视图名称"),
    save: message("common.save", "保存"),
    noSavedViews: message("offerTracker.noSavedViews", "暂无已保存视图"),
    exportExcel: message("offerTracker.exportExcel", props.language === "zh" ? "导出 Excel" : "Export current results"),
    matched: message("offerTracker.matched", "匹配 Offer"),
    matchedNote: message("offerTracker.matchedNote", "当前筛选范围"),
    high: message("offerTracker.high", "高优先级"),
    highNote: translateMessage(
      props.language,
      "offerTracker.highNote",
      props.language === "zh" ? "评分 ≥ {score}" : "Score ≥ {score}",
      { score: tracker.rules.value.highScore }
    ),
    recommended: message("offerTracker.recommended", "推荐"),
    recommendedNote: message("offerTracker.recommendedNote", "常规机会池"),
    lowAov: message("offerTracker.lowAov", "低 AOV 优选"),
    lowAovNote: translateMessage(
      props.language,
      "offerTracker.lowAovNote",
      "AOV ≤ {max}",
      { max: tracker.rules.value.lowAovMax }
    ),
    summary: message("offerTracker.summary", "Offer Tracker 摘要"),
    exportHint: message("offerTracker.exportHint", "选择后可只导出已选 Offer；导出沿用现有 XLSX 生成器。"),
    exportCurrent: message("offerTracker.exportCurrent", "导出当前筛选"),
    exportSelected: message("offerTracker.exportSelected", "导出已选择")
  };
});

const {
  draftFilters,
  search,
  view,
  loading,
  error,
  filteredRows,
  pageRows,
  pageData,
  pageSize,
  selectedKeys,
  selectionSummary,
  rules,
  availableTiers,
  availableCategories,
  availableNetworks
} = tracker;

type SavedTrackerView = {
  name: string;
  filters: TrackerFilterState;
  view: OfferTrackerView;
};

const savedViewOpen = ref(false);
const savedViewName = ref("");
const savedViews = ref<SavedTrackerView[]>([]);
const savedViewsStorageKey = "offerListTrackerSavedViewsV1";
const rulesStorageKey = "offerListTrackerRulesV1";

const priorityCounts = computed(() => filteredRows.value.reduce((counts, row) => {
  counts[row.priority.key] += 1;
  return counts;
}, { high: 0, recommended: 0, "low-aov": 0 }));

const errorMessage = computed(() => {
  if (!error.value) return "";
  if (props.language === "en") {
    if (error.value.startsWith("请选择有效日期")) return "Choose valid dates in order, covering no more than 366 days.";
    if (error.value === "最小值不能大于最大值。") return "The minimum cannot exceed the maximum.";
  }
  return props.language === "zh"
    ? error.value
    : translateMessage(props.language, "offerTracker.loadError", "Failed to load filtered data. Please try again.");
});

function emitDownload(selectedOnly: boolean): void {
  if (!props.download) return;
  props.download({
    rows: tracker.exportRows(selectedOnly),
    view: view.value,
    selectedOnly
  });
}

function persistSavedViews(): void {
  try {
    window.localStorage.setItem(savedViewsStorageKey, JSON.stringify(savedViews.value));
  } catch (_error) {
    // 本地存储不可用时仍保留当前会话中的视图。
  }
}

function saveCurrentView(): void {
  const name = savedViewName.value.trim() || `${copy.value.savedViews} ${savedViews.value.length + 1}`;
  savedViews.value = [
    ...savedViews.value.filter((item) => item.name !== name),
    { name, filters: { ...tracker.filters.value }, view: view.value }
  ].slice(-8);
  savedViewName.value = "";
  persistSavedViews();
}

function saveRules(nextRules: OfferTrackerRules): void {
  tracker.setRules(nextRules);
  try {
    window.localStorage.setItem(rulesStorageKey, JSON.stringify(nextRules));
  } catch (_error) {
    // 本地存储不可用时仍保留当前会话中的规则。
  }
}

async function restoreSavedView(item: SavedTrackerView): Promise<void> {
  tracker.setView(item.view);
  tracker.setDraftFilters(item.filters);
  await tracker.applyFilters();
  savedViewOpen.value = false;
}

onMounted(() => {
  try {
    const storedRules = window.localStorage.getItem(rulesStorageKey);
    if (storedRules) {
      const parsedRules = JSON.parse(storedRules) as unknown;
      if (parsedRules && typeof parsedRules === "object" && !Array.isArray(parsedRules)) {
        tracker.setRules(parsedRules as Partial<OfferTrackerRules>);
      }
    }
    const stored = window.localStorage.getItem(savedViewsStorageKey);
    if (!stored) return;
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) {
      savedViews.value = parsed.filter((item): item is SavedTrackerView => (
        typeof item === "object"
        && item !== null
        && typeof (item as SavedTrackerView).name === "string"
        && typeof (item as SavedTrackerView).filters === "object"
        && (item as SavedTrackerView).filters !== null
        && ((item as SavedTrackerView).view === "offers" || (item as SavedTrackerView).view === "products")
      ));
    }
  } catch (_error) {
    savedViews.value = [];
  }
});
</script>

<template>
  <main class="oi-modern-page offer-tracker-modern-page" data-page="offer-list-tracker">
    <header class="offer-tracker-modern-header offer-tracker-header">
      <div>
        <span class="offer-tracker-modern-eyebrow">{{ copy.eyebrow }}</span>
        <h1>Offer List Tracker</h1>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="offer-tracker-modern-header-actions">
        <button
          type="button"
          class="offer-tracker-secondary-button"
          :aria-expanded="savedViewOpen ? 'true' : 'false'"
          :aria-label="copy.savedViews"
          @click="savedViewOpen = !savedViewOpen"
        >{{ copy.savedViews }}</button>
        <button
          type="button"
          class="offer-tracker-primary-button offer-tracker-export-button"
          :aria-label="copy.exportCurrent"
          :disabled="!filteredRows.length"
          @click="emitDownload(false)"
        >{{ copy.exportExcel }}</button>
      </div>
      <div v-if="savedViewOpen" class="offer-tracker-saved-view-popover">
        <strong>{{ copy.savedViews }}</strong>
        <div v-if="savedViews.length" class="offer-tracker-saved-view-list">
          <button v-for="item in savedViews" :key="item.name" type="button" @click="restoreSavedView(item)">{{ item.name }}</button>
        </div>
        <span v-else class="offer-tracker-saved-view-empty">{{ copy.noSavedViews }}</span>
        <form @submit.prevent="saveCurrentView">
          <input v-model="savedViewName" type="text" :placeholder="copy.savedViewName" :aria-label="copy.savedViewName">
          <button type="submit" class="offer-tracker-primary-button">{{ copy.save }}</button>
        </form>
      </div>
    </header>

    <OfferTrackerFilters
      :model-value="draftFilters"
      :language="props.language"
      :tiers="availableTiers"
      :categories="availableCategories"
      :networks="availableNetworks"
      :loading="loading"
      @update:model-value="tracker.setDraftFilters"
      @sort-change="tracker.setSort"
      @apply="tracker.applyFilters"
      @reset="tracker.resetFilters"
    />

    <p v-if="errorMessage" class="offer-tracker-modern-notice error" role="alert">{{ errorMessage }}</p>

    <section class="offer-tracker-modern-kpis offer-tracker-kpis" :aria-label="copy.summary">
      <article class="offer-tracker-kpi" style="--kpi-accent:#1769d2;--kpi-soft:#eaf2fc">
        <span class="offer-tracker-kpi-icon">#</span>
        <div><small>{{ copy.matched }}</small><strong>{{ filteredRows.length.toLocaleString() }}</strong><span>{{ copy.matchedNote }}</span></div>
      </article>
      <article class="offer-tracker-kpi" style="--kpi-accent:#b36d00;--kpi-soft:#fff3dc">
        <span class="offer-tracker-kpi-icon">★</span>
        <div><small>{{ copy.high }}</small><strong>{{ priorityCounts.high.toLocaleString() }}</strong><span>{{ copy.highNote }}</span></div>
      </article>
      <article class="offer-tracker-kpi" style="--kpi-accent:#2f69a8;--kpi-soft:#eaf2fc">
        <span class="offer-tracker-kpi-icon">↑</span>
        <div><small>{{ copy.recommended }}</small><strong>{{ priorityCounts.recommended.toLocaleString() }}</strong><span>{{ copy.recommendedNote }}</span></div>
      </article>
      <article class="offer-tracker-kpi" style="--kpi-accent:#247359;--kpi-soft:#edf7f2">
        <span class="offer-tracker-kpi-icon">$</span>
        <div><small>{{ copy.lowAov }}</small><strong>{{ priorityCounts['low-aov'].toLocaleString() }}</strong><span>{{ copy.lowAovNote }}</span></div>
      </article>
    </section>

    <OfferTrackerTable
      :rows="pageRows"
      :total-rows="pageData.totalRows"
      :page="pageData.page"
      :total-pages="pageData.totalPages"
      :page-size="pageSize"
      :selected-keys="selectedKeys"
      :summary="selectionSummary"
      :view="view"
      :search="search"
      :rules="rules"
      :language="props.language"
      @update:search="tracker.setSearch"
      @toggle-row="tracker.toggleRow"
      @toggle-page="tracker.toggleCurrentPage"
      @toggle-all="tracker.toggleAllFiltered"
      @page-change="tracker.setPage"
      @view-change="tracker.setView"
      @rules-change="saveRules"
    >
      <template #footer-actions>
        <button
          type="button"
          class="offer-tracker-primary-button"
          :aria-label="copy.exportSelected"
          :disabled="!selectionSummary.selectedCount"
          @click="emitDownload(true)"
        >{{ copy.exportSelected }}</button>
      </template>
    </OfferTrackerTable>
  </main>
</template>
