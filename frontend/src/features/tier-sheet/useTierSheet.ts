import { computed, ref, watch } from "vue";

import {
  buildTierRows,
  canonicalTierName,
  filterTierRows,
  headersForTier,
  isTierName,
  sortTierRows,
  TIER_NAMES,
  TIER_COLUMN_STORAGE_KEY,
  TIER_EXPANDABLE_NAMES,
  TIER_MOVE_STORAGE_KEY,
  tierCategorySummaries,
  tierPagination,
  tierReportDependencies,
  tierSummary,
  validTierMoveMap,
  visibleHeadersForTier,
  type TierFilters,
  type TierMove,
  type TierMoveMap,
  type TierName,
  type TierRow,
  type TierSheetData,
  type TierSheetLivePayload,
  type TierSheetReportData
} from "./tierSheetModel";

export interface TierReportLoadRequest {
  readonly tier: TierName;
  readonly startDate: string;
  readonly endDate: string;
  readonly signal: AbortSignal;
}

export type TierReportLoader = (request: TierReportLoadRequest) => Promise<unknown>;

export interface TierStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem?: (key: string) => void;
}

export interface SharedTierMoveLoadResult {
  readonly configured?: boolean;
  readonly moves?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface SharedTierMoveSaveRequest {
  readonly action: "replace" | "clear";
  readonly moves: readonly Readonly<Record<string, unknown>>[];
}

export type SharedTierMoveLoader = () => Promise<unknown>;
export type SharedTierMoveSaver = (request: SharedTierMoveSaveRequest) => Promise<unknown>;

export interface Tier1Merchant {
  readonly merchantId: string;
  readonly merchantName?: string;
  readonly network?: string;
  readonly currentTier?: string;
  readonly category?: string;
  readonly country?: string;
  readonly [key: string]: unknown;
}

export interface Tier1MerchantSearchRequest {
  readonly query: string;
  readonly signal: AbortSignal;
}

export interface Tier1MerchantAddRequest {
  readonly merchantId: string;
  readonly expectedTier: string;
}

export type Tier1AdditionsLoader = () => Promise<unknown>;
export type Tier1MerchantSearchLoader = (request: Tier1MerchantSearchRequest) => Promise<unknown>;
export type Tier1MerchantAddLoader = (request: Tier1MerchantAddRequest) => Promise<unknown>;

export interface UseTierSheetOptions {
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
}

const EMPTY_FILTERS: TierFilters = {
  search: "",
  network: "all",
  country: "all",
  minEpc: "",
  minRevenue: ""
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function firstDateRange(data: TierSheetReportData): { readonly startDate: string; readonly endDate: string } {
  const reportStartDate = text(data.startDate);
  const reportEndDate = text(data.endDate);
  if (reportStartDate && reportEndDate) return { startDate: reportStartDate, endDate: reportEndDate };

  const sheet = Array.isArray(data.sheets)
    ? data.sheets.find((candidate) => isRecord(candidate) && isRecord(candidate.reportRange))
    : undefined;
  const range = sheet?.reportRange;
  const startDate = text(range?.startDate || range?.start_date);
  const endDate = text(range?.endDate || range?.end_date);
  return startDate && endDate ? { startDate, endDate } : { startDate: "", endDate: "" };
}

function defaultDateRange(data: TierSheetReportData, today: () => Date): { readonly startDate: string; readonly endDate: string } {
  const fromData = firstDateRange(data);
  if (fromData.startDate && fromData.endDate) return fromData;
  const endDate = localDateKey(today());
  return { startDate: `${endDate.slice(0, 7)}-01`, endDate };
}

function normalizeLivePayload(value: unknown): TierSheetLivePayload {
  return isRecord(value) ? value as TierSheetLivePayload : { rows: [] };
}

function moveKey(record: Readonly<Record<string, unknown>>): string {
  const explicit = text(record.key || record.rowKey || record.row_key);
  if (explicit) return explicit;
  const id = text(record.merchantId || record.merchant_id).replace(/\.0$/, "");
  const source = canonicalTierName(record.sourceTier || record.source_tier);
  return id && isTierName(source) ? `merchant:${id}:${source}` : "";
}

function movesFromRecords(records: readonly unknown[]): TierMoveMap {
  const result: Record<string, TierMove> = {};
  records.forEach((candidate) => {
    if (!isRecord(candidate)) return;
    const key = moveKey(candidate);
    if (!key) return;
    const parsed = validTierMoveMap({ [key]: candidate });
    if (parsed[key]) result[key] = parsed[key];
  });
  return result;
}

function readStoredMoves(storage: TierStorage | undefined): TierMoveMap {
  if (!storage) return {};
  try {
    const value = JSON.parse(storage.getItem(TIER_MOVE_STORAGE_KEY) || "{}");
    return validTierMoveMap(value);
  } catch {
    return {};
  }
}

function readStoredColumns(storage: TierStorage | undefined): Record<string, string[]> {
  if (!storage) return {};
  try {
    const value = JSON.parse(storage.getItem(TIER_COLUMN_STORAGE_KEY) || "{}");
    if (!isRecord(value)) return {};
    return Object.entries(value).reduce<Record<string, string[]>>((result, [tier, headers]) => {
      if (Array.isArray(headers)) result[tier] = headers.map(text).filter(Boolean);
      return result;
    }, {});
  } catch {
    return {};
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  const [year, month, day] = value.split("-").map(Number);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : text(error) || "Request failed.";
}

function tier1MerchantResults(value: unknown): Tier1Merchant[] {
  const rows = isRecord(value) && Array.isArray(value.results) ? value.results : Array.isArray(value) ? value : [];
  return rows.filter(isRecord).map((row) => ({
    ...row,
    merchantId: text(row.merchantId || row.merchant_id || row.id)
  })).filter((row) => row.merchantId);
}

function tier1Additions(value: unknown): Tier1Merchant[] {
  const rows = isRecord(value) && Array.isArray(value.additions) ? value.additions : [];
  return rows.filter(isRecord).map((row) => ({
    ...row,
    merchantId: text(row.merchantId || row.merchant_id || row.id)
  })).filter((row) => row.merchantId);
}

export function useTierSheet(options: UseTierSheetOptions = {}) {
  const reportData = options.reportData || { sheets: [] };
  const today = options.today || (() => new Date());
  const initialTier = canonicalTierName(options.initialTier || "Tier 1");
  const selectedTier = ref<TierName>(isTierName(initialTier) ? initialTier : "Tier 1");
  const range = defaultDateRange(reportData, today);
  const startDate = ref(range.startDate);
  const endDate = ref(range.endDate);
  const filters = ref<TierFilters>({ ...EMPTY_FILTERS });
  const sortKey = ref("");
  const sortDirection = ref<"asc" | "desc">("desc");
  const page = ref(1);
  const expanded = ref(false);
  const columnPanelOpen = ref(false);
  const selectedKeys = ref(new Set<string>());
  const manualMoves = ref<TierMoveMap>(readStoredMoves(options.storage));
  const visibleColumns = ref<Record<string, string[]>>(readStoredColumns(options.storage));
  const payloads = ref(new Map<string, TierSheetLivePayload>());
  const errors = ref<Record<string, string>>({});
  const loading = ref(false);
  const loadingTiers = ref<TierName[]>([]);
  const moveDialogOpen = ref(false);
  const moveTarget = ref<TierName | "">("");
  const moveStatus = ref("");
  const moveSyncing = ref(false);
  const sharedMovesConfigured = ref(false);
  const additions = ref<Tier1Merchant[]>([]);
  const additionsLoaded = ref(false);
  const additionsOpen = ref(false);
  const additionsLoading = ref(false);
  const additionsError = ref("");
  const merchantDialogOpen = ref(false);
  const merchantQuery = ref("");
  const merchantResults = ref<Tier1Merchant[]>([]);
  const selectedMerchant = ref<Tier1Merchant | null>(null);
  const merchantLoading = ref(false);
  const merchantSubmitting = ref(false);
  const merchantStatus = ref("");
  let requestSequence = 0;
  let controller: AbortController | null = null;
  let merchantSequence = 0;

  const currentPayloads = computed(() => {
    const result = new Map<TierName, TierSheetLivePayload>();
    tierReportDependencies(selectedTier.value, manualMoves.value).forEach((tier) => {
      const payload = payloads.value.get(payloadKey(tier, startDate.value, endDate.value));
      if (payload) result.set(tier, payload);
    });
    return result;
  });
  const rows = computed(() => buildTierRows(reportData, selectedTier.value, currentPayloads.value, manualMoves.value));
  const filteredRows = computed(() => filterTierRows(rows.value, filters.value));
  const sortedRows = computed(() => sortTierRows(filteredRows.value, sortKey.value, sortDirection.value));
  const pagination = computed(() => selectedTier.value === "Tier 4"
    ? tierPagination(sortedRows.value, page.value)
    : tierPagination(sortedRows.value, 1, Math.max(1, sortedRows.value.length)));
  const visibleRows = computed(() => pagination.value.rows);
  const allHeaders = computed(() => headersForTier(reportData, selectedTier.value, currentPayloads.value));
  const displayHeaders = computed(() => visibleHeadersForTier(selectedTier.value, allHeaders.value, visibleColumns.value[selectedTier.value]));
  const summary = computed(() => tierSummary(filteredRows.value));
  const categorySummaries = computed(() => tierCategorySummaries(filteredRows.value));
  const selectedCount = computed(() => selectedKeys.value.size);
  const visibleSelectedCount = computed(() => visibleRows.value.filter((row) => selectedKeys.value.has(row.key)).length);
  const allVisibleSelected = computed(() => Boolean(visibleRows.value.length && visibleSelectedCount.value === visibleRows.value.length));
  const selectedRows = computed(() => rows.value.filter((row) => selectedKeys.value.has(row.key)));
  const availableNetworks = computed(() => uniqueValues(rows.value, ["Network", "Agency"]));
  const availableCountries = computed(() => uniqueValues(rows.value, ["COUNTRY", "Country"]));
  const rangeError = computed(() => {
    if (!validDate(startDate.value) || !validDate(endDate.value)) return "Use a valid date.";
    if (startDate.value > endDate.value) return "Start date must be before end date.";
    const days = Math.round((new Date(`${endDate.value}T00:00:00`).getTime() - new Date(`${startDate.value}T00:00:00`).getTime()) / 86400000) + 1;
    return days > 366 ? "Date range cannot exceed 366 days." : "";
  });
  const loadedTiers = computed(() => tierReportDependencies(selectedTier.value, manualMoves.value).filter((tier) => payloads.value.has(payloadKey(tier, startDate.value, endDate.value))));
  const source = computed(() => loadedTiers.value.length ? (loadedTiers.value.length === tierReportDependencies(selectedTier.value, manualMoves.value).length ? "database" : "mixed") : "snapshot");

  function uniqueValues(sourceRows: readonly TierRow[], keys: readonly string[]): string[] {
    const values = new Set<string>();
    sourceRows.forEach((row) => {
      keys.some((key) => {
        const value = text(row.raw[key]);
        if (value) {
          values.add(value);
          return true;
        }
        return false;
      });
    });
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }

  function payloadKey(tier: TierName, start: string, end: string): string {
    return `${tier}:${start}:${end}`;
  }

  function persistMoves(): void {
    if (!options.storage) return;
    if (!Object.keys(manualMoves.value).length) {
      options.storage.removeItem?.(TIER_MOVE_STORAGE_KEY);
      return;
    }
    options.storage.setItem(TIER_MOVE_STORAGE_KEY, JSON.stringify(manualMoves.value));
  }

  function persistColumns(): void {
    options.storage?.setItem(TIER_COLUMN_STORAGE_KEY, JSON.stringify(visibleColumns.value));
  }

  function clearRequestState(): void {
    requestSequence += 1;
    controller?.abort();
    controller = null;
    loading.value = false;
    loadingTiers.value = [];
  }

  function clearSelection(): void {
    selectedKeys.value = new Set();
  }

  function resetPagination(): void {
    page.value = 1;
    const visible = new Set(visibleRows.value.map((row) => row.key));
    selectedKeys.value = new Set(Array.from(selectedKeys.value).filter((key) => visible.has(key)));
  }

  function selectTier(value: string): void {
    const next = canonicalTierName(value);
    if (!isTierName(next) || next === selectedTier.value) return;
    clearRequestState();
    selectedTier.value = next;
    page.value = 1;
    clearSelection();
    expanded.value = false;
    moveDialogOpen.value = false;
    moveTarget.value = "";
    moveStatus.value = "";
  }

  function setDateRange(nextStart: string, nextEnd: string): void {
    clearRequestState();
    startDate.value = text(nextStart);
    endDate.value = text(nextEnd);
    payloads.value = new Map();
    errors.value = {};
    page.value = 1;
    clearSelection();
    expanded.value = false;
  }

  function setFilter(key: keyof TierFilters, value: string): void {
    filters.value = { ...filters.value, [key]: value };
    resetPagination();
  }

  function resetFilters(): void {
    filters.value = { ...EMPTY_FILTERS };
    resetPagination();
  }

  function setSort(header: string): void {
    if (!header) return;
    if (sortKey.value === header) sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    else {
      sortKey.value = header;
      sortDirection.value = /(^|\s)(merchant|brand|network|agency|tier|phase|country|reason|recommendation|category|id)/i.test(header) ? "asc" : "desc";
    }
    resetPagination();
  }

  function setPage(nextPage: number): void {
    page.value = Math.max(1, Math.min(pagination.value.totalPages, Number(nextPage) || 1));
    clearSelection();
  }

  function setVisibleHeaders(headers: readonly string[]): void {
    const selected = Array.from(new Set(headers.map(text).filter((header) => allHeaders.value.includes(header))));
    if (!selected.length) return;
    visibleColumns.value = { ...visibleColumns.value, [selectedTier.value]: selected };
    persistColumns();
  }

  function resetVisibleHeaders(): void {
    const next = { ...visibleColumns.value };
    delete next[selectedTier.value];
    visibleColumns.value = next;
    persistColumns();
  }

  function toggleRowSelection(key: string, checked: boolean): void {
    if (!key) return;
    const next = new Set(selectedKeys.value);
    if (checked) next.add(key);
    else next.delete(key);
    selectedKeys.value = next;
    moveStatus.value = "";
  }

  function selectAllVisible(checked: boolean): void {
    const next = new Set(selectedKeys.value);
    visibleRows.value.forEach((row) => checked ? next.add(row.key) : next.delete(row.key));
    selectedKeys.value = next;
    moveStatus.value = "";
  }

  function openOverlay(): boolean {
    if (!TIER_EXPANDABLE_NAMES.includes(selectedTier.value)) return false;
    expanded.value = true;
    return true;
  }

  function closeOverlay(): void {
    expanded.value = false;
  }

  function defaultMoveTarget(): TierName | "" {
    return TIER_NAMES.find((tier) => tier !== selectedTier.value) || "";
  }

  function openMoveDialog(): boolean {
    if (!selectedCount.value) return false;
    moveTarget.value = defaultMoveTarget();
    moveDialogOpen.value = true;
    moveStatus.value = "";
    return true;
  }

  function closeMoveDialog(): void {
    moveDialogOpen.value = false;
  }

  function setMoveTarget(target: string): void {
    const canonical = canonicalTierName(target);
    if (isTierName(canonical) && canonical !== selectedTier.value) moveTarget.value = canonical;
  }

  function movePayload(): readonly Readonly<Record<string, unknown>>[] {
    return Object.entries(manualMoves.value).map(([key, move]) => ({
      key,
      sourceTier: move.sourceTier,
      targetTier: move.targetTier,
      merchantId: move.merchantId || "",
      merchantName: move.merchantName || "",
      movedAt: move.movedAt || localDateKey(today())
    }));
  }

  async function syncMoves(action: "replace" | "clear"): Promise<void> {
    if (!options.saveSharedMoves) return;
    moveSyncing.value = true;
    try {
      const result = await options.saveSharedMoves({ action, moves: movePayload() });
      const payload = isRecord(result) ? result : {};
      sharedMovesConfigured.value = Boolean(payload.configured);
      if (Array.isArray(payload.moves)) {
        manualMoves.value = movesFromRecords(payload.moves);
        persistMoves();
      }
      if (payload.configured === false) moveStatus.value += "; local only";
      else if (payload.ok === false) moveStatus.value += `; ${text(payload.error) || "shared sync failed"}`;
      else if (payload.configured) moveStatus.value += "; synced for everyone";
    } catch (error) {
      moveStatus.value += `; local only (${errorText(error)})`;
    } finally {
      moveSyncing.value = false;
    }
  }

  async function moveSelectedRows(): Promise<boolean> {
    const target = moveTarget.value;
    if (moveSyncing.value || !target || target === selectedTier.value || !selectedRows.value.length) return false;
    const movedCount = selectedRows.value.length;
    const next: Record<string, TierMove> = { ...manualMoves.value };
    selectedRows.value.forEach((row) => {
      if (target === row.sourceTier) {
        delete next[row.key];
        return;
      }
      next[row.key] = {
        sourceTier: row.sourceTier,
        targetTier: target,
        merchantId: row.merchantId,
        merchantName: row.merchantName,
        movedAt: localDateKey(today())
      };
    });
    manualMoves.value = next;
    persistMoves();
    clearSelection();
    closeMoveDialog();
    moveStatus.value = `Moved ${movedCount.toLocaleString()} to ${target}`;
    await syncMoves("replace");
    return true;
  }

  async function resetMoves(): Promise<boolean> {
    if (moveSyncing.value || !Object.keys(manualMoves.value).length) return false;
    manualMoves.value = {};
    persistMoves();
    clearSelection();
    moveStatus.value = "Manual tier moves reset";
    await syncMoves("clear");
    return true;
  }

  async function loadSelectedTier(): Promise<boolean> {
    if (!options.loadTier || rangeError.value || selectedTier.value === "BLACK TIER") return false;
    clearRequestState();
    const sequence = requestSequence;
    const nextController = new AbortController();
    controller = nextController;
    const dependencies = tierReportDependencies(selectedTier.value, manualMoves.value);
    loading.value = true;
    loadingTiers.value = dependencies;
    errors.value = {};
    await Promise.all(dependencies.map(async (tier) => {
      const key = payloadKey(tier, startDate.value, endDate.value);
      if (payloads.value.has(key)) return;
      try {
        const payload = normalizeLivePayload(await options.loadTier?.({ tier, startDate: startDate.value, endDate: endDate.value, signal: nextController.signal }));
        if (sequence !== requestSequence) return;
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
    return !Object.keys(errors.value).length;
  }

  async function loadSharedMoves(): Promise<boolean> {
    if (!options.loadSharedMoves) return false;
    try {
      const value = await options.loadSharedMoves();
      const payload = isRecord(value) ? value as SharedTierMoveLoadResult : {};
      sharedMovesConfigured.value = Boolean(payload.configured);
      if (Array.isArray(payload.moves)) {
        manualMoves.value = movesFromRecords(payload.moves);
        persistMoves();
      }
      return Boolean(payload.configured);
    } catch (error) {
      moveStatus.value = `Could not load shared tier moves; using local moves only (${errorText(error)})`;
      return false;
    }
  }

  async function loadAdditions(): Promise<void> {
    if (additionsLoaded.value || !options.loadTier1Additions || additionsLoading.value) return;
    additionsLoading.value = true;
    additionsError.value = "";
    try {
      additions.value = tier1Additions(await options.loadTier1Additions());
      additionsLoaded.value = true;
    } catch (error) {
      additionsError.value = errorText(error);
    } finally {
      additionsLoading.value = false;
    }
  }

  async function openAdditions(): Promise<void> {
    additionsOpen.value = true;
    await loadAdditions();
  }

  function closeAdditions(): void {
    additionsOpen.value = false;
  }

  function openMerchantDialog(): void {
    if (selectedTier.value !== "Tier 1") return;
    merchantDialogOpen.value = true;
    merchantQuery.value = "";
    merchantResults.value = [];
    selectedMerchant.value = null;
    merchantStatus.value = "";
  }

  function closeMerchantDialog(): void {
    merchantSequence += 1;
    merchantDialogOpen.value = false;
    merchantSubmitting.value = false;
  }

  function selectMerchant(merchantId: string): void {
    selectedMerchant.value = merchantResults.value.find((merchant) => merchant.merchantId === merchantId) || null;
  }

  async function searchMerchants(): Promise<boolean> {
    const query = text(merchantQuery.value);
    if (!options.searchTier1Merchants || query.length < 2) {
      merchantStatus.value = "Enter at least 2 characters or a full merchant ID.";
      return false;
    }
    const sequence = ++merchantSequence;
    const abortController = new AbortController();
    merchantLoading.value = true;
    merchantStatus.value = "Searching the YeahPromos database...";
    try {
      const results = tier1MerchantResults(await options.searchTier1Merchants({ query, signal: abortController.signal }));
      if (sequence !== merchantSequence) return false;
      merchantResults.value = results;
      merchantStatus.value = results.length ? `${results.length.toLocaleString()} matches found.` : "No active merchants matched that ID or name.";
      return Boolean(results.length);
    } catch (error) {
      if (sequence === merchantSequence) merchantStatus.value = errorText(error);
      return false;
    } finally {
      if (sequence === merchantSequence) merchantLoading.value = false;
    }
  }

  async function addMerchant(): Promise<boolean> {
    const merchant = selectedMerchant.value;
    if (!merchant || !options.addTier1Merchant || merchantSubmitting.value || merchant.currentTier === "Tier 1") return false;
    merchantSubmitting.value = true;
    merchantStatus.value = "Saving the Tier 1 assignment...";
    try {
      const value = await options.addTier1Merchant({ merchantId: merchant.merchantId, expectedTier: merchant.currentTier || "" });
      const payload = isRecord(value) ? value : {};
      merchantResults.value = merchantResults.value.map((item) => item.merchantId === merchant.merchantId ? { ...item, ...(isRecord(payload.merchant) ? payload.merchant : {}), currentTier: "Tier 1" } : item);
      selectedMerchant.value = merchantResults.value.find((item) => item.merchantId === merchant.merchantId) || { ...merchant, currentTier: "Tier 1" };
      merchantStatus.value = "Tier 1 assignment saved.";
      additions.value = tier1Additions(payload.additions || { additions: [] });
      additionsLoaded.value = true;
      payloads.value = new Map();
      await loadSelectedTier();
      return true;
    } catch (error) {
      merchantStatus.value = errorText(error);
      return false;
    } finally {
      merchantSubmitting.value = false;
    }
  }

  watch([filteredRows, selectedTier], () => resetPagination());

  if (options.autoLoad !== false) {
    if (options.loadSharedMoves) void loadSharedMoves();
    if (options.loadTier) void loadSelectedTier();
    if (selectedTier.value === "Tier 1" && options.loadTier1Additions) void loadAdditions();
  }

  function dispose(): void {
    clearRequestState();
    merchantSequence += 1;
  }

  return {
    reportData,
    selectedTier,
    startDate,
    endDate,
    filters,
    sortKey,
    sortDirection,
    page,
    expanded,
    columnPanelOpen,
    selectedKeys,
    manualMoves,
    payloads,
    errors,
    loading,
    loadingTiers,
    moveDialogOpen,
    moveTarget,
    moveStatus,
    moveSyncing,
    sharedMovesConfigured,
    additions,
    additionsOpen,
    additionsLoading,
    additionsError,
    merchantDialogOpen,
    merchantQuery,
    merchantResults,
    selectedMerchant,
    merchantLoading,
    merchantSubmitting,
    merchantStatus,
    currentPayloads,
    rows,
    filteredRows,
    sortedRows,
    pagination,
    visibleRows,
    allHeaders,
    displayHeaders,
    summary,
    categorySummaries,
    selectedCount,
    visibleSelectedCount,
    allVisibleSelected,
    selectedRows,
    availableNetworks,
    availableCountries,
    rangeError,
    loadedTiers,
    source,
    selectTier,
    setDateRange,
    setFilter,
    resetFilters,
    setSort,
    setPage,
    setVisibleHeaders,
    resetVisibleHeaders,
    toggleRowSelection,
    selectAllVisible,
    openOverlay,
    closeOverlay,
    openMoveDialog,
    closeMoveDialog,
    setMoveTarget,
    moveSelectedRows,
    resetMoves,
    loadSelectedTier,
    loadSharedMoves,
    loadAdditions,
    openAdditions,
    closeAdditions,
    openMerchantDialog,
    closeMerchantDialog,
    selectMerchant,
    searchMerchants,
    addMerchant,
    dispose
  };
}
