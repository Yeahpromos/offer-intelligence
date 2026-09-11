<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from "vue";

import MonthPicker from "../../shared/components/MonthPicker.vue";

import { translateMessage, type UiLanguage } from "../../shared/i18n";
import {
  buildMonthlyNewMerchantPayload,
  formatMonthlyNewMerchantMoney,
  monthlyNewMerchantMonthLabel,
  monthlyNewMerchantUpdatedText,
  normalizeMonthlyNewMerchantRecord,
  parseMonthlyNewMerchantTable,
  monthlyNewMerchantTemplateCsv,
  type MonthlyNewMerchantImportResult,
  type MonthlyNewMerchantOfferLookup,
  type MonthlyNewMerchantRecord
} from "./monthlyNewMerchantsModel";
import {
  useMonthlyNewMerchants,
  type MonthlyNewMerchantDeleter,
  type MonthlyNewMerchantLoader,
  type MonthlyNewMerchantSaver
} from "./useMonthlyNewMerchants";

export type MonthlyNewMerchantFileReader = (file: File) => Promise<readonly unknown[][]>;

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly month?: string;
  readonly records?: readonly unknown[];
  readonly offers?: readonly MonthlyNewMerchantOfferLookup[];
  readonly loadData?: MonthlyNewMerchantLoader;
  readonly saveData?: MonthlyNewMerchantSaver;
  readonly deleteData?: MonthlyNewMerchantDeleter;
  readonly readFile?: MonthlyNewMerchantFileReader;
  readonly autoLoad?: boolean;
  readonly today?: () => Date;
}>(), {
  month: undefined,
  records: () => [],
  offers: () => [],
  loadData: undefined,
  saveData: undefined,
  deleteData: undefined,
  readFile: undefined,
  autoLoad: true,
  today: undefined
});

const monthly = useMonthlyNewMerchants({
  initialMonth: props.month,
  records: props.records,
  offers: props.offers,
  loadData: props.loadData,
  saveData: props.saveData,
  deleteData: props.deleteData,
  today: props.today
});

const drawerOpen = ref(false);
const importOpen = ref(false);
const drawerError = ref("");
const importError = ref("");
const editingRecordId = ref(0);
const drawerRestoreFocus = ref<HTMLElement | null>(null);
const importRestoreFocus = ref<HTMLElement | null>(null);
const drawerElement = ref<HTMLElement | null>(null);
const importDialogElement = ref<HTMLElement | null>(null);
const merchantNameInput = ref<HTMLInputElement | null>(null);
const importFileInput = ref<HTMLInputElement | null>(null);
const addButton = ref<HTMLButtonElement | null>(null);
const importButton = ref<HTMLButtonElement | null>(null);
const importPaste = ref("");

interface MonthlyNewMerchantFormState {
  recordId: number;
  reportMonth: string;
  merchantId: string;
  merchantName: string;
  businessManager: string;
  program: string;
  platform: string;
  gmvRequirement: string;
  gmvMonthlyTarget: string;
  pastMonthPurchase: string;
  independentWebsites: string;
  reviewSummary: string;
  ourCommission: string;
  presetCommission: string;
  isPriority: boolean;
  completionReward: string;
}

function blankForm(reportMonth: string): MonthlyNewMerchantFormState {
  return {
    recordId: 0,
    reportMonth,
    merchantId: "",
    merchantName: "",
    businessManager: "",
    program: "",
    platform: "",
    gmvRequirement: "",
    gmvMonthlyTarget: "",
    pastMonthPurchase: "",
    independentWebsites: "",
    reviewSummary: "",
    ourCommission: "",
    presetCommission: "",
    isPriority: false,
    completionReward: ""
  };
}

const form = reactive<MonthlyNewMerchantFormState>(blankForm(monthly.month.value));

function message(key: string, fallback: string): string {
  return translateMessage(props.language, key, fallback);
}

const copy = computed(() => ({
  basics: message("monthlyNewMerchants.basics", "Merchant details"),
  goals: message("monthlyNewMerchants.goals", "Targets and performance"),
  commissions: message("monthlyNewMerchants.commissions", "Commission and incentives"),
  gmvPlaceholder: message("monthlyNewMerchants.gmvPlaceholder", "e.g. $100,000 or profitability"),
  fileHint: message("monthlyNewMerchants.fileHint", "CSV, TSV, XLS or XLSX · Preview before importing"),
  pastePlaceholder: message("monthlyNewMerchants.pastePlaceholder", "Brand\tProgram\tPlatform\tGMV target"),
  title: message("monthlyNewMerchants.title", "Monthly new merchants"),
  subtitle: message("monthlyNewMerchants.subtitle", "Add this month's merchants manually and save every entry to the database"),
  month: message("monthlyNewMerchants.month", "Month"),
  add: message("monthlyNewMerchants.add", "Add merchant"),
  import: message("monthlyNewMerchants.import", "Import table"),
  search: message("monthlyNewMerchants.search", "Search merchants"),
  searchPlaceholder: message("monthlyNewMerchants.searchPlaceholder", "Search merchant, ID, or BD"),
  priority: message("monthlyNewMerchants.priority", "Priority"),
  merchantId: message("monthlyNewMerchants.merchantId", "Merchant ID"),
  brand: message("monthlyNewMerchants.brand", "Brand"),
  program: message("monthlyNewMerchants.program", "Program"),
  platform: message("monthlyNewMerchants.platform", "Platform"),
  gmvRequirement: message("monthlyNewMerchants.gmvRequirement", "GMV need to be reached"),
  gmvTarget: message("monthlyNewMerchants.gmvTarget", "Numeric GMV target"),
  pastMonthPurchase: message("monthlyNewMerchants.pastMonthPurchase", "Past month purchase"),
  independentWebsites: message("monthlyNewMerchants.independentWebsites", "Independent websites"),
  reviewSummary: message("monthlyNewMerchants.reviewSummary", "Reviews numbers"),
  ourCommission: message("monthlyNewMerchants.ourCommission", "Our commission"),
  presetCommission: message("monthlyNewMerchants.presetCommission", "Preset commission"),
  bd: message("monthlyNewMerchants.bd", "BD"),
  updated: message("monthlyNewMerchants.updated", "Updated"),
  actions: message("monthlyNewMerchants.actions", "Actions"),
  merchantName: message("monthlyNewMerchants.merchantName", "Merchant"),
  drawerSubtitle: message("monthlyNewMerchants.drawerSubtitle", "Merchant name is required; saving writes the complete record directly to the database"),
  addTitle: message("monthlyNewMerchants.addTitle", "Add new merchant"),
  editTitle: message("monthlyNewMerchants.editTitle", "Edit new merchant"),
  save: message("monthlyNewMerchants.save", "Save merchant"),
  saving: message("monthlyNewMerchants.saving", "Saving…"),
  cancel: message("monthlyNewMerchants.cancel", "Cancel"),
  close: message("monthlyNewMerchants.close", "Close"),
  priorityAction: message("monthlyNewMerchants.priorityAction", "Priority recommendation"),
  priorityHelp: message("monthlyNewMerchants.priorityHelp", "Highlight this merchant in the monthly list"),
  reward: message("monthlyNewMerchants.reward", "Reward when achieved"),
  rewardPlaceholder: message("monthlyNewMerchants.rewardPlaceholder", "Optional bonus, commission uplift, or other reward"),
  importTitle: message("monthlyNewMerchants.importTitle", "Import merchant table"),
  importSubtitle: message("monthlyNewMerchants.importSubtitle", "Paste rows from Excel or Google Sheets, or upload CSV, TSV, XLS, or XLSX. Review issues before saving."),
  chooseFile: message("monthlyNewMerchants.chooseFile", "Choose file"),
  noFile: message("monthlyNewMerchants.noFile", "No file selected"),
  downloadTemplate: message("monthlyNewMerchants.downloadTemplate", "Download CSV template"),
  pasteLabel: message("monthlyNewMerchants.pasteLabel", "Paste a table including its header row"),
  preview: message("monthlyNewMerchants.preview", "Preview pasted rows"),
  importValid: message("monthlyNewMerchants.importValid", "Import valid rows"),
  importing: message("monthlyNewMerchants.importing", "Importing…"),
  loading: message("monthlyNewMerchants.loading", "Loading new merchants from the database…"),
  emptyTitle: message("monthlyNewMerchants.emptyTitle", "No new merchants have been added for this month"),
  emptyBody: message("monthlyNewMerchants.emptyBody", "No newly added merchants were found in the backend database for this month."),
  noMatchesTitle: message("monthlyNewMerchants.noMatchesTitle", "No merchants match your search"),
  noMatchesBody: message("monthlyNewMerchants.noMatchesBody", "Try a different merchant, ID, or BD."),
  databaseError: message("monthlyNewMerchants.databaseError", "The database is temporarily unavailable."),
  saved: message("monthlyNewMerchants.saved", "Merchant information and priority were saved to the database."),
  deleted: message("monthlyNewMerchants.deleted", "The merchant record was deleted from the database."),
  deleteConfirm: message("monthlyNewMerchants.deleteConfirm", "Delete this monthly new merchant record?"),
  edit: message("monthlyNewMerchants.edit", "Edit"),
  delete: message("monthlyNewMerchants.delete", "Delete"),
  row: message("monthlyNewMerchants.row", "Row"),
  status: message("monthlyNewMerchants.status", "Status"),
  ready: message("monthlyNewMerchants.ready", "Ready"),
  savedRow: message("monthlyNewMerchants.savedRow", "Saved"),
  savingRow: message("monthlyNewMerchants.savingRow", "Saving…"),
  previewEmpty: message("monthlyNewMerchants.previewEmpty", "Choose a file or paste a table to preview it here."),
  spreadsheetReaderError: message("monthlyNewMerchants.spreadsheetReaderError", "Could not read this spreadsheet. Try CSV or paste the table instead.")
}));

const countSummary = computed(() => {
  const rows = monthly.filteredRecords.value;
  const label = monthlyNewMerchantMonthLabel(monthly.month.value, props.language);
  const count = props.language === "zh"
    ? `${label} · ${rows.length} 个商家`
    : `${label} · ${rows.length} merchant${rows.length === 1 ? "" : "s"}`;
  const priority = monthly.priorityCount.value
    ? props.language === "zh"
      ? ` · ${monthly.priorityCount.value} 个重点推荐`
      : ` · ${monthly.priorityCount.value} priority`
    : "";
  const target = monthly.targetTotal.value > 0
    ? props.language === "zh"
      ? ` · GMV 目标 ${formatMonthlyNewMerchantMoney(monthly.targetTotal.value)}`
      : ` · GMV target ${formatMonthlyNewMerchantMoney(monthly.targetTotal.value)}`
    : "";
  return count + priority + target;
});

const importSummary = computed(() => {
  const rows = monthly.importRows.value;
  const validRows = rows.filter((row) => !row.errors.length && row.status !== "saved");
  const issueRows = rows.filter((row) => row.errors.length || row.status === "error");
  const savedRows = rows.filter((row) => row.status === "saved");
  if (props.language === "zh") {
    return `${rows.length} 行 · ${validRows.length} 行可导入 · ${issueRows.length} 行需处理${savedRows.length ? ` · ${savedRows.length} 行已保存` : ""}`;
  }
  return `${rows.length} row${rows.length === 1 ? "" : "s"} · ${validRows.length} ready · ${issueRows.length} with issues${savedRows.length ? ` · ${savedRows.length} saved` : ""}`;
});

const canImport = computed(() => monthly.importRows.value.some((row) => !row.errors.length && row.status !== "saved"));

function updateBodyLock(): void {
  document.body.classList.toggle("monthly-new-merchant-drawer-open", drawerOpen.value || importOpen.value);
}

function activeElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

function focusAfterClose(target: HTMLElement | null): void {
  void nextTick().then(() => target?.focus());
}

function resetForm(record: MonthlyNewMerchantRecord | null): void {
  const next = blankForm(record?.reportMonth || monthly.month.value);
  if (record) {
    Object.assign(next, {
      recordId: record.recordId,
      merchantId: record.merchantId,
      merchantName: record.merchantName,
      businessManager: record.businessManager,
      program: record.program,
      platform: record.platform,
      gmvRequirement: record.gmvRequirement,
      gmvMonthlyTarget: record.gmvMonthlyTarget === null ? "" : String(record.gmvMonthlyTarget),
      pastMonthPurchase: record.pastMonthPurchase,
      independentWebsites: record.independentWebsites,
      reviewSummary: record.reviewSummary,
      ourCommission: record.ourCommission === null ? "" : String(record.ourCommission),
      presetCommission: record.presetCommission === null ? "" : String(record.presetCommission),
      isPriority: record.isPriority,
      completionReward: record.completionReward
    });
  }
  Object.assign(form, next);
}

function openDrawer(record: MonthlyNewMerchantRecord | null = null): void {
  drawerRestoreFocus.value = activeElement();
  editingRecordId.value = record?.recordId || 0;
  drawerError.value = "";
  resetForm(record ? normalizeMonthlyNewMerchantRecord(record, props.offers) : null);
  drawerOpen.value = true;
  updateBodyLock();
  void nextTick().then(() => merchantNameInput.value?.focus());
}

function closeDrawer(restoreFocus = true): void {
  if (monthly.submitting.value) return;
  drawerOpen.value = false;
  editingRecordId.value = 0;
  drawerError.value = "";
  updateBodyLock();
  const target = restoreFocus ? drawerRestoreFocus.value : null;
  drawerRestoreFocus.value = null;
  if (target) focusAfterClose(target);
}

function openImport(): void {
  importRestoreFocus.value = activeElement();
  importOpen.value = true;
  importError.value = "";
  importPaste.value = "";
  monthly.resetImport();
  updateBodyLock();
  void nextTick().then(() => document.querySelector<HTMLButtonElement>('[data-modern-action="choose-file"]')?.focus());
}

function closeImport(restoreFocus = true): void {
  if (monthly.importing.value) return;
  importOpen.value = false;
  importError.value = "";
  updateBodyLock();
  const target = restoreFocus ? importRestoreFocus.value : null;
  importRestoreFocus.value = null;
  if (target) focusAfterClose(target);
}

function changeMonth(value: string): void {
  if (value === monthly.month.value) return;
  monthly.setMonth(value);
  if (props.autoLoad) void monthly.loadMonth(true);
}

function setSearch(event: Event): void {
  monthly.setSearch((event.target as HTMLInputElement).value);
}

function tableText(value: string): string {
  return value || "—";
}

function commissionText(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function tableAction(action: "priority" | "edit" | "delete", record: MonthlyNewMerchantRecord): void {
  if (action === "priority") {
    void togglePriority(record);
  } else if (action === "edit") {
    openDrawer(record);
  } else {
    void deleteMerchant(record);
  }
}

async function togglePriority(record: MonthlyNewMerchantRecord): Promise<void> {
  if (monthly.submitting.value) return;
  const success = await monthly.togglePriority(record);
  if (success) monthly.setNotice(copy.value.saved);
  else if (monthly.error.value) monthly.setNotice(monthly.error.value, "error");
}

async function deleteMerchant(record: MonthlyNewMerchantRecord): Promise<void> {
  if (monthly.submitting.value || !props.deleteData) return;
  if (!window.confirm(`${copy.value.deleteConfirm}\n${record.merchantName}`)) return;
  const success = await monthly.deleteRecord(record);
  if (success) monthly.setNotice(copy.value.deleted);
  else if (monthly.error.value) monthly.setNotice(monthly.error.value, "error");
}

async function submitForm(event: Event): Promise<void> {
  event.preventDefault();
  const formElement = event.currentTarget as HTMLFormElement;
  if (!formElement.reportValidity() || monthly.submitting.value) return;
  drawerError.value = "";
  const payload = buildMonthlyNewMerchantPayload({
    recordId: editingRecordId.value,
    reportMonth: form.reportMonth,
    merchantId: form.merchantId,
    merchantName: form.merchantName,
    businessManager: form.businessManager,
    program: form.program,
    platform: form.platform,
    gmvRequirement: form.gmvRequirement,
    gmvMonthlyTarget: form.gmvMonthlyTarget,
    pastMonthPurchase: form.pastMonthPurchase,
    independentWebsites: form.independentWebsites,
    reviewSummary: form.reviewSummary,
    ourCommission: form.ourCommission,
    presetCommission: form.presetCommission,
    isPriority: form.isPriority,
    completionReward: form.completionReward
  });
  const success = await monthly.saveRecord(payload);
  if (!success) {
    drawerError.value = monthly.error.value;
    return;
  }
  closeDrawer(false);
  monthly.setNotice(copy.value.saved);
  void nextTick().then(() => addButton.value?.focus());
}

function focusables(dialog: HTMLElement | null): HTMLElement[] {
  if (!dialog) return [];
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  )).filter((element) => !element.hidden && !(element instanceof HTMLInputElement && element.type === "hidden") && !element.closest(".hidden"));
}

function trapFocus(event: KeyboardEvent, dialog: HTMLElement | null, close: () => void): void {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const items = focusables(dialog);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

function issueText(value: string): string {
  if (props.language !== "zh") return value;
  const exact: Readonly<Record<string, string>> = {
    "No table rows found.": "没有找到可读取的表格行。",
    "A Brand or Merchant header is required.": "表格必须包含 Brand 或 Merchant 表头。",
    "No supported headers were recognized.": "未识别到受支持的表头。",
    "Brand is required.": "品牌不能为空。",
    "Merchant ID must be numeric.": "商家 ID 必须为数字。",
    "Duplicate brand in this import.": "导入表中品牌重复。",
    "Duplicate Merchant ID in this import.": "导入表中商家 ID 重复。"
  };
  if (exact[value]) return exact[value];
  if (value.startsWith("Invalid commission: ")) return `佣金格式无效：${value.slice("Invalid commission: ".length)}`;
  if (value.startsWith("Commission must be between 0% and 100%: ")) {
    return `佣金必须在 0% 到 100% 之间：${value.slice("Commission must be between 0% and 100%: ".length)}`;
  }
  return value;
}

function importResultError(result: MonthlyNewMerchantImportResult): string {
  const errors = [...result.errors];
  if (result.headers.length && !result.recognizedHeaders) errors.push("No supported headers were recognized.");
  return errors.map(issueText).join(" ");
}

function previewImport(): void {
  const result = monthly.previewImport(parseMonthlyNewMerchantTable(importPaste.value));
  importError.value = importResultError(result);
}

async function fileChanged(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  importError.value = "";
  monthly.setImportFileName(file.name);
  try {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const table = props.readFile
      ? await props.readFile(file)
      : extension === "xlsx" || extension === "xls"
        ? (() => { throw new Error(copy.value.spreadsheetReaderError); })()
        : parseMonthlyNewMerchantTable(await file.text(), extension === "tsv" ? "\t" : "");
    const result = monthly.previewImport(table);
    importError.value = importResultError(result);
  } catch (caughtError) {
    monthly.resetImport();
    monthly.setImportFileName(file.name);
    importError.value = caughtError instanceof Error ? caughtError.message : String(caughtError);
  }
}

function downloadTemplate(): void {
  const blob = new Blob([monthlyNewMerchantTemplateCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `monthly-new-merchants-${monthly.month.value}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function importRows(): Promise<void> {
  if (!canImport.value || monthly.importing.value) return;
  const result = await monthly.importReadyRows();
  if (!result.failed) {
    closeImport(false);
    monthly.setNotice(props.language === "zh"
      ? `已将 ${result.saved} 个商家保存到数据库。`
      : `${result.saved} merchant${result.saved === 1 ? "" : "s"} imported to the database.`);
    void nextTick().then(() => importButton.value?.focus());
  } else {
    importError.value = props.language === "zh"
      ? `${result.saved} 行已保存，${result.failed} 行失败；失败原因已高亮。`
      : `${result.saved} saved and ${result.failed} failed. The failed rows are highlighted.`;
  }
}

function importRowStatus(row: MonthlyNewMerchantImportResult["rows"][number]): string {
  const issues = [...row.errors, ...(row.saveError ? [row.saveError] : [])];
  if (row.status === "saved") return copy.value.savedRow;
  if (row.status === "saving") return copy.value.savingRow;
  if (issues.length) return issues.map(issueText).join(" ");
  return copy.value.ready;
}

onMounted(() => {
  if (props.autoLoad && props.loadData) void monthly.loadMonth();
});

onUnmounted(() => {
  document.body.classList.remove("monthly-new-merchant-drawer-open");
});
</script>

<template>
  <main
    class="oi-modern-page monthly-new-merchants-modern-page"
    data-page="monthly-new-merchants"
    :aria-busy="monthly.loading.value ? 'true' : 'false'"
    :inert="drawerOpen || importOpen"
  >
    <header class="monthly-new-merchants-header">
      <div>
        <h2>{{ copy.title }}</h2>
        <p>{{ copy.subtitle }}</p>
      </div>
      <div class="monthly-new-merchants-header-actions">
        <div class="monthly-new-merchants-month-control">
          <span>{{ copy.month }}</span>
          <MonthPicker :model-value="monthly.month.value" :language="language" :label="copy.month" :today="today" @update:model-value="changeMonth" />
        </div>
        <button ref="importButton" class="monthly-new-merchants-import" type="button" data-modern-action="import" @click="openImport">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" /></svg>
          <span>{{ copy.import }}</span>
        </button>
        <button ref="addButton" class="monthly-new-merchants-add" type="button" data-modern-action="add" @click="openDrawer()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          <span>{{ copy.add }}</span>
        </button>
      </div>
    </header>

    <div
      v-if="monthly.notice.value"
      class="monthly-new-merchants-notice"
      :class="{ error: monthly.noticeType.value === 'error' }"
      role="status"
      aria-live="polite"
    >{{ monthly.notice.value }}</div>

    <section class="panel monthly-new-merchants-panel" aria-label="Monthly new merchant records">
      <div class="monthly-new-merchants-toolbar">
        <label class="monthly-new-merchants-search">
          <span class="sr-only">{{ copy.search }}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
          <input
            type="search"
            :placeholder="copy.searchPlaceholder"
            data-modern-action="search"
            :value="monthly.search.value"
            @input="setSearch"
          />
        </label>
        <p class="monthly-new-merchants-count">{{ countSummary }}</p>
      </div>

      <div v-if="!monthly.filteredRecords.value.length" class="monthly-new-merchants-empty monthly-new-merchants-state" role="status">
        <template v-if="monthly.loading.value"><strong>{{ copy.loading }}</strong></template>
        <template v-else-if="monthly.error.value"><strong>{{ copy.databaseError }}</strong><span>{{ monthly.error.value }}</span></template>
        <template v-else>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16m-12 5h8"/></svg>
          <strong>{{ monthly.search.value.trim() ? copy.noMatchesTitle : copy.emptyTitle }}</strong>
          <span>{{ monthly.search.value.trim() ? copy.noMatchesBody : copy.emptyBody }}</span>
        </template>
      </div>
      <div v-else class="monthly-new-merchants-table-wrap" tabindex="0" :aria-label="copy.title">
        <table class="monthly-new-merchants-table">
          <thead>
            <tr>
              <th class="monthly-new-merchant-priority-column">{{ copy.priority }}</th>
              <th class="monthly-new-merchant-id-column">{{ copy.merchantId }}</th>
              <th>{{ copy.brand }}</th>
              <th>{{ copy.program }}</th>
              <th>{{ copy.platform }}</th>
              <th>{{ copy.gmvRequirement }}</th>
              <th>{{ copy.pastMonthPurchase }}</th>
              <th>{{ copy.independentWebsites }}</th>
              <th>{{ copy.reviewSummary }}</th>
              <th class="monthly-new-merchant-number">{{ copy.ourCommission }}</th>
              <th class="monthly-new-merchant-number">{{ copy.presetCommission }}</th>
              <th>{{ copy.bd }}</th>
              <th>{{ copy.updated }}</th>
              <th>{{ copy.actions }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="record in monthly.filteredRecords.value"
              :key="record.recordId || `${record.reportMonth}-${record.merchantName}`"
              :class="{ 'is-priority': record.isPriority }"
              :data-monthly-new-merchant-id="record.recordId"
            >
              <td class="monthly-new-merchant-priority-cell">
                <button
                  class="monthly-new-merchant-priority"
                  type="button"
                  data-monthly-new-merchant-action="priority"
                  :aria-pressed="record.isPriority ? 'true' : 'false'"
                  :aria-label="`${copy.priorityAction}: ${record.merchantName || copy.merchantName}`"
                  :disabled="!record.recordId || monthly.submitting.value"
                  @click="tableAction('priority', record)"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg>
                </button>
              </td>
              <td class="monthly-new-merchant-id-cell"><span :class="{ 'monthly-new-merchant-muted': !record.merchantId }">{{ tableText(record.merchantId) }}</span></td>
              <td><div class="monthly-new-merchant-name"><strong>{{ record.merchantName || copy.merchantName }}</strong></div></td>
              <td><span :class="{ 'monthly-new-merchant-muted': !record.program }">{{ tableText(record.program) }}</span></td>
              <td><span :class="{ 'monthly-new-merchant-muted': !record.platform }">{{ tableText(record.platform) }}</span></td>
              <td><span :class="{ 'monthly-new-merchant-muted': !record.gmvRequirement && record.gmvMonthlyTarget === null }">{{ record.gmvRequirement || (record.gmvMonthlyTarget === null ? '—' : formatMonthlyNewMerchantMoney(record.gmvMonthlyTarget)) }}</span></td>
              <td><span :class="{ 'monthly-new-merchant-muted': !record.pastMonthPurchase }">{{ tableText(record.pastMonthPurchase) }}</span></td>
              <td><span :class="{ 'monthly-new-merchant-muted': !record.independentWebsites }">{{ tableText(record.independentWebsites) }}</span></td>
              <td><span :class="{ 'monthly-new-merchant-muted': !record.reviewSummary }">{{ tableText(record.reviewSummary) }}</span></td>
              <td class="monthly-new-merchant-number"><span :class="{ 'monthly-new-merchant-muted': record.ourCommission === null }">{{ commissionText(record.ourCommission) }}</span></td>
              <td class="monthly-new-merchant-number"><span :class="{ 'monthly-new-merchant-muted': record.presetCommission === null }">{{ commissionText(record.presetCommission) }}</span></td>
              <td><span :class="{ 'monthly-new-merchant-muted': !record.businessManager }">{{ tableText(record.businessManager) }}</span></td>
              <td class="monthly-new-merchant-updated">{{ monthlyNewMerchantUpdatedText(record.updatedAt || record.createdAt, props.language) }}</td>
              <td>
                <div class="monthly-new-merchant-actions">
                  <button type="button" data-monthly-new-merchant-action="edit" :disabled="monthly.submitting.value" @click="tableAction('edit', record)">{{ copy.edit }}</button>
                  <button class="is-danger" type="button" data-monthly-new-merchant-action="delete" :disabled="monthly.submitting.value" @click="tableAction('delete', record)">{{ copy.delete }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

  </main>
    <Teleport to="body">
    <div v-if="drawerOpen || importOpen" class="monthly-new-merchants-modern-page monthly-new-merchants-overlay-root" data-modern-root>
    <div
      v-if="drawerOpen"
      class="monthly-new-merchant-drawer-backdrop"
      aria-hidden="false"
      @click.self="closeDrawer()"
    >
      <aside
        ref="drawerElement"
        class="monthly-new-merchant-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="monthlyNewMerchantModernDrawerTitle"
        @keydown="trapFocus($event, drawerElement, closeDrawer)"
      >
        <form @submit="submitForm">
          <header class="monthly-new-merchant-drawer-header">
            <div>
              <h2 id="monthlyNewMerchantModernDrawerTitle">{{ editingRecordId ? copy.editTitle : copy.addTitle }}</h2>
              <p>{{ copy.drawerSubtitle }}</p>
            </div>
            <button class="monthly-new-merchant-drawer-close" type="button" :aria-label="copy.close" @click="closeDrawer()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </header>

          <div class="monthly-new-merchant-form-body">
            <input v-model="form.recordId" type="hidden" />
            <input v-model="form.reportMonth" type="hidden" />
            <div class="monthly-new-merchant-form-grid">
              <h3 class="monthly-new-merchant-form-section">{{ copy.basics }}</h3>
              <label>
                <span>{{ copy.merchantId }}</span>
                <input v-model="form.merchantId" inputmode="numeric" maxlength="64" data-modern-field="merchant-id" />
              </label>
              <label>
                <span>{{ copy.merchantName }} <b>*</b></span>
                <input ref="merchantNameInput" v-model="form.merchantName" maxlength="180" required data-modern-field="merchant-name" />
              </label>
              <label><span>{{ copy.bd }}</span><input v-model="form.businessManager" maxlength="128" data-modern-field="business-manager" /></label>
              <label><span>{{ copy.program }}</span><input v-model="form.program" maxlength="128" data-modern-field="program" /></label>
              <label><span>{{ copy.platform }}</span><input v-model="form.platform" maxlength="128" data-modern-field="platform" /></label>
              <h3 class="monthly-new-merchant-form-section">{{ copy.goals }}</h3>
              <label><span>{{ copy.gmvRequirement }}</span><input v-model="form.gmvRequirement" maxlength="255" :placeholder="copy.gmvPlaceholder" data-modern-field="gmv-requirement" /></label>
              <label><span>{{ copy.gmvTarget }}</span><input v-model="form.gmvMonthlyTarget" type="number" inputmode="decimal" min="0" max="9999999999999999.99" step="0.01" placeholder="0.00" data-modern-field="gmv-target" /></label>
              <label><span>{{ copy.pastMonthPurchase }}</span><input v-model="form.pastMonthPurchase" maxlength="255" data-modern-field="past-month-purchase" /></label>
              <label><span>{{ copy.independentWebsites }}</span><input v-model="form.independentWebsites" maxlength="255" data-modern-field="independent-websites" /></label>
              <label><span>{{ copy.reviewSummary }}</span><input v-model="form.reviewSummary" maxlength="255" data-modern-field="review-summary" /></label>
              <h3 class="monthly-new-merchant-form-section">{{ copy.commissions }}</h3>
              <label><span>{{ copy.ourCommission }} (%)</span><input v-model="form.ourCommission" type="number" inputmode="decimal" min="0" max="100" step="0.01" data-modern-field="our-commission" /></label>
              <label><span>{{ copy.presetCommission }} (%)</span><input v-model="form.presetCommission" type="number" inputmode="decimal" min="0" max="100" step="0.01" data-modern-field="preset-commission" /></label>
              <label class="monthly-new-merchant-priority-field">
                <input v-model="form.isPriority" type="checkbox" data-modern-field="priority" />
                <span><strong>{{ copy.priorityAction }}</strong><small>{{ copy.priorityHelp }}</small></span>
              </label>
              <label class="monthly-new-merchant-notes-field">
                <span>{{ copy.reward }}</span>
                <textarea v-model="form.completionReward" rows="5" maxlength="1000" :placeholder="copy.rewardPlaceholder" data-modern-field="reward" />
              </label>
            </div>
            <div v-if="drawerError" class="monthly-new-merchant-form-error" role="alert">{{ drawerError }}</div>
          </div>

          <footer class="monthly-new-merchant-drawer-footer">
            <button class="monthly-new-merchant-cancel" type="button" data-modern-action="cancel-drawer" @click="closeDrawer()">{{ copy.cancel }}</button>
            <button class="monthly-new-merchant-save" type="submit" data-modern-action="save" :disabled="monthly.submitting.value">{{ monthly.submitting.value ? copy.saving : copy.save }}</button>
          </footer>
        </form>
      </aside>
    </div>

    <div
      v-if="importOpen"
      class="monthly-new-merchant-import-backdrop"
      aria-hidden="false"
      @click.self="closeImport()"
    >
      <section
        ref="importDialogElement"
        class="monthly-new-merchant-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="monthlyNewMerchantModernImportTitle"
        @keydown="trapFocus($event, importDialogElement, closeImport)"
      >
        <header class="monthly-new-merchant-import-header">
          <div>
            <h2 id="monthlyNewMerchantModernImportTitle">{{ copy.importTitle }}</h2>
            <p>{{ copy.importSubtitle }}</p>
          </div>
          <button class="monthly-new-merchant-drawer-close" type="button" :aria-label="copy.close" @click="closeImport()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <div class="monthly-new-merchant-import-body">
          <div class="monthly-new-merchant-import-actions">
            <input ref="importFileInput" type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" hidden @change="fileChanged" />
            <button type="button" data-modern-action="choose-file" @click="importFileInput?.click()">{{ copy.chooseFile }}</button>
            <div class="monthly-new-merchant-file-info"><strong>{{ monthly.importFileName.value || copy.noFile }}</strong><small>{{ copy.fileHint }}</small></div>
            <button type="button" data-modern-action="download-template" @click="downloadTemplate">{{ copy.downloadTemplate }}</button>
          </div>
          <label class="monthly-new-merchant-import-paste">
            <span>{{ copy.pasteLabel }}</span>
            <textarea v-model="importPaste" rows="7" :placeholder="copy.pastePlaceholder" data-modern-field="import-paste" />
          </label>
          <div class="monthly-new-merchant-import-preview-actions">
            <button type="button" data-modern-action="preview-import" @click="previewImport">{{ copy.preview }}</button>
            <p aria-live="polite">{{ importSummary }}</p>
          </div>
          <div v-if="importError" class="monthly-new-merchant-import-error" role="alert">{{ importError }}</div>
          <div class="monthly-new-merchant-import-preview">
            <div v-if="!monthly.importRows.value.length" class="monthly-new-merchants-empty"><span>{{ copy.previewEmpty }}</span></div>
            <table v-else>
              <thead><tr><th>{{ copy.row }}</th><th>{{ copy.brand }}</th><th>{{ copy.program }}</th><th>{{ copy.platform }}</th><th>{{ copy.gmvRequirement }}</th><th>{{ copy.ourCommission }}</th><th>{{ copy.presetCommission }}</th><th>{{ copy.status }}</th></tr></thead>
              <tbody>
                <tr v-for="row in monthly.importRows.value" :key="row.rowNumber" :class="{ 'has-error': row.errors.length || row.saveError }">
                  <td>{{ row.rowNumber }}</td>
                  <td><strong>{{ row.payload.merchantName || '—' }}</strong><br v-if="row.payload.merchantId" /><small v-if="row.payload.merchantId">ID {{ row.payload.merchantId }}</small></td>
                  <td>{{ row.payload.program || '—' }}</td>
                  <td>{{ row.payload.platform || '—' }}</td>
                  <td>{{ row.payload.gmvRequirement || '—' }}</td>
                  <td>{{ commissionText(row.payload.ourCommission) }}</td>
                  <td>{{ commissionText(row.payload.presetCommission) }}</td>
                  <td :class="{ 'import-status-error': row.errors.length || row.saveError }">{{ importRowStatus(row) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <footer class="monthly-new-merchant-drawer-footer">
          <button class="monthly-new-merchant-cancel" type="button" data-modern-action="cancel-import" @click="closeImport()">{{ copy.cancel }}</button>
          <button class="monthly-new-merchant-save" type="button" data-modern-action="import-save" :disabled="!canImport || monthly.importing.value" @click="importRows">{{ monthly.importing.value ? copy.importing : copy.importValid }}</button>
        </footer>
      </section>
    </div>
    </div>
    </Teleport>
</template>
