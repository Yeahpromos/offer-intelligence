<script setup lang="ts">
import { computed } from "vue";
import DatePicker from "../../shared/components/DatePicker.vue";
import FilterDropdown from "../../shared/components/FilterDropdown.vue";

import type {
  OfferTrackerFilters as TrackerFilters,
  OfferTrackerRevenueSort,
  UiLanguage,
} from "../../shared/contracts/offer";
import { translateMessage } from "../../shared/i18n";

const props = defineProps<{
  modelValue: TrackerFilters;
  language: UiLanguage;
  tiers: readonly string[];
  categories: readonly string[];
  networks: readonly string[];
  loading: boolean;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: TrackerFilters): void;
  (event: "sort-change", value: OfferTrackerRevenueSort): void;
  (event: "apply"): void;
  (event: "reset"): void;
}>();

const copy = computed(() => {
  const message = (key: string, fallback: string) =>
    translateMessage(props.language, key, fallback);
  return {
    heading: message("offerTracker.defineRange", "定义 Offer 范围"),
    subtitle: message(
      "offerTracker.defineRangeSubtitle",
      "先选择商业范围，再查看并导出对应的优先级清单。",
    ),
    liveSource: message("offerTracker.liveSource", "实时 OFFER 缓存"),
    tiers: message(
      "offerTracker.filterTiers",
      props.language === "zh" ? "分层" : "Tier filters",
    ),
    categories: message(
      "offerTracker.filterCategories",
      props.language === "zh" ? "品类" : "Category filters",
    ),
    networks: message(
      "offerTracker.filterNetworks",
      props.language === "zh" ? "网络" : "Network filters",
    ),
    startDate: message("offerTracker.startDate", "开始日期"),
    endDate: message("offerTracker.endDate", "结束日期"),
    timeRange: message("offerTracker.timeRange", "时间范围"),
    aovRange: message("offerTracker.aovRange", "AOV 范围"),
    commissionRange: message("offerTracker.commissionRange", "AFF 佣金范围"),
    minAov: message("offerTracker.minAov", "Min $"),
    maxAov: message("offerTracker.maxAov", "Max $"),
    minCommission: message("offerTracker.minCommission", "Min %"),
    maxCommission: message("offerTracker.maxCommission", "Max %"),
    bbPolicy: message(
      "offerTracker.filterBbPolicy",
      props.language === "zh" ? "是否介意 BB" : "BB Preference",
    ),
    revenueStatus: message(
      "offerTracker.filterRevenueStatus",
      props.language === "zh" ? "REVENUE 状态" : "Revenue status",
    ),
    sort: message(
      "offerTracker.filterSort",
      props.language === "zh" ? "REVENUE 排序" : "Sort",
    ),
    allTiers: message("offerTracker.allTiers", "全部分层"),
    allCategories: message("offerTracker.allCategories", "全部品类"),
    allNetworks: message("offerTracker.allNetworks", "全部网络"),
    all: message("common.all", "全部"),
    mind: message("offerTracker.mind", "介意 BB"),
    open: message("offerTracker.open", "不介意 BB"),
    unknown: message("common.unknown", "未知"),
    positiveRevenue: message("offerTracker.positiveRevenue", "有 Revenue"),
    noRevenue: message("offerTracker.noRevenue", "无 Revenue"),
    priority: message("offerTracker.priority", "默认优先级"),
    revenueDesc: message("offerTracker.revenueDesc", "Revenue 从高到低"),
    revenueAsc: message("offerTracker.revenueAsc", "Revenue 从低到高"),
    rangeHint: message(
      "offerTracker.dataRangeLabel",
      props.language === "zh" ? "数据范围：" : "Data range: ",
    ),
    datePrefix: message("offerTracker.datePrefix", "日期"),
    reset: message("common.reset", "重置"),
    apply: message("common.apply", "应用筛选"),
    loading: message("common.loading", "加载中…"),
  };
});

function inputValue(event: Event): string {
  return event.target instanceof HTMLInputElement ? event.target.value : "";
}

function updateField<K extends keyof TrackerFilters>(
  field: K,
  value: TrackerFilters[K],
): void {
  emit("update:modelValue", { ...props.modelValue, [field]: value });
}

function updateSort(values: string[]): void {
  const value = values[0] as OfferTrackerRevenueSort;
  updateField("revenueSort", value);
  emit("sort-change", value);
}
const options = (values: readonly string[]) =>
  values.map((value) => ({ value, label: value }));
const bbOptions = computed(() => [
  { value: "mind", label: copy.value.mind },
  { value: "open", label: copy.value.open },
  { value: "unknown", label: copy.value.unknown },
]);
const revenueOptions = computed(() => [
  { value: "all", label: copy.value.all },
  { value: "positive", label: copy.value.positiveRevenue },
  { value: "none", label: copy.value.noRevenue },
]);
const sortOptions = computed(() => [
  { value: "priority", label: copy.value.priority },
  { value: "revenue-desc", label: copy.value.revenueDesc },
  { value: "revenue-asc", label: copy.value.revenueAsc },
]);

const filterChips = computed(() => [
  `${copy.value.datePrefix} ${props.modelValue.startDate}至${props.modelValue.endDate}`,
]);
</script>

<template>
  <section class="offer-tracker-filter-card offer-tracker-modern-filters">
    <div class="offer-tracker-section-heading">
      <div>
        <h2>{{ copy.heading }}</h2>
        <p>{{ copy.subtitle }}</p>
      </div>
      <span class="offer-tracker-live-source">{{ copy.liveSource }}</span>
    </div>

    <form @submit.prevent="emit('apply')">
      <div class="offer-tracker-filter-grid">
        <FilterDropdown
          class="offer-tracker-filter-field"
          :model-value="modelValue.tiers"
          :options="options(tiers)"
          :label="copy.tiers"
          :all-label="copy.allTiers"
          :language="language"
          multiple
          @update:model-value="updateField('tiers', $event)"
        />
        <FilterDropdown
          class="offer-tracker-filter-field"
          :model-value="modelValue.categories"
          :options="options(categories)"
          :label="copy.categories"
          :all-label="copy.allCategories"
          :language="language"
          multiple
          searchable
          @update:model-value="updateField('categories', $event)"
        />

        <fieldset
          class="offer-tracker-filter-field offer-tracker-range-group offer-tracker-date-range"
        >
          <legend>{{ copy.timeRange }}</legend>
          <div class="offer-tracker-range-inputs">
            <DatePicker
              :model-value="modelValue.startDate"
              :label="copy.startDate"
              :language="language"
              @update:model-value="updateField('startDate', $event)"
            />
            <span aria-hidden="true">–</span>
            <DatePicker
              :model-value="modelValue.endDate"
              :label="copy.endDate"
              :language="language"
              @update:model-value="updateField('endDate', $event)"
            />
          </div>
          <small
            >{{ copy.rangeHint }}{{ modelValue.startDate }}至{{
              modelValue.endDate
            }}</small
          >
        </fieldset>

        <fieldset class="offer-tracker-filter-field offer-tracker-range-group">
          <legend>{{ copy.aovRange }}</legend>
          <div class="offer-tracker-range-inputs">
            <input
              :value="modelValue.minAov"
              type="number"
              min="0"
              step="any"
              :placeholder="copy.minAov"
              :aria-label="copy.minAov"
              @input="updateField('minAov', inputValue($event))"
            />
            <span>–</span>
            <input
              :value="modelValue.maxAov"
              type="number"
              min="0"
              step="any"
              :placeholder="copy.maxAov"
              :aria-label="copy.maxAov"
              @input="updateField('maxAov', inputValue($event))"
            />
          </div>
        </fieldset>

        <fieldset class="offer-tracker-filter-field offer-tracker-range-group">
          <legend>{{ copy.commissionRange }}</legend>
          <div class="offer-tracker-range-inputs">
            <input
              :value="modelValue.minCommission"
              type="number"
              min="0"
              step="any"
              :placeholder="copy.minCommission"
              :aria-label="copy.minCommission"
              @input="updateField('minCommission', inputValue($event))"
            />
            <span>–</span>
            <input
              :value="modelValue.maxCommission"
              type="number"
              min="0"
              step="any"
              :placeholder="copy.maxCommission"
              :aria-label="copy.maxCommission"
              @input="updateField('maxCommission', inputValue($event))"
            />
          </div>
        </fieldset>

        <FilterDropdown
          class="offer-tracker-filter-field"
          :model-value="modelValue.networks"
          :options="options(networks)"
          :label="copy.networks"
          :all-label="copy.allNetworks"
          :language="language"
          multiple
          searchable
          @update:model-value="updateField('networks', $event)"
        />
        <FilterDropdown
          class="offer-tracker-filter-field"
          :model-value="modelValue.bbPolicies"
          :options="bbOptions"
          :label="copy.bbPolicy"
          :all-label="copy.all"
          :language="language"
          multiple
          @update:model-value="
            updateField('bbPolicies', $event as TrackerFilters['bbPolicies'])
          "
        />
        <FilterDropdown
          class="offer-tracker-filter-field"
          :model-value="[modelValue.revenueStatus]"
          :options="revenueOptions"
          :label="copy.revenueStatus"
          :language="language"
          @update:model-value="
            updateField(
              'revenueStatus',
              $event[0] as TrackerFilters['revenueStatus'],
            )
          "
        />
        <FilterDropdown
          class="offer-tracker-filter-field"
          :model-value="[modelValue.revenueSort]"
          :options="sortOptions"
          :label="copy.sort"
          :language="language"
          @update:model-value="updateSort"
        />
      </div>

      <div class="offer-tracker-filter-footer">
        <div class="offer-tracker-filter-chips">
          <span v-for="chip in filterChips" :key="chip">{{ chip }}</span>
        </div>
        <div class="offer-tracker-filter-actions">
          <button
            type="button"
            class="offer-tracker-secondary-button"
            :disabled="loading"
            @click="emit('reset')"
          >
            {{ copy.reset }}
          </button>
          <button
            type="submit"
            class="offer-tracker-primary-button"
            :aria-label="copy.apply"
            :disabled="loading"
          >
            {{ loading ? copy.loading : copy.apply }}
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
