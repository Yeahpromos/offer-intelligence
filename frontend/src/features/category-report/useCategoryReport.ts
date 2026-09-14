import { computed, ref } from "vue";

import {
  aggregateCategoryGroups,
  buildCategoryPieSlices,
  buildCategoryRows,
  categorySearchEntries,
  filterCategoryGroups,
  sortCategoryGroups,
  type CategoryPieSlice,
  type CategoryReportData,
  type CategoryReportGroup,
  type CategoryReportRow,
  type CategoryReportSelection,
  type CategoryReportSortDirection,
  type CategoryReportSortKey,
  type CategorySearchEntry
} from "./categoryReportModel";

export interface CategoryTierRequest {
  readonly tier: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly signal: AbortSignal;
}

export type CategoryTierLoader = (request: CategoryTierRequest) => Promise<unknown>;

export interface UseCategoryReportOptions {
  readonly reportData?: CategoryReportData;
  readonly selectedTiers?: readonly string[];
  readonly initialStartDate?: string;
  readonly initialEndDate?: string;
  readonly loadTier?: CategoryTierLoader;
  readonly autoLoad?: boolean;
  readonly today?: () => Date;
}

type CategoryReportSource = "snapshot" | "mixed" | "database";

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00");
  return !Number.isNaN(date.getTime());
}

function localDateKey(date: Date): string {
  return date.getFullYear() + "-"
    + String(date.getMonth() + 1).padStart(2, "0") + "-"
    + String(date.getDate()).padStart(2, "0");
}

function defaultDateRange(options: UseCategoryReportOptions): { startDate: string; endDate: string } {
  const dataStart = text(options.reportData?.startDate);
  const dataEnd = text(options.reportData?.endDate);
  if (validDate(dataStart) && validDate(dataEnd) && dataStart <= dataEnd) {
    return { startDate: dataStart, endDate: dataEnd };
  }
  const today = options.today?.() || new Date();
  const endDate = localDateKey(today);
  return { startDate: endDate.slice(0, 7) + "-01", endDate };
}

function payloadKey(tier: string, startDate: string, endDate: string): string {
  return tier + "|" + startDate + "|" + endDate;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRecord(error) && error.message) return String(error.message);
  return String(error || "Could not load category data.");
}

export function useCategoryReport(options: UseCategoryReportOptions = {}) {
  const reportData = ref<CategoryReportData>(options.reportData || { sheets: [] });
  const selectedTiers = ref<string[]>([...(options.selectedTiers || ["Tier 1", "Tier 2", "Tier 3", "Tier 4"])]);
  const range = defaultDateRange(options);
  const startDate = ref(range.startDate);
  const endDate = ref(range.endDate);
  const searchDraft = ref("");
  const search = ref("");
  const selection = ref<CategoryReportSelection | null>(null);
  const sortKey = ref<CategoryReportSortKey>("revenue");
  const sortDirection = ref<CategoryReportSortDirection>("desc");
  const focusKey = ref("");
  const showAllCategories = ref(false);
  const expandedKey = ref("");
  const loading = ref(false);
  const loadingTiers = ref<string[]>([]);
  const errors = ref<Record<string, string>>({});
  const payloads = ref(new Map<string, unknown>());
  let requestSequence = 0;
  let controller: AbortController | null = null;

  const currentPayloads = computed<Record<string, unknown>>(() => {
    const result: Record<string, unknown> = {};
    selectedTiers.value.forEach((tier) => {
      const value = payloads.value.get(payloadKey(tier, startDate.value, endDate.value));
      if (value !== undefined) result[tier] = value;
    });
    return result;
  });

  const rows = computed<CategoryReportRow[]>(() => buildCategoryRows(
    reportData.value,
    selectedTiers.value,
    currentPayloads.value
  ));
  const allGroups = computed<CategoryReportGroup[]>(() => aggregateCategoryGroups(rows.value));
  const filteredGroups = computed<CategoryReportGroup[]>(() => sortCategoryGroups(
    filterCategoryGroups(allGroups.value, selection.value, search.value),
    sortKey.value,
    sortDirection.value
  ));

  const visibleGroups = computed<CategoryReportGroup[]>(() => {
    if (!focusKey.value) return filteredGroups.value;
    if (focusKey.value === "other-categories") {
      const overviewSlices = buildCategoryPieSlices(
        filteredGroups.value,
        selectedTiers.value,
        sortKey.value
      );
      const overflow = overviewSlices.find((slice) => slice.key === "other-categories");
      if (!overflow) return [];
      const keys = new Set(overflow.group.rows.map((row) => row.category.toLowerCase()));
      return filteredGroups.value.filter((group) => keys.has(group.category.toLowerCase()));
    }
    return filteredGroups.value.filter((group) => group.category.toLowerCase() === focusKey.value.toLowerCase()
      || group.category.replace(/[^a-z0-9]+/gi, "-").toLowerCase() === focusKey.value.toLowerCase());
  });

  const pieSlices = computed<CategoryPieSlice[]>(() => buildCategoryPieSlices(
    visibleGroups.value,
    selectedTiers.value,
    sortKey.value,
    focusKey.value,
    showAllCategories.value
  ));

  const summary = computed(() => ({
    merchantCount: visibleGroups.value.reduce((sum, group) => sum + group.merchantCount, 0),
    revenue: visibleGroups.value.reduce((sum, group) => sum + group.revenue, 0),
    orders: visibleGroups.value.reduce((sum, group) => sum + group.orders, 0),
    clicks: visibleGroups.value.reduce((sum, group) => sum + group.clicks, 0)
  }));

  const searchEntries = computed<CategorySearchEntry[]>(() => categorySearchEntries(rows.value));
  const selectedTierText = computed(() => selectedTiers.value.length ? selectedTiers.value.join(", ") : "No tiers selected");
  const loadedCount = computed(() => selectedTiers.value.filter((tier) =>
    payloads.value.has(payloadKey(tier, startDate.value, endDate.value))
  ).length);
  const source = computed<CategoryReportSource>(() => {
    if (!selectedTiers.value.length || !loadedCount.value) return "snapshot";
    return loadedCount.value === selectedTiers.value.length ? "database" : "mixed";
  });
  const rangeError = computed(() => !validDate(startDate.value) || !validDate(endDate.value)
    ? "Use a valid date."
    : startDate.value > endDate.value ? "Start date must be before end date." : "");

  function clearRequestState(): void {
    requestSequence += 1;
    controller?.abort();
    controller = null;
    loading.value = false;
    loadingTiers.value = [];
  }

  function resetDrilldown(): void {
    focusKey.value = "";
    expandedKey.value = "";
  }

  function selectTiers(nextTiers: readonly string[]): void {
    clearRequestState();
    selectedTiers.value = Array.from(new Set(nextTiers.map(text).filter(Boolean)));
    resetDrilldown();
  }

  function toggleTier(tier: string, checked: boolean): void {
    const next = new Set(selectedTiers.value);
    if (checked) next.add(tier);
    else next.delete(tier);
    selectTiers(Array.from(next));
  }

  function setAllTiers(checked: boolean): void {
    selectTiers(checked ? ["Tier 1", "Tier 2", "Tier 3", "Tier 4"] : []);
  }

  function setSearchDraft(value: string): void {
    searchDraft.value = value;
  }

  function applySearch(value = searchDraft.value): boolean {
    const next = text(value);
    searchDraft.value = next;
    if (!next) {
      selection.value = null;
      search.value = "";
      resetDrilldown();
      return true;
    }
    const entry = searchEntries.value.find((item) => item.value.toLowerCase() === next.toLowerCase());
    if (!entry) return false;
    selection.value = {
      type: entry.type,
      ...(entry.category ? { category: entry.category } : {}),
      ...(entry.merchantId ? { merchantId: entry.merchantId } : {}),
      ...(entry.merchantName ? { merchantName: entry.merchantName } : {}),
      value: entry.value
    };
    search.value = entry.type === "category" ? entry.category || "" : entry.merchantId || entry.merchantName || "";
    resetDrilldown();
    return true;
  }

  function clearSearch(): void {
    searchDraft.value = "";
    selection.value = null;
    search.value = "";
    resetDrilldown();
  }

  function setSort(nextKey: CategoryReportSortKey): void {
    if (sortKey.value === nextKey) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
      return;
    }
    sortKey.value = nextKey;
    sortDirection.value = nextKey === "category" ? "asc" : "desc";
  }

  function setFocus(nextKey: string): void {
    focusKey.value = text(nextKey);
    expandedKey.value = "";
  }

  function clearFocus(): void {
    focusKey.value = "";
    expandedKey.value = "";
  }

  function toggleExpanded(key: string): void {
    expandedKey.value = expandedKey.value === key ? "" : key;
  }

  function setDateRange(nextStartDate: string, nextEndDate: string): void {
    clearRequestState();
    startDate.value = text(nextStartDate);
    endDate.value = text(nextEndDate);
    payloads.value = new Map();
    errors.value = {};
    resetDrilldown();
  }

  async function loadSelectedTiers(): Promise<boolean> {
    if (!options.loadTier || rangeError.value || !selectedTiers.value.length) return false;
    clearRequestState();
    const sequence = requestSequence;
    const nextController = new AbortController();
    controller = nextController;
    loading.value = true;
    loadingTiers.value = selectedTiers.value.slice();
    errors.value = {};
    const tiers = selectedTiers.value.slice();
    await Promise.all(tiers.map(async (tier) => {
      const key = payloadKey(tier, startDate.value, endDate.value);
      if (payloads.value.has(key)) return;
      try {
        const payload = await options.loadTier?.({
          tier,
          startDate: startDate.value,
          endDate: endDate.value,
          signal: nextController.signal
        });
        if (sequence !== requestSequence || !selectedTiers.value.includes(tier)) return;
        const next = new Map(payloads.value);
        next.set(key, payload);
        payloads.value = next;
      } catch (error) {
        if (sequence !== requestSequence || (error as { name?: unknown })?.name === "AbortError") return;
        errors.value = { ...errors.value, [tier]: errorText(error) };
      }
    }));
    if (sequence !== requestSequence) return false;
    loading.value = false;
    loadingTiers.value = [];
    controller = null;
    return Object.keys(errors.value).length === 0;
  }

  function dispose(): void {
    clearRequestState();
  }

  if (options.autoLoad !== false && options.loadTier) void loadSelectedTiers();

  return {
    reportData,
    selectedTiers,
    startDate,
    endDate,
    searchDraft,
    search,
    selection,
    sortKey,
    sortDirection,
    focusKey,
    showAllCategories,
    expandedKey,
    loading,
    loadingTiers,
    errors,
    rangeError,
    rows,
    allGroups,
    filteredGroups,
    groups: filteredGroups,
    visibleGroups,
    pieSlices,
    summary,
    searchEntries,
    selectedTierText,
    source,
    toggleTier,
    setAllTiers,
    setSearchDraft,
    applySearch,
    clearSearch,
    setSort,
    setFocus,
    clearFocus,
    toggleExpanded,
    setDateRange,
    loadSelectedTiers,
    dispose
  };
}
