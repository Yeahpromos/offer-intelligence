import { computed, ref } from "vue";

import { toNullableNumber } from "../../shared/format/number";
import type {
  OfferRecord,
  OfferTrackerDateRange,
  OfferTrackerFilters,
  OfferTrackerFilterInput,
  OfferTrackerRules,
  OfferTrackerRevenueSort,
  OfferTrackerRow,
  OfferTrackerView
} from "../../shared/contracts/offer";
import {
  filterOfferTrackerRows,
  validDateRange,
  normalizeOfferRecord,
  normalizeOfferTrackerRules,
  normalizeOfferTrackerFilters,
  offerTrackerCategoryValues,
  offerTrackerExportRows,
  offerTrackerNetworkValues,
  offerTrackerSelectionSummary,
  offerTrackerTierValues,
  paginateOfferTrackerRows,
  updateOfferTrackerSelection
} from "./offerTrackerModel";

export type OfferTrackerLoader = (
  range: OfferTrackerDateRange
) => Promise<readonly OfferRecord[]>;

export interface UseOfferTrackerOptions {
  readonly offers: readonly OfferRecord[];
  readonly defaultDateRange: OfferTrackerDateRange;
  readonly loadRange?: OfferTrackerLoader;
}

function safeSourceRows(rows: readonly OfferRecord[] | undefined): readonly OfferRecord[] {
  return Array.isArray(rows)
    ? rows.filter((row): row is OfferRecord => typeof row === "object" && row !== null && !Array.isArray(row))
    : [];
}

export function useOfferTracker(options: UseOfferTrackerOptions) {
  const initialFilters = normalizeOfferTrackerFilters({}, options.defaultDateRange);
  const initialRows = safeSourceRows(options.offers);
  const sourceRows = ref<readonly OfferRecord[]>(initialRows);
  const filters = ref<OfferTrackerFilters>(initialFilters);
  const draftFilters = ref<OfferTrackerFilters>(initialFilters);
  const search = ref("");
  const view = ref<OfferTrackerView>("offers");
  const page = ref(1);
  const pageSize = 25;
  const selectedKeys = ref<ReadonlySet<string>>(new Set<string>());
  const rules = ref<OfferTrackerRules>(normalizeOfferTrackerRules());
  const loading = ref(false);
  const error = ref("");
  let requestSequence = 0;

  const allRows = computed<readonly OfferTrackerRow[]>(() => sourceRows.value.map((row) => (
    normalizeOfferRecord(row, rules.value)
  )));
  const filteredRows = computed<readonly OfferTrackerRow[]>(() => filterOfferTrackerRows(
    sourceRows.value,
    filters.value,
    search.value,
    rules.value
  ));
  const pageData = computed(() => paginateOfferTrackerRows(filteredRows.value, page.value, pageSize));
  const pageRows = computed(() => pageData.value.rows);
  const selectionSummary = computed(() => offerTrackerSelectionSummary(
    filteredRows.value,
    pageRows.value,
    selectedKeys.value
  ));
  const availableTiers = computed(() => offerTrackerTierValues(allRows.value));
  const availableCategories = computed(() => offerTrackerCategoryValues(allRows.value));
  const availableNetworks = computed(() => offerTrackerNetworkValues(allRows.value));

  async function rowsForRange(range: OfferTrackerDateRange): Promise<readonly OfferRecord[]> {
    const matches = (other: OfferTrackerDateRange) => (
      range.startDate === other.startDate && range.endDate === other.endDate
    );
    // Only dates affect server metrics; the remaining filters use loaded rows.
    if (matches(filters.value) || !options.loadRange) return sourceRows.value;
    if (matches(initialFilters)) return initialRows;
    return options.loadRange(range);
  }

  function setDraftFilters(input: OfferTrackerFilterInput): void {
    draftFilters.value = Object.freeze({
      ...normalizeOfferTrackerFilters(input, options.defaultDateRange),
      startDate: input.startDate ?? draftFilters.value.startDate,
      endDate: input.endDate ?? draftFilters.value.endDate,
    });
  }

  function setSearch(value: string): void {
    search.value = value;
    page.value = 1;
  }

  function setSort(value: OfferTrackerRevenueSort): void {
    const revenueSort: OfferTrackerRevenueSort = ["priority", "revenue-desc", "revenue-asc"].includes(value)
      ? value
      : "priority";
    filters.value = Object.freeze({ ...filters.value, revenueSort });
    draftFilters.value = Object.freeze({ ...draftFilters.value, revenueSort });
    page.value = 1;
  }

  function setRules(input: Partial<OfferTrackerRules>): void {
    rules.value = normalizeOfferTrackerRules(input);
    page.value = 1;
  }

  async function applyFilters(): Promise<boolean> {
    if (!validDateRange(draftFilters.value.startDate, draftFilters.value.endDate)) {
      error.value = "请选择有效日期，开始日期不能晚于结束日期，范围不超过 366 天。";
      return false;
    }
    const normalized = normalizeOfferTrackerFilters(draftFilters.value, options.defaultDateRange);
    const minAov = toNullableNumber(normalized.minAov);
    const maxAov = toNullableNumber(normalized.maxAov);
    const minCommission = toNullableNumber(normalized.minCommission);
    const maxCommission = toNullableNumber(normalized.maxCommission);
    if (
      (minAov !== null && maxAov !== null && minAov > maxAov)
      || (minCommission !== null && maxCommission !== null && minCommission > maxCommission)
    ) {
      error.value = "最小值不能大于最大值。";
      return false;
    }

    const sequence = ++requestSequence;
    loading.value = true;
    error.value = "";
    try {
      const rows = await rowsForRange(normalized);
      if (sequence !== requestSequence) return false;
      sourceRows.value = safeSourceRows(rows);
      filters.value = normalized;
      draftFilters.value = normalized;
      page.value = 1;
      return true;
    } catch (_error) {
      if (sequence !== requestSequence) return false;
      error.value = "筛选数据加载失败，请稍后重试。";
      return false;
    } finally {
      if (sequence === requestSequence) loading.value = false;
    }
  }

  async function resetFilters(): Promise<boolean> {
    requestSequence += 1;
    const reset = normalizeOfferTrackerFilters({}, options.defaultDateRange);
    const sequence = requestSequence;
    loading.value = true;
    error.value = "";
    try {
      const rows = await rowsForRange(reset);
      if (sequence !== requestSequence) return false;
      sourceRows.value = safeSourceRows(rows);
      filters.value = reset;
      draftFilters.value = reset;
      search.value = "";
      page.value = 1;
      return true;
    } catch (_error) {
      if (sequence !== requestSequence) return false;
      error.value = "筛选数据加载失败，请稍后重试。";
      return false;
    } finally {
      if (sequence === requestSequence) loading.value = false;
    }
  }

  function setPage(nextPage: number): void {
    page.value = paginateOfferTrackerRows(filteredRows.value, nextPage, pageSize).page;
  }

  function setView(nextView: OfferTrackerView): void {
    view.value = nextView === "products" ? "products" : "offers";
  }

  function toggleRow(key: string, selected: boolean): void {
    const rows = pageRows.value.filter((row) => row.key === key);
    selectedKeys.value = updateOfferTrackerSelection(rows, selected, selectedKeys.value);
  }

  function toggleCurrentPage(selected: boolean): void {
    selectedKeys.value = updateOfferTrackerSelection(pageRows.value, selected, selectedKeys.value);
  }

  function toggleAllFiltered(): void {
    selectedKeys.value = updateOfferTrackerSelection(
      filteredRows.value,
      !selectionSummary.value.allFilteredSelected,
      selectedKeys.value
    );
  }

  function exportRows(selectedOnly: boolean): readonly OfferRecord[] {
    return offerTrackerExportRows(filteredRows.value, selectedKeys.value, selectedOnly);
  }

  return {
    sourceRows,
    filters,
    draftFilters,
    search,
    view,
    page,
    pageSize,
    selectedKeys,
    rules,
    loading,
    error,
    allRows,
    filteredRows,
    pageRows,
    pageData,
    selectionSummary,
    availableTiers,
    availableCategories,
    availableNetworks,
    setDraftFilters,
    setSearch,
    setSort,
    setRules,
    applyFilters,
    resetFilters,
    setPage,
    setView,
    toggleRow,
    toggleCurrentPage,
    toggleAllFiltered,
    exportRows
  };
}
