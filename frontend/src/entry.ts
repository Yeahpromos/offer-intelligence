import * as VueRuntime from "vue";
import { createApp, defineAsyncComponent, defineComponent, h } from "vue";
import type { Component } from "vue";

import "./shared/styles/modern-root.css";
import "./features/offer-tracker/offerTracker.css";
import "./features/payments/payments.css";
import "./features/publishers/publishers.css";
import "./features/brand-media/brandMedia.css";
import "./features/revenue-flow/revenueFlow.css";
import "./features/monthly-new-merchants/monthlyNewMerchants.css";
import "./features/google-ads/googleAds.css";
import "./features/targets/targets.css";
import "./features/category-report/categoryReport.css";
import "./features/tier-sheet/tierSheet.css";
import "./features/chatbot/chatbot.css";
import "./features/agent/agent.css";
import "./features/agent/agentWorkspace.css";
import "./shell/shell.css";

import { createModernAppApi, getAppSnapshot } from "./runtime/modernApp";
import type {
  AppBootstrapData,
  ModernPageController,
  ModernPageFactory,
  ModernShellFactory
} from "./runtime/contracts";
import type {
  OfferRecord,
  OfferTrackerDateRange,
  OfferTrackerExportPayload
} from "./shared/contracts/offer";
import type { PaymentExportPayload, PaymentLivePayload } from "./shared/contracts/payment";
import type { PublisherExportPayload } from "./features/publishers/publisherModel";
import { apiRequest } from "./shared/api/client";
import { ApiError } from "./shared/api/errors";
import {
  downloadWorkbook,
  objectExportColumns,
  safeSheetName,
  tierSheetExportColumns
} from "./shared/export/xlsx";
import { createI18nStore } from "./shared/i18n";
import { defaultPageForLevel } from "./shared/pageAccess";
import OfferTrackerPage from "./features/offer-tracker/OfferTrackerPage.vue";
import PaymentsPage from "./features/payments/PaymentsPage.vue";
import PublishersPage from "./features/publishers/PublishersPage.vue";
import BrandMediaPage from "./features/brand-media/BrandMediaPage.vue";
import type { BrandMediaTrendRequest } from "./features/brand-media/useBrandMedia";
import RevenueFlowPage from "./features/revenue-flow/RevenueFlowPage.vue";
import type { RevenueFlowCatalogOption } from "./features/revenue-flow/revenueFlowModel";
import type { RevenueFlowTrendRequest } from "./features/revenue-flow/useRevenueFlow";
import MonthlyNewMerchantsPage, {
  type MonthlyNewMerchantFileReader
} from "./features/monthly-new-merchants/MonthlyNewMerchantsPage.vue";
import { parseMonthlyNewMerchantTable } from "./features/monthly-new-merchants/monthlyNewMerchantsModel";
import type { MonthlyNewMerchantPayload } from "./features/monthly-new-merchants/monthlyNewMerchantsModel";
import type { MonthlyNewMerchantLoadRequest } from "./features/monthly-new-merchants/useMonthlyNewMerchants";
import TargetsPage from "./features/targets/TargetsPage.vue";
import type { TargetReportData } from "./features/targets/targetModel";
import type { TargetStatusRequest } from "./features/targets/useTargets";
import CategoryReportPage, {
  type CategoryExportPayload
} from "./features/category-report/CategoryReportPage.vue";
import type { CategoryReportData } from "./features/category-report/categoryReportModel";
import type { CategoryTierRequest } from "./features/category-report/useCategoryReport";
import TierSheetPage, {
  type TierExportPayload
} from "./features/tier-sheet/TierSheetPage.vue";
import type {
  SharedTierMoveSaveRequest,
  Tier1MerchantAddRequest,
  Tier1MerchantSearchRequest,
  TierReportLoadRequest
} from "./features/tier-sheet/useTierSheet";
import type { TierSheetReportData } from "./features/tier-sheet/tierSheetModel";
import GoogleAdsPage from "./features/google-ads/GoogleAdsPage.vue";
import type { GoogleAdsLoadRequest } from "./features/google-ads/useGoogleAds";
import ChatbotPage from "./features/chatbot/ChatbotPage.vue";
import { createChatbotSession } from "./features/chatbot/chatbotSession";
import type { ChatbotReportViewResult, ChatbotSession } from "./features/chatbot/chatbotViewTypes";
import AgentPage, { type AgentRunResult, type AgentRunner } from "./features/agent/AgentPage.vue";
import { createAgentSession, type AgentSession } from "./features/agent/agentSession";
import AppShell from "./shell/AppShell.vue";
import type { AppShellController } from "./shell/appShellContracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

window.OI_VUE_RUNTIME = VueRuntime;

let copilotKitComponentPromise: Promise<Component> | null = null;

function loadCopilotKitAgentComponent(): Promise<Component> {
  if (window.OI_COPILOTKIT_AGENT_COMPONENT) return Promise.resolve(window.OI_COPILOTKIT_AGENT_COMPONENT);
  if (copilotKitComponentPromise) return copilotKitComponentPromise;
  copilotKitComponentPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./assets/modern/oi-agent-runtime.js?v=20260903-copilotkit";
    script.async = true;
    script.onload = () => window.OI_COPILOTKIT_AGENT_COMPONENT
      ? resolve(window.OI_COPILOTKIT_AGENT_COMPONENT)
      : reject(new Error("CopilotKit Agent bundle did not register its component"));
    script.onerror = () => reject(new Error("CopilotKit Agent bundle could not be loaded"));
    document.head.appendChild(script);
  });
  return copilotKitComponentPromise;
}

const CopilotKitAgentHost = defineAsyncComponent({
  loader: loadCopilotKitAgentComponent,
  delay: 0,
  timeout: 20_000,
  errorComponent: defineComponent({
    name: "CopilotKitAgentFallback",
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () => h(AgentPage, {
        language: attrs.language,
        run: attrs.fallbackRun,
        session: attrs.fallbackSession,
        storage: attrs.storage,
        autoFocus: false
      } as never);
    }
  })
});

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

interface OfferTrackerOffersPayload {
  readonly offers?: unknown;
}

interface PaymentsApiPayload {
  readonly records?: unknown;
  readonly checkedAt?: unknown;
}

interface MonthlyNewMerchantsApiPayload {
  readonly records?: unknown;
}

function targetReportData(data: AppBootstrapData): TargetReportData {
  return isRecord(data.sheetReportData) ? data.sheetReportData as TargetReportData : { sheets: [] };
}

function categoryReportData(data: AppBootstrapData): CategoryReportData {
  const sheetReportData = isRecord(data.sheetReportData) ? data.sheetReportData : {};
  return {
    ...sheetReportData,
    offers: offerRecords(data)
  } as CategoryReportData;
}

function tierReportData(data: AppBootstrapData): TierSheetReportData {
  const sheetReportData = isRecord(data.sheetReportData) ? data.sheetReportData : {};
  return {
    ...sheetReportData,
    offers: offerRecords(data)
  } as TierSheetReportData;
}

interface SpreadsheetReader {
  readonly read: (data: ArrayBuffer, options: { readonly type: "array" }) => SpreadsheetWorkbook;
  readonly utils: {
    readonly sheet_to_json: (sheet: unknown, options: {
      readonly header: 1;
      readonly raw: false;
      readonly defval: string;
    }) => unknown;
  };
}

interface SpreadsheetWorkbook {
  readonly SheetNames: readonly string[];
  readonly Sheets: Readonly<Record<string, unknown>>;
}

interface WindowWithSpreadsheetReader extends Window {
  readonly XLSX?: SpreadsheetReader;
}

function chatbotRecord(data: AppBootstrapData): Record<string, unknown> {
  return isRecord(data.chatbotData) ? data.chatbotData : {};
}

function offerRecords(data: AppBootstrapData): readonly OfferRecord[] {
  const rows = chatbotRecord(data).offers;
  return Array.isArray(rows)
    ? rows.filter((row): row is OfferRecord => isRecord(row))
    : [];
}

function paymentRecords(data: AppBootstrapData): readonly Record<string, unknown>[] {
  const rows = chatbotRecord(data).paymentRecords;
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => isRecord(row))
    : [];
}

function sheetRows(data: AppBootstrapData): readonly Record<string, unknown>[] {
  const sheetReport = isRecord(data.sheetReportData) ? data.sheetReportData : {};
  const sheets = sheetReport.sheets;
  if (!Array.isArray(sheets)) return [];
  return sheets.flatMap((sheet) => {
    if (!isRecord(sheet) || !Array.isArray(sheet.rows)) return [];
    return sheet.rows.filter((row): row is Record<string, unknown> => isRecord(row));
  });
}

function defaultDateRange(data: AppBootstrapData): OfferTrackerDateRange {
  const chatbotData = chatbotRecord(data);
  const startDate = stringValue(chatbotData.startDate);
  const endDate = stringValue(chatbotData.endDate);
  if (startDate && endDate) return { startDate, endDate };
  return { startDate: "1970-01-01", endDate: "1970-01-01" };
}

async function loadOfferTrackerRange(range: OfferTrackerDateRange): Promise<readonly OfferRecord[]> {
  const query = new URLSearchParams({
    start_date: range.startDate,
    end_date: range.endDate
  });
  const payload = await apiRequest<OfferTrackerOffersPayload>(
    `/api/ui/db/offers?${query.toString()}`
  );
  if (!isRecord(payload) || !Array.isArray(payload.offers)) {
    throw new Error("Offer Tracker API 响应缺少 offers");
  }
  return payload.offers.filter((row): row is OfferRecord => isRecord(row));
}

function downloadOfferTracker(payload: OfferTrackerExportPayload): boolean {
  return downloadModernRows("offer-tracker", payload.rows, "Offers");
}

async function loadPayments(): Promise<PaymentLivePayload> {
  const payload = await apiRequest<PaymentsApiPayload>("/api/levanta/payments");
  if (!isRecord(payload) || !Array.isArray(payload.records)) {
    throw new Error("Payments API 响应缺少 records");
  }
  const checkedAt = stringValue(payload.checkedAt).slice(0, 10);
  return {
    records: payload.records,
    ...(checkedAt ? { checkedAt } : {})
  };
}

async function loadPublishers(): Promise<unknown> {
  return apiRequest<unknown>("/api/ui/db/publishers");
}

async function loadPublisherPortfolio(userId: string, startDate: string, endDate: string): Promise<unknown> {
  const query = new URLSearchParams({ userId });
  if (startDate) query.set("startDate", startDate);
  if (endDate) query.set("endDate", endDate);
  return apiRequest<unknown>(`/api/ui/db/publishers?${query.toString()}`);
}

async function loadBrandMediaCatalog(): Promise<unknown> {
  return apiRequest<unknown>("/api/ui/db/publishers");
}

async function loadBrandMediaTrend(request: BrandMediaTrendRequest): Promise<unknown> {
  const query = new URLSearchParams({
    merchantId: request.merchantId,
    startDate: request.startDate,
    endDate: request.endDate
  });
  return apiRequest<unknown>(`/api/ui/db/brand-media-trend?${query.toString()}`, {
    signal: request.signal,
    timeoutMs: 30_000
  });
}

async function loadRevenueFlowCatalog(): Promise<unknown> {
  return apiRequest<unknown>("/api/ui/db/publishers");
}

async function loadRevenueFlowTrend(request: RevenueFlowTrendRequest): Promise<unknown> {
  const query = new URLSearchParams({
    merchantIds: request.merchantIds.join(","),
    startDate: request.startDate,
    endDate: request.endDate
  });
  return apiRequest<unknown>("/api/ui/db/brand-media-sankey?" + query.toString(), {
    signal: request.signal,
    timeoutMs: 30_000
  });
}

async function loadMonthlyNewMerchants(request: MonthlyNewMerchantLoadRequest): Promise<unknown> {
  const query = new URLSearchParams({ month: request.month });
  return apiRequest<MonthlyNewMerchantsApiPayload>(
    `/api/ui/db/monthly-new-merchants?${query.toString()}`,
    { signal: request.signal }
  );
}

async function loadGoogleAds(request: GoogleAdsLoadRequest): Promise<unknown> {
  const query = new URLSearchParams({
    userId: request.userId,
    startDate: request.startDate,
    endDate: request.endDate
  });
  if (request.forceRefresh) query.set("refresh", "1");
  return apiRequest<unknown>(`/api/ui/db/google-ads-workbench?${query.toString()}`, {
    signal: request.signal,
    timeoutMs: 45_000
  });
}

async function saveMonthlyNewMerchant(payload: MonthlyNewMerchantPayload): Promise<unknown> {
  return apiRequest<unknown>("/api/ui/db/monthly-new-merchants", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  });
}

async function deleteMonthlyNewMerchant(recordId: number): Promise<unknown> {
  return apiRequest<unknown>("/api/ui/db/monthly-new-merchants", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ action: "delete", recordId })
  });
}

async function loadTargetStatus(request: TargetStatusRequest): Promise<unknown> {
  const query = new URLSearchParams({ month: request.monthKey });
  return apiRequest<unknown>(`/api/ui/db/status?${query.toString()}`, { signal: request.signal });
}

async function loadTargetTierSummary(request: TargetStatusRequest): Promise<unknown> {
  const query = new URLSearchParams({ month: request.monthKey });
  return apiRequest<unknown>(`/api/ui/db/tier-summary?${query.toString()}`, { signal: request.signal });
}

async function loadCategoryTier(request: CategoryTierRequest): Promise<unknown> {
  const query = new URLSearchParams({
    tier: request.tier,
    start_date: request.startDate,
    end_date: request.endDate,
    compact: "1"
  });
  return apiRequest<unknown>("/api/ui/db/tier_sheet?" + query.toString(), { signal: request.signal });
}

async function loadTierReport(request: TierReportLoadRequest): Promise<unknown> {
  const query = new URLSearchParams({
    tier: request.tier,
    start_date: request.startDate,
    end_date: request.endDate,
    compact: "1"
  });
  return apiRequest<unknown>("/api/ui/db/tier_sheet?" + query.toString(), {
    signal: request.signal,
    timeoutMs: 30_000
  });
}

interface TierMovesApiPayload {
  readonly configured?: unknown;
  readonly moves?: readonly unknown[];
  readonly [key: string]: unknown;
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function storedTierMoveAdminToken(): string {
  try {
    return browserStorage()?.getItem("offerTierMoveAdminToken")?.trim() || "";
  } catch {
    return "";
  }
}

function requestTierMoveAdminToken(): string {
  if (typeof window.prompt !== "function") return "";
  const token = String(window.prompt("Enter the tier move admin token") || "").trim();
  if (token) browserStorage()?.setItem("offerTierMoveAdminToken", token);
  return token;
}

async function loadSharedTierMoves(): Promise<unknown> {
  return apiRequest<TierMovesApiPayload>("/api/tier_moves");
}

async function saveSharedTierMoves(request: SharedTierMoveSaveRequest): Promise<unknown> {
  const body = JSON.stringify({
    action: request.action,
    updatedBy: "offer-intelligence-ui",
    moves: request.moves
  });
  const send = (token: string) => apiRequest<TierMovesApiPayload>("/api/tier_moves", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(token ? { "X-Tier-Move-Token": token } : {})
    },
    body
  });
  try {
    return await send(storedTierMoveAdminToken());
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const token = requestTierMoveAdminToken();
    if (!token) throw error;
    return send(token);
  }
}

async function loadTier1Additions(): Promise<unknown> {
  const query = new URLSearchParams({ action: "additions", limit: "250" });
  return apiRequest<unknown>(`/api/ui/db/tier1-merchants?${query.toString()}`);
}

async function searchTier1Merchants(request: Tier1MerchantSearchRequest): Promise<unknown> {
  const query = new URLSearchParams({ action: "search", q: request.query, limit: "10" });
  return apiRequest<unknown>(`/api/ui/db/tier1-merchants?${query.toString()}`, { signal: request.signal });
}

async function addTier1Merchant(request: Tier1MerchantAddRequest): Promise<unknown> {
  return apiRequest<unknown>("/api/ui/db/tier1-merchants", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ merchantId: request.merchantId, expectedTier: request.expectedTier })
  });
}

let monthlySpreadsheetReaderPromise: Promise<SpreadsheetReader> | null = null;

function loadMonthlySpreadsheetReader(): Promise<SpreadsheetReader> {
  const existing = (window as WindowWithSpreadsheetReader).XLSX;
  if (existing) return Promise.resolve(existing);
  if (monthlySpreadsheetReaderPromise) return monthlySpreadsheetReaderPromise;
  monthlySpreadsheetReaderPromise = new Promise<SpreadsheetReader>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.async = true;
    script.onload = () => {
      const reader = (window as WindowWithSpreadsheetReader).XLSX;
      if (reader) resolve(reader);
      else reject(new Error("Spreadsheet reader did not load."));
    };
    script.onerror = () => reject(new Error("Could not load the XLS/XLSX reader. Try CSV or paste the table instead."));
    document.head.appendChild(script);
  }).catch((error) => {
    monthlySpreadsheetReaderPromise = null;
    throw error;
  });
  return monthlySpreadsheetReaderPromise;
}

const readMonthlyMerchantFile: MonthlyNewMerchantFileReader = async (file) => {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (extension === "xlsx" || extension === "xls") {
    const reader = await loadMonthlySpreadsheetReader();
    const workbook = reader.read(await file.arrayBuffer(), { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
    if (!firstSheet) return [];
    const table = reader.utils.sheet_to_json(firstSheet, { header: 1, raw: false, defval: "" });
    return Array.isArray(table) ? table.filter((row): row is unknown[] => Array.isArray(row)) : [];
  }
  return parseMonthlyNewMerchantTable(
    await file.text(),
    extension === "tsv" ? "\t" : ""
  );
};

function revenueFlowInitialState(element: HTMLElement): {
  readonly merchants: readonly RevenueFlowCatalogOption[];
  readonly startDate: string;
  readonly endDate: string;
} {
  let merchants: RevenueFlowCatalogOption[] = [];
  try {
    const parsed = JSON.parse(element.dataset.initialMerchants || "[]") as unknown;
    if (Array.isArray(parsed)) {
      merchants = parsed.filter((item): item is Record<string, unknown> => isRecord(item))
        .map((item) => ({
          merchantId: stringValue(item.merchantId || item.id),
          name: stringValue(item.name || item.merchantName || item.merchantId || item.id),
          count: Number.isFinite(Number(item.count)) ? Math.max(0, Number(item.count)) : 0
        }))
        .filter((item) => item.merchantId)
        .slice(0, 12);
    }
  } catch {
    merchants = [];
  }
  return {
    merchants,
    startDate: stringValue(element.dataset.initialStartDate),
    endDate: stringValue(element.dataset.initialEndDate)
  };
}

function downloadPayments(payload: PaymentExportPayload): boolean {
  return downloadModernRows("payments", payload.rows, "Payments");
}

function downloadPublishers(payload: PublisherExportPayload): boolean {
  return downloadModernRows("publishers", payload.rows, "Publishers");
}

function exportDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeExportPart(value: unknown, fallback = "export"): string {
  const part = String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return part || fallback;
}

function downloadModernRows(
  kind: string,
  rows: readonly Readonly<Record<string, unknown>>[],
  sheetName: string
): boolean {
  if (!rows.length) return false;
  return downloadWorkbook(
    `${safeExportPart(kind)}_${rows.length}_rows_${exportDateStamp()}.xlsx`,
    { rows, columns: objectExportColumns(rows), sheetName: safeSheetName(sheetName) }
  );
}

function downloadCategory(payload: CategoryExportPayload): boolean {
  if (!payload.rows.length) return false;
  const scope = String(payload.label || "category").trim() || "category";
  return downloadWorkbook(
    `category_focus_${safeExportPart(scope)}_${payload.rows.length}_rows_${exportDateStamp()}.xlsx`,
    {
      rows: payload.rows,
      columns: objectExportColumns(payload.rows),
      sheetName: safeSheetName(scope)
    }
  );
}

function downloadTargets(payload: {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly scope: string;
}): boolean {
  if (!payload.rows.length) return false;
  const headers = [
    "Month", "Tier", "Brand Count", "Total Clicks", "Order Count", "Revenue",
    "Avg Conversion", "New Tier Entries", "Tier Exits", "Target"
  ];
  return downloadWorkbook(
    `monthly_targets_${safeExportPart(payload.scope, "all_months")}_${payload.rows.length}_rows_${exportDateStamp()}.xlsx`,
    {
      rows: payload.rows,
      columns: objectExportColumns(payload.rows, headers),
      sheetName: "Monthly Targets"
    }
  );
}

function downloadTier(payload: TierExportPayload): boolean {
  if (!payload.rows.length) return false;
  const sheets = payload.sheets?.length
    ? payload.sheets.map((sheet) => ({
        sheetName: sheet.sheetName,
        rows: sheet.rows,
        columns: tierSheetExportColumns(sheet.rows, sheet.headers)
      }))
    : [{
        sheetName: payload.tier,
        rows: payload.rows,
        columns: tierSheetExportColumns(payload.rows, payload.headers)
      }];
  return downloadWorkbook(
    `tier_records_${safeExportPart(payload.tier)}_${payload.rows.length}_rows_${exportDateStamp()}.xlsx`,
    { sheets }
  );
}

const shellFactory: ModernShellFactory = (element) => {
  const i18n = createI18nStore(getAppSnapshot().value.language);
  const snapshot = getAppSnapshot().value;
  const initialPage = defaultPageForLevel(snapshot.user.level) ?? "agent";
  let shellController: AppShellController | null = null;
  const app = createApp({
    name: "ModernAppShellMount",
    setup() {
      return () => h(AppShell, {
        initialPage,
        userLevel: snapshot.user.level,
        language: i18n.language.value,
        navigate(page) {
          window.OI_MODERN_APP?.setPage(page);
        },
        setLanguage(language) {
          if (window.OI_MODERN_APP?.setLanguage) {
            window.OI_MODERN_APP.setLanguage(language);
          } else {
            i18n.setLanguage(language);
          }
        },
        storage: browserStorage(),
        onReady(controller) {
          shellController = controller;
        }
      });
    }
  });
  app.mount(element);
  return {
    setPage(page) {
      shellController?.setPage(page);
    },
    setLanguage(language) {
      i18n.setLanguage(language);
      shellController?.setLanguage(language);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const offerTrackerFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const offers = offerRecords(snapshot);
  const range = defaultDateRange(snapshot);
  const app = createApp({
    name: "ModernOfferTrackerMount",
    setup() {
      return () => h(OfferTrackerPage, {
        offers,
        language: i18n.language.value,
        defaultDateRange: range,
        loadRange: loadOfferTrackerRange,
        download: downloadOfferTracker
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const paymentsFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernPaymentsMount",
    setup() {
      return () => h(PaymentsPage, {
        records: paymentRecords(snapshot),
        offers: offerRecords(snapshot),
        sheetRows: sheetRows(snapshot),
        language: i18n.language.value,
        loadLive: loadPayments,
        download: downloadPayments
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const publishersFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernPublishersMount",
    setup() {
      return () => h(PublishersPage, {
        language: i18n.language.value,
        loadData: loadPublishers,
        loadPortfolio: loadPublisherPortfolio,
        download: downloadPublishers
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const brandMediaFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernBrandMediaMount",
    setup() {
      return () => h(BrandMediaPage, {
        language: i18n.language.value,
        loadCatalog: loadBrandMediaCatalog,
        loadTrend: loadBrandMediaTrend
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const revenueFlowFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const initialState = revenueFlowInitialState(element);
  const app = createApp({
    name: "ModernRevenueFlowMount",
    setup() {
      return () => h(RevenueFlowPage, {
        language: i18n.language.value,
        initialMerchants: initialState.merchants,
        initialStartDate: initialState.startDate,
        initialEndDate: initialState.endDate,
        loadCatalog: loadRevenueFlowCatalog,
        loadTrend: loadRevenueFlowTrend
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const monthlyNewMerchantsFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernMonthlyNewMerchantsMount",
    setup() {
      return () => h(MonthlyNewMerchantsPage, {
        language: i18n.language.value,
        offers: offerRecords(snapshot),
        loadData: loadMonthlyNewMerchants,
        saveData: saveMonthlyNewMerchant,
        deleteData: deleteMonthlyNewMerchant,
        readFile: readMonthlyMerchantFile
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const googleAdsFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernGoogleAdsMount",
    setup() {
      return () => h(GoogleAdsPage, {
        language: i18n.language.value,
        userId: "19",
        loadData: loadGoogleAds
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const targetsFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernTargetsMount",
    setup() {
      return () => h(TargetsPage, {
        language: i18n.language.value,
        reportData: targetReportData(snapshot),
        loadStatus: loadTargetStatus,
        loadTierSummary: loadTargetTierSummary,
        download: downloadTargets
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const tierFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernTierSheetMount",
    setup() {
      return () => h(TierSheetPage, {
        language: i18n.language.value,
        reportData: tierReportData(snapshot),
        initialTier: element.dataset.initialTier || "Tier 1",
        storage: browserStorage(),
        loadTier: loadTierReport,
        loadSharedMoves: loadSharedTierMoves,
        saveSharedMoves: saveSharedTierMoves,
        loadTier1Additions,
        searchTier1Merchants,
        addTier1Merchant,
        download: downloadTier
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const categoryReportFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const app = createApp({
    name: "ModernCategoryReportMount",
    setup() {
      return () => h(CategoryReportPage, {
        language: i18n.language.value,
        reportData: categoryReportData(snapshot),
        loadTier: loadCategoryTier,
        download: downloadCategory
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

let modernChatbotSession: ChatbotSession | null = null;
let modernAgentSession: AgentSession | null = null;

function downloadChatbotReport(result: ChatbotReportViewResult): boolean {
  const rows = result.rows.length
    ? result.rows
    : [{ query: result.query, intent: result.intent, source: result.source, message: result.message, ...result.summary }];
  const scope = result.title || result.category || result.tier || result.intent || "report";
  return downloadWorkbook(
    `chatbot_${safeExportPart(scope)}_${rows.length}_rows_${exportDateStamp()}.xlsx`,
    {
      rows,
      columns: objectExportColumns(rows),
      sheetName: safeSheetName(scope)
    }
  );
}

function chatbotSession(snapshot: AppBootstrapData): ChatbotSession {
  if (!modernChatbotSession) {
    modernChatbotSession = createChatbotSession({
      offers: offerRecords(snapshot),
      paymentRecords: paymentRecords(snapshot),
      language: snapshot.language,
      llmEnabled: snapshot.llmEnabled,
      storage: browserStorage(),
      downloadReport: downloadChatbotReport
    });
  }
  modernChatbotSession.setLanguage?.(snapshot.language);
  return modernChatbotSession;
}

function agentSession(snapshot: AppBootstrapData): AgentSession {
  if (!modernAgentSession) {
    modernAgentSession = createAgentSession({
      offers: offerRecords(snapshot),
      paymentRecords: paymentRecords(snapshot),
      language: snapshot.language,
      storage: browserStorage(),
      agentEnabled: snapshot.agentEnabled
    });
  }
  modernAgentSession.setLanguage?.(snapshot.language);
  return modernAgentSession;
}

const chatbotFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const session = chatbotSession(snapshot);
  const app = createApp({
    name: "ModernChatbotMount",
    setup() {
      return () => h(ChatbotPage, {
        offers: offerRecords(snapshot),
        language: i18n.language.value,
        session,
        deepWindows: session.deepWindows,
        autoFocus: false
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
      session.setLanguage?.(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

const agentFactory: ModernPageFactory = (element): ModernPageController => {
  const snapshot = getAppSnapshot().value;
  const i18n = createI18nStore(snapshot.language);
  const session = agentSession(snapshot);
  const runtime = window.OI_COPILOTKIT_RUNTIME;
  const copilotKitEnabled = runtime?.enabled === true && runtime.authority === "python-registry";
  const fallbackSession = session;
  const fallbackRun: AgentRunner = async (request) => {
    const result = await fallbackSession.submit(request, {
      onToken: request.onToken,
      onTimeline: request.onTimeline,
      onResultView: request.onResultView
    });
    return {
      ...result,
      memoryEvents: result.memoryEvents as AgentRunResult["memoryEvents"]
    };
  };
  const app = createApp({
    name: "ModernAgentMount",
    setup() {
      return () => h(CopilotKitAgentHost, {
        language: i18n.language.value,
        endpoint: runtime?.endpoint || "/api/copilotkit",
        enabled: copilotKitEnabled,
        fallbackRun,
        fallbackSession,
        toolExecutor: session.executeTool,
        storage: browserStorage(),
      });
    }
  });
  app.mount(element);
  return {
    setLanguage(nextLanguage) {
      i18n.setLanguage(nextLanguage);
      session.setLanguage?.(nextLanguage);
      fallbackSession.setLanguage?.(nextLanguage);
    },
    unmount() {
      app.unmount();
      element.replaceChildren();
    }
  };
};

window.OI_MODERN_APP = createModernAppApi({
  "offer-list-tracker": offerTrackerFactory,
  payments: paymentsFactory,
  publishers: publishersFactory,
  "monthly-new-merchants": monthlyNewMerchantsFactory,
  "google-ads": googleAdsFactory,
  sheets: targetsFactory,
  "brand-media": brandMediaFactory,
  "revenue-flow": revenueFlowFactory,
  category: categoryReportFactory,
  tier: tierFactory,
  dashboard: chatbotFactory,
  agent: agentFactory
}, shellFactory);

// The modern entry owns exports and navigation. This bounded host exposes
// only the operations that modern feature components need.
window.OI_MODERN_RUNTIME = {
  download(type, payload) {
    if (type === "offer-tracker" && isRecord(payload) && Array.isArray(payload.rows)) {
      return downloadModernRows(type, payload.rows.filter(isRecord), "Offers");
    }
    if (type === "payments" && isRecord(payload) && Array.isArray(payload.rows)) {
      return downloadModernRows(type, payload.rows.filter(isRecord), "Payments");
    }
    if (type === "publishers" && isRecord(payload) && Array.isArray(payload.rows)) {
      return downloadModernRows(type, payload.rows.filter(isRecord), "Publishers");
    }
    return false;
  }
};
