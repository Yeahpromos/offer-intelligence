import type { UiLanguage } from "../../shared/i18n";
import { notifyAuthFailure } from "../../shared/api/client";
import { consumeSseResponse } from "../../shared/stream/sse";
import {
  normalizeAgentResultView,
  normalizeAgentResultViews,
  type AgentResultView
} from "../../shared/contracts/agentResult";
import {
  canonicalChatbotTier,
  normalizeChatbotText,
  resolveChatbotCategory,
  resolveChatbotMerchant
} from "../chatbot/chatbotModel";
import {
  applyAgentMemoryEvents,
  emptyAgentMemory,
  loadAgentMemory,
  saveAgentMemory,
  type AgentMemoryCandidate,
  type AgentMemoryEvent,
  type AgentMemoryState,
  type AgentRunStatus,
  type AgentTimelineStep
} from "./agentModel";

type Row = Readonly<Record<string, unknown>>;
type DataSource = "cache" | "database" | "mixed" | "unavailable" | "unknown";
export type AgentToolName =
  | "merchant_analysis"
  | "category_analysis"
  | "merchant_comparison"
  | "tier_analysis"
  | "category_comparison"
  | "payment_status"
  | "trend";

type ToolName = AgentToolName;

export const AGENT_TOOL_NAMES: readonly ToolName[] = [
  "merchant_analysis",
  "category_analysis",
  "merchant_comparison",
  "tier_analysis",
  "category_comparison",
  "payment_status",
  "trend"
];

export interface AgentHistoryMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AgentSessionRequest {
  readonly prompt: string;
  readonly language: UiLanguage;
  readonly history: readonly AgentHistoryMessage[];
  readonly memoryText: string;
  readonly signal: AbortSignal;
}

export interface AgentSessionCallbacks {
  readonly onToken?: (token: string) => void;
  readonly onTimeline?: (step: AgentTimelineStep) => void;
  readonly onResultView?: (view: AgentResultView) => void;
  readonly onChange?: (state: AgentSessionState) => void;
}

export interface AgentToolExecutionRequest {
  readonly callId: string;
  readonly toolName: AgentToolName;
  readonly arguments: Record<string, unknown>;
  readonly prompt: string;
  readonly signal: AbortSignal;
}

export interface AgentToolExecutionResponse {
  readonly toolResult: Record<string, unknown>;
  readonly memoryEvent?: AgentMemoryEvent;
  readonly resultView?: AgentResultView;
}

export interface AgentSessionResult {
  readonly ok: boolean;
  readonly status: Exclude<AgentRunStatus, "idle" | "running">;
  readonly response: string;
  readonly steps: readonly AgentTimelineStep[];
  readonly partial?: boolean;
  readonly omittedTargets?: readonly string[];
  readonly resultViews?: readonly AgentResultView[];
  readonly memoryEvents?: readonly AgentMemoryEvent[];
  readonly errorCode?: string | null;
}

export interface AgentViewSessionResult extends Omit<AgentSessionResult, "memoryEvents"> {
  readonly memoryEvents?: readonly unknown[];
}

export interface AgentSessionState {
  readonly status: AgentRunStatus;
  readonly history: readonly AgentHistoryMessage[];
  readonly messages?: readonly AgentHistoryMessage[];
  readonly steps: readonly AgentTimelineStep[];
  readonly response: string;
  readonly partial: boolean;
  readonly omittedTargets: readonly string[];
  readonly resultViews?: readonly AgentResultView[];
  readonly hasMemory: boolean;
  readonly memory?: unknown;
  readonly errorCode?: string | null;
}

export interface AgentFeedbackResult {
  readonly ok: boolean;
  readonly alreadyExists?: boolean;
  readonly errorCode?: string;
}

export interface AgentFeedback {
  isAvailable(): boolean;
  submit(reasonCode: string, reasonDetail?: string): Promise<AgentFeedbackResult>;
}

export interface AgentViewSession {
  getState(): AgentSessionState;
  setLanguage?(language: UiLanguage): void;
  submit(request: AgentSessionRequest, callbacks?: AgentSessionCallbacks): Promise<AgentViewSessionResult>;
  stop(): void;
  newConversation(): void;
  onChange(listener: (state: AgentSessionState) => void): () => void;
  feedback?: AgentFeedback;
  downloadLogs?: (kind: "questions" | "feedback", format: "csv" | "jsonl") => boolean;
  dispose?: () => void;
}

export interface AgentSession extends AgentViewSession {
  submit(request: AgentSessionRequest, callbacks?: AgentSessionCallbacks): Promise<AgentSessionResult>;
  executeTool(request: AgentToolExecutionRequest): Promise<AgentToolExecutionResponse>;
}

export interface AgentSessionOptions {
  readonly offers: readonly Row[];
  readonly paymentRecords?: readonly Row[];
  readonly language: UiLanguage;
  readonly storage?: Storage;
  readonly agentEnabled?: boolean;
  readonly signal?: AbortSignal;
  readonly fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly enableQuestionLogging?: boolean;
  readonly enableTrace?: boolean;
  readonly dataAsOf?: string | null;
}

interface AgentToolCall {
  readonly id: string;
  readonly name: ToolName;
  readonly arguments: Record<string, unknown>;
}

interface AgentPlan {
  readonly agentRunId: string;
  readonly planProof?: string;
  readonly content: string;
  readonly toolCalls: readonly AgentToolCall[];
}

interface AgentToolResult {
  readonly ok: boolean;
  readonly source: {
    readonly dataSource: DataSource;
    readonly dataAsOf: string | null;
    readonly estimated: boolean;
  };
  readonly data?: Record<string, unknown>;
  readonly errorCode?: "tool_error" | "tool_timeout" | "llm_timeout" | "invalid_arguments" | "invalid_filter" | "not_found" | "stopped_by_user";
  readonly resolution?: Record<string, unknown>;
}

interface AgentToolExecution {
  readonly call: AgentToolCall;
  readonly result: AgentToolResult;
}

interface QuestionContext {
  readonly eventId: string;
  readonly prompt: string;
  readonly language: UiLanguage;
  readonly answer: string;
  recordPromise: Promise<{ readonly recordId: string } | null>;
  completionPromise?: Promise<{ readonly recordId: string } | null>;
  feedbackEventId?: string;
}

interface TraceContext {
  readonly runId: string;
  readonly questionEventId: string;
  readonly sessionId: string;
  readonly startedAt: string;
  readonly language: UiLanguage;
}

interface JsonPayload {
  readonly ok?: unknown;
  readonly errorCode?: unknown;
  readonly recordId?: unknown;
  readonly [key: string]: unknown;
}

const MAX_HISTORY = 24;
const MAX_TOOL_CALLS = 6;
const MAX_PLAN_PROOFS = 2;
const MAX_MEMORY_TEXT = 8_000;
const SESSION_STORAGE_KEY = "oi_agent_session_v1";
const ENABLED_ERROR_CODES = new Set([
  "tool_error",
  "tool_timeout",
  "llm_timeout",
  "invalid_arguments",
  "invalid_filter",
  "not_found",
  "stopped_by_user"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, maximum = 120_000): string {
  return String(value ?? "").trim().slice(0, maximum);
}

function numberValue(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function firstValue(row: Row, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function numberFor(row: Row, keys: readonly string[]): number {
  return numberValue(firstValue(row, keys));
}

function merchantId(row: Row): string {
  return text(firstValue(row, ["merchantId", "merchant_id", "Merchant ID", "MerchantID", "id"]), 80).replace(/\.0$/, "");
}

function merchantName(row: Row): string {
  return text(firstValue(row, ["brand", "merchantName", "merchant_name", "Merchant Name", "Merchant"]), 120) || merchantId(row);
}

function rowTier(row: Row): string {
  return canonicalChatbotTier(firstValue(row, ["tier", "Tier"]));
}

function rowCategories(row: Row): string[] {
  const keys = ["sheetCategory", "Sheet Category", "mainCategory", "Main Category", "category", "Category", "levantaCategory"];
  return keys.flatMap((key) => {
    const value = row[key];
    return Array.isArray(value) ? value.map((item) => text(item, 120)).filter(Boolean) : [text(value, 120)];
  }).filter(Boolean);
}

function normalizedCategories(rows: readonly Row[]): string[] {
  return Array.from(new Set(rows.flatMap(rowCategories).filter((value) => normalizeChatbotText(value) !== "uncategorized")));
}

function rowMatchesCategory(row: Row, category: string): boolean {
  const query = normalizeChatbotText(category);
  return Boolean(query) && rowCategories(row).some((value) => {
    const normalized = normalizeChatbotText(value);
    return normalized === query || normalized.includes(query) || query.includes(normalized);
  });
}

function metricValues(row: Row): Record<string, number> {
  const clicks = numberFor(row, ["clicks", "Clicks", "totalClicks"]);
  const orders = numberFor(row, ["orders", "orderCount", "Order count", "Order Count"]);
  const revenue = numberFor(row, ["salesAmount", "revenue", "Revenue", "revenueMade"]);
  const commission = numberFor(row, ["affCommission", "commissionMade", "AFF Commission", "affiliatePayout", "payout"]);
  const epcRaw = numberFor(row, ["epc", "EPC"]);
  const aovRaw = numberFor(row, ["aov", "AOV"]);
  const conversionRaw = numberFor(row, ["conversionRate", "conversion", "CVR"]);
  return {
    clicks,
    orders,
    revenue,
    commission,
    epc: epcRaw || (clicks ? revenue / clicks : 0),
    aov: aovRaw || (orders ? revenue / orders : 0),
    conversionRate: conversionRaw || (clicks ? orders / clicks : 0)
  };
}

function aggregate(rows: readonly Row[]): Record<string, unknown> {
  const totals = rows.map(metricValues).reduce((result, item) => {
    Object.entries(item).forEach(([key, value]) => { result[key] = (result[key] || 0) + value; });
    return result;
  }, {} as Record<string, number>);
  const clicks = totals.clicks || 0;
  const orders = totals.orders || 0;
  const revenue = totals.revenue || 0;
  return {
    merchantCount: new Set(rows.map(merchantId).filter(Boolean)).size || rows.length,
    clicks,
    orders,
    revenue,
    commission: totals.commission || 0,
    epc: clicks ? revenue / clicks : 0,
    aov: orders ? revenue / orders : 0,
    conversionRate: clicks ? orders / clicks : 0
  };
}

function merchantObject(row: Row): Record<string, unknown> {
  const id = merchantId(row);
  return { ...(id ? { id } : {}), name: merchantName(row) };
}

function merchantData(row: Row): Record<string, unknown> {
  const categories = rowCategories(row);
  return {
    merchant: merchantObject(row),
    ...(rowTier(row) ? { tier: rowTier(row) } : {}),
    ...(categories[0] ? { category: categories[0] } : {}),
    metrics: Object.fromEntries(Object.entries(metricValues(row)).map(([key, value]) => [key, rounded(value)]))
  };
}

function resultSource(dataSource: DataSource, dataAsOf: string | null, estimated = false): AgentToolResult["source"] {
  return { dataSource, dataAsOf: dataAsOf || null, estimated };
}

function success(data: Record<string, unknown>, dataSource: DataSource, dataAsOf: string | null = null, estimated = false): AgentToolResult {
  return { ok: true, source: resultSource(dataSource, dataAsOf, estimated), data };
}

function failure(
  errorCode: AgentToolResult["errorCode"],
  dataSource: DataSource = "cache",
  resolution?: Record<string, unknown>
): AgentToolResult {
  return {
    ok: false,
    source: resultSource(dataSource, null),
    errorCode: errorCode || "tool_error",
    ...(resolution ? { resolution } : {})
  };
}

function safeErrorCode(value: unknown): string {
  const code = text(value, 64).toLowerCase();
  return ENABLED_ERROR_CODES.has(code) ? code : "tool_error";
}

function randomUuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // 本地测试环境没有 Web Crypto 时使用格式合法的回退值。
  }
  const value = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
    .replace(/[^a-f0-9]/gi, "").padEnd(32, "0").slice(0, 32);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function getSessionId(storage?: Storage): string {
  try {
    const saved = storage?.getItem(SESSION_STORAGE_KEY)?.trim();
    if (saved && /^[A-Za-z0-9._:-]{16,64}$/.test(saved)) return saved;
    const next = `agent-${randomUuid().replace(/-/g, "")}`.slice(0, 64);
    storage?.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return `agent-${randomUuid().replace(/-/g, "")}`.slice(0, 64);
  }
}

function linkSignal(parent: AbortSignal | undefined, external: AbortSignal | undefined): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = (event: Event): void => controller.abort((event.target as AbortSignal).reason);
  if (parent?.aborted || external?.aborted) controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  external?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      parent?.removeEventListener("abort", abort);
      external?.removeEventListener("abort", abort);
    }
  };
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || (isRecord(error) && error.name === "AbortError"));
}

function clipHistory(history: readonly AgentHistoryMessage[]): AgentHistoryMessage[] {
  return (Array.isArray(history) ? history : []).slice(-4).flatMap((item) => {
    if (!item || (item.role !== "user" && item.role !== "assistant")) return [];
    const content = text(item.content, 1_200);
    return content ? [{ role: item.role, content }] : [];
  });
}

function isDataQuestion(prompt: string): boolean {
  const value = text(prompt, 4_000);
  if (!value) return false;
  if (/(?:what is|definition|meaning|how to calculate|\u4ec0\u4e48\u662f|\u542b\u4e49|\u5982\u4f55\u8ba1\u7b97)/i.test(value)
    && !/(?:current|latest|how many|show|list|data|\u5f53\u524d|\u6700\u65b0|\u591a\u5c11|\u67e5\u8be2|\u5217\u51fa|\u6570\u636e)/i.test(value)) return false;
  return /(?:epc|aov|cvr|conversion|revenue|sales|orders|clicks|commission|payout|payment|trend|monthly|merchant|category|tier|report|data|\u4ed8\u6b3e|\u6536\u5165|\u8ba2\u5355|\u70b9\u51fb|\u8d8b\u52bf|\u6708\u5ea6|\u5546\u6237|\u54c1\u7c7b|\u5c42\u7ea7|\u6570\u636e)/i.test(value);
}

function hasVerifiableContext(prompt: string, memory: string, history: readonly AgentHistoryMessage[]): boolean {
  const value = `${prompt} ${memory} ${history.map((item) => item.content).join(" ")}`;
  return /(?:\b(?:epc|aov|cvr|revenue|sales|orders|clicks|commission|payout|payment|trend|monthly)\b|\u4ed8\u6b3e|\u6536\u5165|\u8ba2\u5355|\u70b9\u51fb|\u8d8b\u52bf|\u6708\u5ea6|\u6570\u636e)\s*(?:is|=|:|\u662f|\u4e3a)/i.test(value)
    || /(?:\b(?:epc|aov|cvr|revenue|sales|orders|clicks)\b)\s*[-+]?\d+(?:[.,]\d+)?/i.test(value);
}

function missingDataResponse(language: UiLanguage): string {
  return language === "en"
    ? "I do not have a verifiable data source for this specific question yet. Please provide the merchant, time range, and metric, or retry so I can run a data lookup."
    : "\u5f53\u524d\u6ca1\u6709\u53ef\u9a8c\u8bc1\u7684\u6570\u636e\u6765\u6e90\uff0c\u65e0\u6cd5\u76f4\u63a5\u7ed9\u51fa\u5177\u4f53\u6570\u636e\u7ed3\u8bba\u3002\u8bf7\u8865\u5145\u5546\u6237\u3001\u65f6\u95f4\u8303\u56f4\u548c\u6307\u6807\uff0c\u6216\u91cd\u8bd5\u4ee5\u6267\u884c\u6570\u636e\u67e5\u8be2\u3002";
}

function rowMonth(row: Row): string {
  const value = text(firstValue(row, ["month", "monthKey", "reportMonth", "reportMonthKey", "date"]), 40);
  const match = value.match(/(20\d{2})[-\/]?(0?[1-9]|1[0-2])/);
  return match?.[1] && match[2] ? `${match[1]}-${match[2].padStart(2, "0")}` : value.slice(0, 7);
}

function monthlyData(row: Row, metric?: string): Record<string, unknown> {
  const values = metricValues(row);
  const result: Record<string, unknown> = {
    month: rowMonth(row),
    metrics: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, rounded(value)]))
  };
  if (metric) result.value = rounded(metricValue(row, metric));
  return result;
}

function tierDistribution(rows: readonly Row[]): Record<string, number> {
  const result: Record<string, number> = {};
  rows.forEach((row) => {
    const tier = rowTier(row) || "Unknown";
    result[tier] = (result[tier] || 0) + 1;
  });
  return result;
}

function categorySummary(rows: readonly Row[], category: string): Record<string, unknown> {
  const sorted = rows.slice().sort((left, right) => (metricValues(right).revenue || 0) - (metricValues(left).revenue || 0));
  return {
    category,
    merchantCount: new Set(rows.map(merchantId).filter(Boolean)).size || rows.length,
    aggregates: aggregate(rows),
    topMerchants: sorted.slice(0, 5).map((row) => ({ merchant: merchantObject(row), metrics: metricValues(row) }))
  };
}

function resolveMerchant(input: string, offers: readonly Row[]): { row?: Row; result?: AgentToolResult } {
  const resolution = resolveChatbotMerchant(input, offers);
  if (resolution.status === "resolved" && resolution.matches[0]?.offer) return { row: resolution.matches[0].offer };
  const candidates = resolution.matches.slice(0, 10).map((match) => {
    const row = match.offer;
    return {
      merchantId: merchantId(row),
      name: merchantName(row),
      ...(rowTier(row) ? { tier: rowTier(row) } : {}),
      ...(rowCategories(row)[0] ? { category: rowCategories(row)[0] } : {})
    };
  });
  return {
    result: failure("not_found", offers.length ? "cache" : "unavailable", {
      status: resolution.status === "ambiguous" ? "invalid_filter" : "not_found",
      field: "merchant",
      candidates,
      value: text(input, 80)
    })
  };
}

function paymentStatusValue(row: Row): string {
  const value = text(firstValue(row, ["paymentStatus", "status"]), 40).toLowerCase();
  if (value.includes("overdue") || value.includes("\u903e\u671f")) return "overdue";
  if (value.includes("unpaid") || value.includes("\u672a\u4ed8") || value.includes("\u672a\u652f\u4ed8")) return "unpaid";
  if (value.includes("pending") || value.includes("\u5f85\u5904\u7406") || value.includes("\u5f85\u4ed8\u6b3e")) return "pending";
  if (value.includes("partial") || value.includes("\u90e8\u5206")) return "partial";
  if (value.includes("paid") || value.includes("\u5df2\u4ed8") || value.includes("\u5df2\u652f\u4ed8")) return "paid";
  return value;
}

function paymentMonthValue(row: Row): string {
  return text(firstValue(row, ["reportMonthKey", "monthKey", "reportMonth", "month"]), 20);
}

function paymentRowData(row: Row): Record<string, unknown> {
  return {
    merchant: text(row.merchantName || row.brand || merchantId(row), 120),
    ...(rowTier(row) ? { tier: rowTier(row) } : {}),
    month: paymentMonthValue(row),
    status: paymentStatusValue(row),
    ...(text(row.paymentCycle, 40) ? { cycle: text(row.paymentCycle, 40) } : {}),
    expected: rounded(numberFor(row, ["expectedPaymentAmount", "expectedAmount", "amount"])),
    remaining: rounded(numberFor(row, ["remainingAmount", "remaining"])),
    due: text(row.paymentAvailabilityDate || row.expectedPaymentDate, 40)
  };
}

function paymentMerchantMatches(row: Row, merchant: Row): boolean {
  const id = merchantId(merchant);
  const name = normalizeChatbotText(merchantName(merchant));
  return Boolean((id && merchantId(row) === id) || (name && normalizeChatbotText(text(row.merchantName || row.brand)) === name));
}

function metricKey(value: unknown): string | null {
  const key = text(value, 40);
  return ["revenue", "orders", "epc", "aov", "clicks", "affiliatePayout", "dpv", "atc", "conversionRate", "payout", "directSales", "haloSales"].includes(key)
    ? key : null;
}

function metricValue(row: Row, metric: string): number {
  if (metric === "affiliatePayout" || metric === "payout") return numberFor(row, [metric, "affCommission", "commissionMade", "payout"]);
  if (metric === "directSales") return numberFor(row, ["directSales", "direct_sales"]);
  if (metric === "haloSales") return numberFor(row, ["haloSales", "halo_sales"]);
  if (metric === "dpv") return numberFor(row, ["dpv", "detailPageViews"]);
  if (metric === "atc") return numberFor(row, ["atc", "addToCart"]);
  return metricValues(row)[metric] || 0;
}

function trendRows(rows: readonly Row[], requestedMonths: number, metric: string): Record<string, unknown>[] {
  const grouped = new Map<string, Row[]>();
  rows.forEach((row) => {
    const month = rowMonth(row);
    if (!/^20\d{2}-\d{2}$/.test(month)) return;
    grouped.set(month, [...(grouped.get(month) || []), row]);
  });
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).slice(-requestedMonths).map(([month, monthRows]) => ({
    month,
    value: rounded(monthRows.reduce((sum, row) => sum + metricValue(row, metric), 0)),
    metrics: aggregate(monthRows)
  }));
}

function trendSummary(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const values = rows.map((row) => numberValue(row.value));
  const first = values[0] || 0;
  const latest = values.at(-1) || 0;
  return {
    first: rounded(first),
    latest: rounded(latest),
    change: rounded(latest - first),
    changeRate: first ? rounded((latest - first) / first) : 0
  };
}

function requestedMetrics(prompt: string): string[] {
  const result: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["conversionRate", /cvr|conversion|\u8f6c\u5316/i],
    ["affiliatePayout", /affiliate|commission|payout|\u4f63\u91d1/i],
    ["revenue", /revenue|sales|\u6536\u5165|\u9500\u552e/i],
    ["orders", /orders?|\u8ba2\u5355/i],
    ["clicks", /clicks?|\u70b9\u51fb/i],
    ["epc", /\bepc\b/i],
    ["aov", /\baov\b/i]
  ];
  patterns.forEach(([name, pattern]) => { if (pattern.test(prompt)) result.push(name); });
  return result.slice(0, 12);
}

export function createAgentSession(options: AgentSessionOptions): AgentSession {
  const offers = options.offers.slice();
  const paymentRecords = (options.paymentRecords || []).slice();
  const storage = options.storage;
  const fetcher = options.fetcher || ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const listeners = new Set<(state: AgentSessionState) => void>();
  let currentLanguage: UiLanguage = options.language;
  let status: AgentRunStatus = "idle";
  let history: AgentHistoryMessage[] = [];
  let messages: AgentHistoryMessage[] = [];
  let steps: AgentTimelineStep[] = [];
  let resultViews: AgentResultView[] = [];
  let response = "";
  let partial = false;
  let omittedTargets: string[] = [];
  let errorCode: string | null = null;
  let memory = options.storage ? loadAgentMemory(options.storage) : emptyAgentMemory();
  let activeController: AbortController | null = null;
  let disposed = false;
  let activeCallbacks: AgentSessionCallbacks | null = null;
  let currentQuestion: QuestionContext | null = null;
  let lastResultOk = false;
  let traceQueue: Promise<void> = Promise.resolve();

  function state(): AgentSessionState {
    return {
      status,
      history: history.slice(-MAX_HISTORY),
      messages: messages.slice(-MAX_HISTORY),
      steps: steps.map((step) => ({ ...step })),
      resultViews: normalizeAgentResultViews(resultViews),
      response,
      partial,
      omittedTargets: omittedTargets.slice(0, 20),
      hasMemory: Boolean(memory.focus.merchants.length || memory.focus.categories.length || memory.focus.tiers.length || memory.lastTool),
      memory,
      ...(errorCode ? { errorCode } : {})
    };
  }

  function notify(): void {
    if (disposed) return;
    const next = state();
    listeners.forEach((listener) => listener(next));
    activeCallbacks?.onChange?.(next);
  }

  function emitStep(step: AgentTimelineStep): void {
    const index = steps.findIndex((item) => item.id === step.id);
    if (index < 0) steps = [...steps, step];
    else steps = steps.map((item, itemIndex) => itemIndex === index ? step : item);
    activeCallbacks?.onTimeline?.(step);
    notify();
  }

  function emitResultView(view: AgentResultView): void {
    const index = resultViews.findIndex((item) => item.id === view.id);
    resultViews = index < 0
      ? normalizeAgentResultViews([...resultViews, view])
      : normalizeAgentResultViews(resultViews.map((item, itemIndex) => itemIndex === index ? view : item));
    activeCallbacks?.onResultView?.(view);
    notify();
  }

  function updateStep(id: string, update: Partial<AgentTimelineStep>): void {
    const existing = steps.find((step) => step.id === id);
    if (existing) emitStep({ ...existing, ...update });
  }

  async function requestJson<T extends JsonPayload>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController();
    const linked = linkSignal(signal, controller.signal);
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
      const result = await fetcher(url, {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
        headers: { Accept: "application/json", ...(init.headers || {}) },
        signal: linked.signal
      });
      if (result.status === 401 || result.status === 403) notifyAuthFailure(result.status);
      let payload: unknown = null;
      try {
        payload = await result.json();
      } catch {
        throw new Error("invalid_json");
      }
      if (!result.ok || (isRecord(payload) && payload.ok === false)) {
        const error = new Error(safeErrorCode(isRecord(payload) ? payload.errorCode : undefined));
        (error as Error & { code?: string }).code = safeErrorCode(isRecord(payload) ? payload.errorCode : undefined);
        throw error;
      }
      return (isRecord(payload) ? payload : {}) as T;
    } finally {
      clearTimeout(timeoutId);
      linked.dispose();
    }
  }

  function enqueueTrace(body: Record<string, unknown>): void {
    if (options.enableTrace === false) return;
    traceQueue = traceQueue
      .then(() => requestJson<JsonPayload>("/api/chat/stream?operation=agent_trace", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body)
      }))
      .then(() => undefined)
      .catch(() => undefined);
  }

  function beginTrace(questionEventId: string): TraceContext {
    const trace: TraceContext = {
      runId: randomUuid(),
      questionEventId,
      sessionId: getSessionId(storage),
      startedAt: new Date().toISOString(),
      language: currentLanguage
    };
    enqueueTrace({
      runId: trace.runId,
      questionEventId: trace.questionEventId,
      sessionId: trace.sessionId,
      mode: "agent",
      language: trace.language,
      status: "running",
      startedAt: trace.startedAt,
      planningBypassed: false,
      partial: false,
      fallbackDelivered: false,
      stoppedByUser: false,
      plannedToolCalls: 0,
      executedToolCalls: 0,
      failedToolCalls: 0
    });
    return trace;
  }

  function appendTraceStep(trace: TraceContext, step: AgentTimelineStep, sequence: number): void {
    const statusValue = step.status === "done" ? "success" : step.status === "stopped" ? "stopped" : step.status === "timeout" ? "timeout" : "failed";
    enqueueTrace({
      runId: trace.runId,
      questionEventId: trace.questionEventId,
      sessionId: trace.sessionId,
      steps: [{
        stepId: randomUuid(),
        runId: trace.runId,
        questionEventId: trace.questionEventId,
        sequence,
        phase: step.phase,
        toolName: step.phase === "tool" ? step.id.slice(5) : null,
        status: statusValue,
        durationMs: step.elapsedMs,
        dataSource: step.dataSource === "database" ? "database" : step.dataSource === "mixed" ? "mixed" : step.dataSource === "cache" ? "cache" : "unknown",
        dataAsOf: step.dataAsOf || null,
        estimated: step.estimated === true,
        errorCode: step.status === "error" ? "tool_error" : step.status === "timeout" ? "llm_timeout" : step.status === "stopped" ? "stopped_by_user" : null,
        usageAvailable: false,
        retryCount: 0
      }]
    });
  }

  function completeTrace(
    trace: TraceContext,
    result: {
      readonly status: AgentSessionResult["status"];
      readonly partial: boolean;
      readonly stopped: boolean;
      readonly fallback: boolean;
      readonly planned: number;
      readonly executed: number;
      readonly failed: number;
      readonly errorCode?: string | null;
    }
  ): void {
    const statusValue = result.status === "done" ? "success" : result.status === "stopped" ? "stopped" : result.status === "error" ? "failed" : "timeout";
    enqueueTrace({
      runId: trace.runId,
      questionEventId: trace.questionEventId,
      sessionId: trace.sessionId,
      mode: "agent",
      language: trace.language,
      status: statusValue,
      completedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - Date.parse(trace.startedAt)),
      partial: result.partial,
      fallbackDelivered: result.fallback,
      stoppedByUser: result.stopped,
      plannedToolCalls: result.planned,
      executedToolCalls: result.executed,
      failedToolCalls: result.failed,
      errorCode: result.errorCode || null
    });
  }

  function beginQuestion(prompt: string, eventId: string): void {
    currentQuestion = {
      eventId,
      prompt,
      language: currentLanguage,
      answer: "",
      recordPromise: options.enableQuestionLogging === false ? Promise.resolve(null) : requestJson<JsonPayload>("/api/chat/stream?operation=questions", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          action: "create",
          eventId,
          sessionId: getSessionId(storage),
          mode: "agent",
          prompt: text(prompt, 20_000),
          language: currentLanguage,
          intent: "agent"
        })
      }).then((payload) => text(payload.recordId, 128) ? { recordId: text(payload.recordId, 128) } : null).catch(() => null)
    };
  }

  function setQuestionAnswer(answer: string): void {
    if (currentQuestion) currentQuestion = { ...currentQuestion, answer: text(answer) };
  }

  function completeQuestion(statusValue: "success" | "failed"): Promise<{ readonly recordId: string } | null> {
    const question = currentQuestion;
    if (!question) return Promise.resolve(null);
    if (question.completionPromise) return question.completionPromise;
    question.completionPromise = question.recordPromise.then(async (record) => {
      if (!record || options.enableQuestionLogging === false) return record;
      try {
        await requestJson<JsonPayload>("/api/chat/stream?operation=questions", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ action: "complete", recordId: record.recordId, sessionId: getSessionId(storage), status: statusValue, intent: "agent" })
        });
        return record;
      } catch {
        return null;
      }
    });
    return question.completionPromise;
  }

  function buildPlanningBody(question: string, language: UiLanguage, trace: TraceContext, retry?: Record<string, unknown>): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contractVersion: "v2",
      question: text(question, 4_000),
      language,
      enabledTools: [...AGENT_TOOL_NAMES],
      trace: { runId: trace.runId, questionEventId: trace.questionEventId, tracePhase: "planning" }
    };
    if (retry) body.retry = retry;
    return body;
  }

  function parsePlan(payload: JsonPayload): AgentPlan | null {
    if (payload.ok !== true) return null;
    const agentRunId = text(payload.agentRunId, 128);
    if (!agentRunId) return null;
    const rawCalls = Array.isArray(payload.toolCalls) ? payload.toolCalls : [];
    const toolCalls: AgentToolCall[] = rawCalls.flatMap((value) => {
      if (!isRecord(value)) return [];
      const name = text(value.name, 64) as ToolName;
      const args = value.arguments;
      if (!AGENT_TOOL_NAMES.includes(name) || !isRecord(args)) return [];
      const id = text(value.id, 128);
      return id ? [{ id, name, arguments: { ...args } }] : [];
    });
    return {
      agentRunId,
      ...(text(payload.planProof, 8_192) ? { planProof: text(payload.planProof, 8_192) } : {}),
      content: text(payload.content, 8_000),
      toolCalls
    };
  }

  async function plan(
    question: string,
    language: UiLanguage,
    trace: TraceContext,
    signal: AbortSignal,
    retry?: Record<string, unknown>
  ): Promise<{ readonly plan?: AgentPlan; readonly errorCode?: string }> {
    try {
      const payload = await requestJson<JsonPayload>("/api/chat/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(buildPlanningBody(question, language, trace, retry))
      }, signal);
      const parsed = parsePlan(payload);
      if (!parsed) return { errorCode: safeErrorCode(payload.errorCode || "agent_planning_unavailable") };
      if (parsed.toolCalls.length && !parsed.planProof) return { errorCode: "agent_signing_unavailable" };
      return { plan: parsed };
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return { errorCode: text((error as Error & { code?: string }).code, 64) || "agent_planning_unavailable" };
    }
  }

  async function merchantMonthlyRows(row: Row, months: number, signal: AbortSignal): Promise<{ rows: Row[]; checkedAt: string | null }> {
    const id = merchantId(row);
    if (!id) return { rows: [], checkedAt: null };
    const query = new URLSearchParams({ merchantId: id, months: String(months), minimal: "1" });
    try {
      const payload = await requestJson<JsonPayload>("/api/ui/db/merchant?" + query.toString(), {}, signal);
      const rows = Array.isArray(payload.monthlyAmazonMetrics)
        ? payload.monthlyAmazonMetrics.filter(isRecord)
        : Array.isArray(payload.monthlyMetrics)
          ? payload.monthlyMetrics.filter(isRecord)
          : [];
      return { rows, checkedAt: text(payload.checkedAt, 80) || null };
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return { rows: [], checkedAt: null };
    }
  }

  function latestMonth(rows: readonly Row[], fallback: string | null): string | null {
    const months = rows.map(rowMonth).filter((value) => /^20\d{2}-\d{2}$/.test(value)).sort();
    return months.at(-1) || fallback;
  }

  async function executeMerchantAnalysis(args: Record<string, unknown>, signal: AbortSignal): Promise<AgentToolResult> {
    const input = text(args.merchant, 80);
    if (!input) return failure("invalid_arguments", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "merchant" });
    const resolved = resolveMerchant(input, offers);
    if (!resolved.row) return resolved.result || failure("not_found");
    const row = resolved.row;
    const monthlyResult = await merchantMonthlyRows(row, 12, signal);
    const monthly = monthlyResult.rows.map((item) => monthlyData(item));
    const name = merchantName(row);
    const data: Record<string, unknown> = {
      ...merchantData(row),
      ranks: {},
      comparisons: {
        global: aggregate(offers),
        tier: aggregate(offers.filter((item) => rowTier(item) === rowTier(row)))
      },
      strengths: [],
      weaknesses: [],
      paymentRisk: null,
      peers: offers.filter((item) => rowTier(item) === rowTier(row) && merchantId(item) !== merchantId(row)).slice(0, 3).map(merchantObject),
      latestMonth: latestMonth(monthlyResult.rows, options.dataAsOf || null),
      monthly,
      monthlyDataAvailable: monthly.length > 0,
      monthlyDataSource: monthly.length ? "database" : "unavailable",
      monthlyNote: monthly.length ? "Monthly rows are loaded from the database." : "Monthly data is unavailable; cached offer metrics are retained.",
      headline: name + " merchant analysis",
      note: "Metrics are computed from the current offer cache; monthly rows are read-only database data."
    };
    return success(data, monthly.length ? "mixed" : "cache", monthlyResult.checkedAt || options.dataAsOf || null);
  }

  function resolveCategoryRows(input: string, rows: readonly Row[]): { category?: string; rows: Row[] } {
    const category = resolveChatbotCategory(input, normalizedCategories(rows));
    if (!category) return { rows: [] };
    return { category, rows: rows.filter((row) => rowMatchesCategory(row, category)) };
  }

  async function executeCategoryAnalysis(args: Record<string, unknown>): Promise<AgentToolResult> {
    const input = text(args.category, 120);
    if (!input) return failure("invalid_arguments", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "category" });
    const resolved = resolveCategoryRows(input, offers);
    if (!resolved.category || !resolved.rows.length) {
      return failure("not_found", offers.length ? "cache" : "unavailable", { status: "not_found", field: "category", value: input });
    }
    const data: Record<string, unknown> = {
      ...categorySummary(resolved.rows, resolved.category),
      tierDistribution: tierDistribution(resolved.rows),
      vsGlobal: { category: aggregate(resolved.rows), global: aggregate(offers) },
      headline: resolved.category + " category analysis",
      note: "Category metrics are calculated from cached offer rows."
    };
    return success(data, "cache", options.dataAsOf || null);
  }

  async function executeMerchantComparison(args: Record<string, unknown>): Promise<AgentToolResult> {
    const names = Array.isArray(args.merchants) ? args.merchants.map((item) => text(item, 80)).filter(Boolean).slice(0, 5) : [];
    if (names.length < 2) return failure("invalid_arguments", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "merchants" });
    const rows: Row[] = [];
    const notFound: string[] = [];
    names.forEach((name) => {
      const resolved = resolveMerchant(name, offers);
      if (resolved.row) rows.push(resolved.row);
      else notFound.push(name);
    });
    if (notFound.length || rows.length < 2) {
      return failure("not_found", offers.length ? "cache" : "unavailable", { status: "not_found", field: "merchants", candidates: notFound });
    }
    const base = metricValues(rows[0]!);
    const entities = rows.map((row) => ({ merchant: merchantObject(row), tier: rowTier(row), category: rowCategories(row)[0] || null, metrics: metricValues(row) }));
    const deltas = entities.map((entity) => ({
      merchant: entity.merchant,
      metrics: Object.fromEntries(Object.entries(entity.metrics).map(([key, value]) => [key, rounded(value - (base[key] || 0))]))
    }));
    return success({
      entities,
      notFound: [],
      deltas,
      pairwiseDeltas: deltas,
      headline: "Merchant comparison",
      note: "Comparison values are calculated from cached offer rows."
    }, "cache", options.dataAsOf || null);
  }

  function validTier(input: unknown): string | null {
    const value = canonicalChatbotTier(input);
    return ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"].includes(value) ? value : null;
  }

  async function executeTierAnalysis(args: Record<string, unknown>): Promise<AgentToolResult> {
    const tier = validTier(args.tier);
    if (!tier) return failure("invalid_filter", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "tier", allowed: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"] });
    const rows = offers.filter((row) => rowTier(row) === tier).sort((left, right) => (metricValues(right).revenue || 0) - (metricValues(left).revenue || 0));
    if (!rows.length) return failure("not_found", offers.length ? "cache" : "unavailable", { status: "not_found", field: "tier", value: tier });
    const limitValue = Number(args.limit);
    const offsetValue = Number(args.offset);
    const limit = Number.isInteger(limitValue) && limitValue > 0 ? Math.min(100, limitValue) : 100;
    const offset = Number.isInteger(offsetValue) && offsetValue > 0 ? Math.min(rows.length, offsetValue) : 0;
    const page = rows.slice(offset, offset + limit);
    const merchants = page.map((row) => ({ merchant: merchantObject(row), category: rowCategories(row)[0] || null, metrics: metricValues(row) }));
    return success({
      tier,
      merchantCount: rows.length,
      aggregates: aggregate(rows),
      vsOtherTiers: {},
      segments: { head: Math.ceil(page.length / 3), mid: 0, tail: 0 },
      outliers: [],
      merchantList: { total: rows.length, offset, limit, returned: page.length, hasMore: offset + page.length < rows.length },
      merchants,
      headline: tier + " merchant list",
      note: "Merchants follow the current Tier report order and are paginated."
    }, "cache", options.dataAsOf || null);
  }

  async function executeCategoryComparison(args: Record<string, unknown>): Promise<AgentToolResult> {
    const names = Array.isArray(args.categories) ? args.categories.map((item) => text(item, 120)).filter(Boolean).slice(0, 4) : [];
    if (names.length < 2) return failure("invalid_arguments", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "categories" });
    const entities: Record<string, unknown>[] = [];
    const missing: string[] = [];
    names.forEach((name) => {
      const resolved = resolveCategoryRows(name, offers);
      if (resolved.category && resolved.rows.length) entities.push(categorySummary(resolved.rows, resolved.category));
      else missing.push(name);
    });
    if (entities.length < 2) return failure("not_found", offers.length ? "cache" : "unavailable", { status: "not_found", field: "categories", candidates: missing });
    return success({
      tierFilter: validTier(args.tier),
      entities,
      headline: "Category comparison",
      note: "Category comparison values are calculated from cached offer rows."
    }, "cache", options.dataAsOf || null);
  }

  function normalizePaymentMonth(value: string, prompt: string): string {
    if (!value) return "";
    if (/20\d{2}/.test(prompt)) return value;
    const match = value.match(/(?:20\d{2}-)?(0?[1-9]|1[0-2])$/);
    return match?.[1] ? String(new Date().getFullYear()) + "-" + match[1].padStart(2, "0") : value;
  }

  async function executePaymentStatus(args: Record<string, unknown>, prompt: string): Promise<AgentToolResult> {
    const statusFilter = text(args.status, 24).toLowerCase();
    const tierFilter = args.tier ? validTier(args.tier) : null;
    if (args.tier && !tierFilter) return failure("invalid_filter", paymentRecords.length ? "cache" : "unavailable", { status: "invalid_filter", field: "tier" });
    const merchantFilter = args.merchant ? resolveMerchant(text(args.merchant, 80), offers) : undefined;
    if (args.merchant && !merchantFilter?.row) return merchantFilter?.result || failure("not_found");
    const monthFilter = normalizePaymentMonth(text(args.month, 20), prompt);
    let rows = paymentRecords.slice();
    if (statusFilter) rows = rows.filter((row) => paymentStatusValue(row) === statusFilter);
    if (tierFilter) rows = rows.filter((row) => rowTier(row) === tierFilter);
    if (monthFilter) rows = rows.filter((row) => paymentMonthValue(row) === monthFilter);
    if (merchantFilter?.row) rows = rows.filter((row) => paymentMerchantMatches(row, merchantFilter.row!));
    const projected = rows.slice(0, 30).map(paymentRowData);
    const countBy = (value: string): number => rows.filter((row) => paymentStatusValue(row) === value).length;
    return success({
      filter: { status: statusFilter || null, month: monthFilter || null, tier: tierFilter, merchant: args.merchant ? text(args.merchant, 80) : null },
      summary: {
        recordCount: rows.length,
        merchantCount: new Set(rows.map(merchantId).filter(Boolean)).size,
        unpaid: countBy("unpaid"),
        pending: countBy("pending"),
        paid: countBy("paid"),
        overdue: countBy("overdue"),
        totalExpected: rounded(rows.reduce((sum, row) => sum + numberFor(row, ["expectedPaymentAmount", "amount"]), 0)),
        totalRemaining: rounded(rows.reduce((sum, row) => sum + numberFor(row, ["remainingAmount"]), 0))
      },
      rows: projected,
      headline: "Payment status",
      note: "Payment rows are read from the current payment cache."
    }, paymentRecords.length ? "cache" : "unavailable", options.dataAsOf || null);
  }

  async function executeTrend(args: Record<string, unknown>, signal: AbortSignal): Promise<AgentToolResult> {
    const target = text(args.target, 80);
    if (!target) return failure("invalid_arguments", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "target" });
    const monthsValue = Number(args.months);
    const months = Number.isInteger(monthsValue) && monthsValue >= 2 && monthsValue <= 24 ? monthsValue : 12;
    const metric = metricKey(args.metric) || "revenue";
    const entityType = text(args.entityType, 20).toLowerCase() || "merchant";
    let trend: Record<string, unknown>[] = [];
    let dataSource: DataSource = "cache";
    let dataAsOf = options.dataAsOf || null;
    let estimated = true;
    let label = target;
    if (entityType === "merchant") {
      const resolved = resolveMerchant(target, offers);
      if (!resolved.row) return resolved.result || failure("not_found");
      label = merchantName(resolved.row);
      const monthlyResult = await merchantMonthlyRows(resolved.row, months, signal);
      trend = monthlyResult.rows.map((row) => monthlyData(row, metric)).filter((row) => /^20\d{2}-\d{2}$/.test(String(row.month)));
      dataAsOf = monthlyResult.checkedAt || dataAsOf;
      if (trend.length >= 2) {
        dataSource = "database";
        estimated = false;
      } else {
        trend = trendRows([resolved.row], months, metric);
      }
    } else if (entityType === "category") {
      const resolved = resolveCategoryRows(target, offers);
      if (!resolved.category || !resolved.rows.length) return failure("not_found", offers.length ? "cache" : "unavailable", { status: "not_found", field: "category", value: target });
      label = resolved.category;
      trend = trendRows(resolved.rows, months, metric);
    } else if (entityType === "tier") {
      const tier = validTier(target);
      if (!tier) return failure("invalid_filter", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "tier", value: target });
      label = tier;
      trend = trendRows(offers.filter((row) => rowTier(row) === tier), months, metric);
    } else {
      return failure("invalid_filter", offers.length ? "cache" : "unavailable", { status: "invalid_filter", field: "entityType" });
    }
    if (trend.length < 2) return failure("not_found", dataSource, { status: "not_found", field: "months", value: months });
    const summary = trendSummary(trend);
    return success({
      entityType,
      target: label,
      estimated,
      metric,
      metrics: summary,
      months: trend,
      summary,
      headline: label + " trend",
      note: estimated ? "Trend points are estimated from dated cached rows." : "Trend points are loaded from monthly database data."
    }, dataSource, dataAsOf, estimated);
  }

  async function executeTool(call: AgentToolCall, prompt: string, signal: AbortSignal): Promise<AgentToolResult> {
    try {
      if (call.name === "merchant_analysis") return executeMerchantAnalysis(call.arguments, signal);
      if (call.name === "category_analysis") return executeCategoryAnalysis(call.arguments);
      if (call.name === "merchant_comparison") return executeMerchantComparison(call.arguments);
      if (call.name === "tier_analysis") return executeTierAnalysis(call.arguments);
      if (call.name === "category_comparison") return executeCategoryComparison(call.arguments);
      if (call.name === "payment_status") return executePaymentStatus(call.arguments, prompt);
      return executeTrend(call.arguments, signal);
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return failure("tool_error", offers.length ? "cache" : "unavailable");
    }
  }

  function toolTarget(call: AgentToolCall): string {
    const args = call.arguments;
    if (call.name === "merchant_analysis" || call.name === "trend") return text(args.merchant || args.target, 120) || call.name;
    if (call.name === "category_analysis") return text(args.category, 120) || call.name;
    if (call.name === "tier_analysis") return text(args.tier, 80) || call.name;
    if (call.name === "merchant_comparison") return Array.isArray(args.merchants) ? args.merchants.map((item) => text(item, 80)).join(", ") : call.name;
    if (call.name === "category_comparison") return Array.isArray(args.categories) ? args.categories.map((item) => text(item, 120)).join(", ") : call.name;
    return [args.merchant, args.month, args.status, args.tier].map((item) => text(item, 80)).filter(Boolean).join(" / ") || call.name;
  }

  function stepLabel(phase: AgentTimelineStep["phase"], target: string): string {
    if (currentLanguage === "en") return phase === "planning" ? "Plan data lookup" : phase === "tool" ? "Read " + target : "Compose answer";
    return phase === "planning" ? "\u89c4\u5212\u6570\u636e\u67e5\u8be2" : phase === "tool" ? "\u67e5\u8be2 " + target : "\u7efc\u5408\u56de\u7b54";
  }

  function makeStep(id: string, phase: AgentTimelineStep["phase"], stepStatus: AgentTimelineStep["status"], label: string, startedAt: number, result?: AgentToolResult): AgentTimelineStep {
    return {
      id,
      phase,
      status: stepStatus,
      label,
      ...(stepStatus === "running" ? {} : { elapsedMs: Math.max(0, Date.now() - startedAt) }),
      ...(result ? {
        dataSource: result.source.dataSource === "unavailable" ? "unavailable" : result.source.dataSource,
        dataAsOf: result.source.dataAsOf,
        ...(result.source.estimated ? { estimated: true } : {})
      } : {})
    };
  }

  async function executeCalls(
    calls: readonly AgentToolCall[],
    prompt: string,
    signal: AbortSignal,
    trace: TraceContext
  ): Promise<AgentToolExecution[]> {
    const started = new Map<string, number>();
    calls.forEach((call) => {
      started.set(call.id, Date.now());
      emitStep(makeStep("tool-" + call.id, "tool", "running", stepLabel("tool", toolTarget(call)), started.get(call.id)!));
    });
    const results = await Promise.all(calls.map(async (call) => {
      const result = await executeTool(call, prompt, signal);
      const stepStatus: AgentTimelineStep["status"] = result.ok ? "done" : result.errorCode === "tool_timeout" ? "timeout" : "error";
      const step = makeStep("tool-" + call.id, "tool", stepStatus, stepLabel("tool", toolTarget(call)), started.get(call.id) || Date.now(), result);
      emitStep(step);
      appendTraceStep(trace, step, steps.findIndex((item) => item.id === step.id) + 1);
      const execution = { call, result };
      const view = resultViewFromExecution(execution);
      if (view) emitResultView(view);
      return execution;
    }));
    return results;
  }

  function projectedToolResult(item: AgentToolExecution): Record<string, unknown> {
    const result = item.result;
    const projected: Record<string, unknown> = {
      callId: item.call.id,
      toolName: item.call.name,
      arguments: { ...item.call.arguments },
      result: {
        ok: result.ok,
        source: {
          dataSource: result.source.dataSource,
          dataAsOf: result.source.dataAsOf,
          estimated: result.source.estimated
        }
      }
    };
    if (result.ok) projected.result = { ...projected.result as Record<string, unknown>, data: result.data || {} };
    else {
      projected.result = {
        ...projected.result as Record<string, unknown>,
        errorCode: result.errorCode || "tool_error",
        ...(result.resolution ? { resolution: result.resolution } : {})
      };
    }
    return projected;
  }

  function resultViewFromExecution(item: AgentToolExecution): AgentResultView | null {
    const result = item.result;
    const data = result.ok && result.data ? result.data : {};
    const scalar = (value: unknown): string => {
      if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
      if (typeof value === "string" || typeof value === "boolean") return text(value, 120);
      return "";
    };
    const metricSource = [data.metrics, data.aggregates, data.summary].find(isRecord) || {};
    const metrics = Object.entries(metricSource).flatMap(([label, value]) => {
      const metricValue = scalar(value);
      return metricValue ? [{ label: text(label, 80), value: metricValue }] : [];
    }).slice(0, 8);
    const rowSource = [data.rows, data.months, data.merchants, data.entities]
      .find((value) => Array.isArray(value)) as unknown[] | undefined;
    const firstRow = rowSource?.find(isRecord);
    const columns = firstRow
      ? Object.keys(firstRow).filter((key) => !["merchant", "name", "label", "month", "category"].includes(key)
        && scalar(firstRow[key])).slice(0, 6)
      : [];
    const rows = (rowSource || []).flatMap((value) => {
      if (!isRecord(value)) return [];
      const merchant = isRecord(value.merchant) ? text(value.merchant.name, 120) : scalar(value.merchant);
      const label = merchant || scalar(value.name) || scalar(value.label) || scalar(value.month) || scalar(value.category);
      const values = columns.map((column) => scalar(value[column]));
      return label && values.some(Boolean) ? [{ label, values }] : [];
    }).slice(0, 16);
    return normalizeAgentResultView({
      id: item.call.id,
      toolName: item.call.name,
      kind: result.ok ? (rows.length ? "table" : metrics.length ? "metric" : "summary") : "status",
      status: result.ok ? "done" : "error",
      title: text(data.headline, 180) || toolTarget(item.call),
      source: result.source.dataSource,
      dataAsOf: result.source.dataAsOf,
      estimated: result.source.estimated,
      partial: false,
      metrics,
      columns,
      rows,
      message: result.ok ? text(data.note, 800) : result.errorCode || "tool_error"
    });
  }

  async function executeFrontendTool(request: AgentToolExecutionRequest): Promise<AgentToolExecutionResponse> {
    const call: AgentToolCall = {
      id: text(request.callId, 128) || `tool-${Date.now()}`,
      name: request.toolName,
      arguments: isRecord(request.arguments) ? { ...request.arguments } : {}
    };
    const execution: AgentToolExecution = {
      call,
      result: await executeTool(call, text(request.prompt, 20_000), request.signal)
    };
    const nextMemoryEvent = memoryEvent(execution, request.prompt, false);
    const resultView = resultViewFromExecution(execution);
    return {
      toolResult: projectedToolResult(execution),
      ...(nextMemoryEvent ? { memoryEvent: nextMemoryEvent } : {}),
      ...(resultView ? { resultView } : {})
    };
  }

  function fallbackAnswer(executions: readonly AgentToolExecution[], language: UiLanguage, omitted: readonly string[]): string {
    const lines: string[] = [];
    executions.forEach((item) => {
      const data = item.result.data || {};
      if (!item.result.ok) {
        lines.push((language === "en" ? "Data unavailable for " : "\u6570\u636e\u4e0d\u53ef\u7528\uff1a") + toolTarget(item.call) + ".");
        return;
      }
      const headline = text(data.headline, 240);
      if (headline) lines.push(headline);
      if (item.call.name === "merchant_analysis" && isRecord(data.metrics)) {
        const metrics = data.metrics;
        lines.push("Merchant: " + (isRecord(data.merchant) ? text(data.merchant.name, 120) : toolTarget(item.call))
          + "; EPC " + numberValue(metrics.epc).toFixed(3)
          + "; conversion " + (numberValue(metrics.conversionRate) * 100).toFixed(2) + "%.");
        if (Array.isArray(data.monthly) && data.monthly.length) {
          lines.push("| Month | Value |\n| --- | --- |");
          data.monthly.forEach((row) => {
            if (isRecord(row)) lines.push("| " + text(row.month, 20) + " | " + text(isRecord(row.metrics) ? row.metrics.revenue : row.value, 40) + " |");
          });
        }
      } else if (item.call.name === "tier_analysis" && Array.isArray(data.merchants)) {
        lines.push("| Merchant | EPC | Conversion |\n| --- | --- | --- |");
        data.merchants.forEach((row) => {
          if (!isRecord(row)) return;
          const merchant = isRecord(row.merchant) ? text(row.merchant.name, 120) : "";
          const metrics = isRecord(row.metrics) ? row.metrics : {};
          lines.push("| " + merchant + " | " + numberValue(metrics.epc).toFixed(3) + " | " + (numberValue(metrics.conversionRate) * 100).toFixed(2) + "% |");
        });
      } else if (isRecord(data.summary)) {
        lines.push(JSON.stringify(data.summary));
      } else if (text(data.note, 500)) {
        lines.push(text(data.note, 500));
      }
    });
    if (omitted.length) {
      lines.push(language === "en"
        ? "The result is partial; unexecuted targets: " + omitted.join(", ") + "."
        : "\u672c\u6b21\u7ed3\u679c\u4e0d\u5b8c\u6574\uff0c\u672a\u6267\u884c\u76ee\u6807\uff1a" + omitted.join("\u3001") + "\u3002");
    }
    return lines.join("\n\n").trim() || missingDataResponse(language);
  }

  function memoryEvent(item: AgentToolExecution, prompt: string, runPartial: boolean): AgentMemoryEvent | null {
    if (!item.result.ok || !item.result.data) {
      const resolution = item.result.resolution;
      const candidates = isRecord(resolution) && Array.isArray(resolution.candidates) ? resolution.candidates : [];
      const safeCandidates: AgentMemoryCandidate[] = candidates.flatMap((candidate) => {
        if (!isRecord(candidate)) return [];
        const name = text(candidate.name || candidate.merchantName || candidate.merchant, 120);
        if (!name) return [];
        return [{ type: "merchant", ...(text(candidate.merchantId || candidate.id, 80) ? { id: text(candidate.merchantId || candidate.id, 80) } : {}), name }];
      });
      return safeCandidates.length ? { kind: "candidates", candidates: safeCandidates } : null;
    }
    const data = item.result.data;
    const focus = item.call.name === "merchant_analysis" && isRecord(data.merchant)
      ? {
        merchants: [{ ...(text(data.merchant.id, 80) ? { id: text(data.merchant.id, 80) } : {}), name: text(data.merchant.name, 120) }],
        ...(text(data.category, 120) ? { categories: [text(data.category, 120)] } : {}),
        ...(text(data.tier, 40) ? { tiers: [text(data.tier, 40)] } : {})
      }
      : item.call.name === "category_analysis" && text(data.category, 120)
        ? { categories: [text(data.category, 120)] }
        : item.call.name === "tier_analysis" && text(data.tier, 40)
          ? { tiers: [text(data.tier, 40)] }
          : undefined;
    const event: AgentMemoryEvent = {
      kind: "tool_success",
      query: { metrics: requestedMetrics(prompt) },
      lastTool: {
        toolName: item.call.name,
        headline: item.call.name + " completed",
        dataSource: item.result.source.dataSource === "unavailable" ? "unknown" : item.result.source.dataSource,
        dataAsOf: item.result.source.dataAsOf,
        estimated: item.result.source.estimated,
        partial: runPartial
      },
      ...(focus ? { focus } : {})
    };
    return event;
  }

  async function streamSynthesis(
    body: Record<string, unknown>,
    signal: AbortSignal,
    onToken: (token: string) => void
  ): Promise<{ response: string; errorCode?: string }> {
    let result: Response;
    try {
      result = await fetcher("/api/chat/stream", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "text/event-stream", "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal
      });
      if (result.status === 401 || result.status === 403) notifyAuthFailure(result.status);
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return { response: "", errorCode: "network_error" };
    }
    if (!result.ok) return { response: "", errorCode: "synthesis_unavailable" };
    let content = "";
    let streamError = "";
    try {
      await consumeSseResponse(result, {
        signal,
        onEvent(event) {
          if (event.event === "done" || event.data === "[DONE]") return;
          let payload: Record<string, unknown>;
          try {
            const parsed: unknown = JSON.parse(event.data);
            payload = isRecord(parsed) ? parsed : {};
          } catch {
            return;
          }
          if (typeof payload.errorCode === "string") streamError = safeErrorCode(payload.errorCode);
          if (payload.type === "usage" || event.event === "usage") return;
          if (typeof payload.token !== "string" || !payload.token) return;
          content += payload.token;
          onToken(payload.token);
        }
      });
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return { response: content, errorCode: streamError || "synthesis_unavailable" };
    }
    return streamError ? { response: content, errorCode: streamError } : { response: content };
  }

  function commitDone(
    baseHistory: readonly AgentHistoryMessage[],
    prompt: string,
    finalResponse: string,
    runPartial: boolean,
    runOmittedTargets: readonly string[],
    events: readonly AgentMemoryEvent[],
    resultErrorCode?: string
  ): AgentSessionResult {
    response = text(finalResponse, 120_000);
    partial = runPartial;
    omittedTargets = runOmittedTargets.slice(0, 20);
    errorCode = resultErrorCode || null;
    lastResultOk = Boolean(response);
    status = "done";
    if (response) {
      history = [...baseHistory, { role: "user" as const, content: prompt }, { role: "assistant" as const, content: response }].slice(-MAX_HISTORY);
      messages = history.slice();
      if (events.length) {
        memory = applyAgentMemoryEvents(memory, events, Date.now());
        saveAgentMemory(storage, memory);
      }
    } else {
      messages = baseHistory.slice();
    }
    setQuestionAnswer(response);
    notify();
    return {
      ok: Boolean(response),
      status: "done",
      response,
      steps: steps.slice(),
      partial: runPartial,
      omittedTargets: omittedTargets.slice(),
      resultViews: normalizeAgentResultViews(resultViews),
      memoryEvents: events,
      ...(resultErrorCode ? { errorCode: resultErrorCode } : {})
    };
  }

  function commitStopped(baseHistory: readonly AgentHistoryMessage[], trace: TraceContext, planned: number, executed: number, failed: number): AgentSessionResult {
    status = "stopped";
    response = "";
    partial = false;
    omittedTargets = [];
    errorCode = "stopped_by_user";
    lastResultOk = false;
    messages = baseHistory.slice();
    const result: AgentSessionResult = {
      ok: false,
      status: "stopped",
      response: "",
      steps: steps.slice(),
      partial: false,
      omittedTargets: [],
      memoryEvents: [],
      errorCode
    };
    completeTrace(trace, { status: "stopped", partial: false, stopped: true, fallback: false, planned, executed, failed, errorCode });
    notify();
    return result;
  }

  async function submit(request: AgentSessionRequest, callbacks: AgentSessionCallbacks = {}): Promise<AgentSessionResult> {
    const prompt = text(request.prompt, 4_000);
    if (!prompt) return { ok: false, status: "error", response: "", steps: [], memoryEvents: [], errorCode: "empty_prompt" };
    if (disposed) return { ok: false, status: "error", response: "", steps: [], memoryEvents: [], errorCode: "disposed" };
    if (status === "running") return { ok: false, status: "error", response: "", steps: steps.slice(), memoryEvents: [], errorCode: "busy" };
    if (options.agentEnabled === false) {
      return { ok: false, status: "error", response: "", steps: [], memoryEvents: [], errorCode: "agent_disabled" };
    }

    currentLanguage = request.language === "en" ? "en" : "zh";
    const baseHistory = history.length ? history.slice(-MAX_HISTORY) : clipHistory(request.history).slice(-MAX_HISTORY);
    history = baseHistory.slice();
    messages = [...baseHistory, { role: "user", content: prompt }, { role: "assistant", content: "" }];
    steps = [];
    resultViews = [];
    response = "";
    partial = false;
    omittedTargets = [];
    errorCode = null;
    status = "running";
    activeCallbacks = callbacks;
    activeController = new AbortController();
    const linked = linkSignal(options.signal, request.signal);
    const combined = linkSignal(linked.signal, activeController.signal);
    const questionEventId = randomUuid();
    const trace = beginTrace(questionEventId);
    beginQuestion(prompt, questionEventId);
    const started = Date.now();
    let plannedCount = 0;
    let executedCount = 0;
    let failedCount = 0;
    let fallbackDelivered = false;
    let traceSequence = 0;
    try {
      const planningId = "planning";
      emitStep(makeStep(planningId, "planning", "running", stepLabel("planning", ""), started));
      const firstPlan = await plan(prompt, currentLanguage, trace, combined.signal);
      if (!firstPlan.plan) {
        const planningStep = makeStep(planningId, "planning", "error", stepLabel("planning", ""), started);
        emitStep(planningStep);
        appendTraceStep(trace, planningStep, ++traceSequence);
        if (isDataQuestion(prompt)) {
          const safeResponse = missingDataResponse(currentLanguage);
          const result = commitDone(baseHistory, prompt, safeResponse, false, [], [], "no_verifiable_source");
          completeTrace(trace, { status: "done", partial: false, stopped: false, fallback: true, planned: 0, executed: 0, failed: 0, errorCode: "no_verifiable_source" });
          await completeQuestion("success");
          return result;
        }
        status = "error";
        messages = baseHistory.slice();
        errorCode = firstPlan.errorCode || "agent_planning_unavailable";
        lastResultOk = false;
        notify();
        const failedResult: AgentSessionResult = { ok: false, status: "error", response: "", steps: steps.slice(), memoryEvents: [], errorCode };
        completeTrace(trace, { status: "error", partial: false, stopped: false, fallback: false, planned: 0, executed: 0, failed: 0, errorCode });
        await completeQuestion("failed");
        return failedResult;
      }

      const activePlan = firstPlan.plan;
      plannedCount = activePlan.toolCalls.length;
      const planningStep = makeStep(planningId, "planning", "done", stepLabel("planning", ""), started);
      emitStep(planningStep);
      appendTraceStep(trace, planningStep, ++traceSequence);
      if (!activePlan.toolCalls.length) {
        const direct = activePlan.content || (isDataQuestion(prompt) && !hasVerifiableContext(prompt, request.memoryText, baseHistory)
          ? missingDataResponse(currentLanguage) : missingDataResponse(currentLanguage));
        const result = commitDone(baseHistory, prompt, direct, false, [], [], activePlan.content ? undefined : "no_verifiable_source");
        completeTrace(trace, { status: "done", partial: false, stopped: false, fallback: !activePlan.content, planned: 0, executed: 0, failed: 0, errorCode: activePlan.content ? null : "no_verifiable_source" });
        await completeQuestion("success");
        return result;
      }

      let allExecutions: AgentToolExecution[] = [];
      const omitted: string[] = activePlan.toolCalls.slice(MAX_TOOL_CALLS).map(toolTarget);
      let firstCalls = activePlan.toolCalls.slice(0, MAX_TOOL_CALLS);
      allExecutions = await executeCalls(firstCalls, prompt, combined.signal, trace);
      executedCount += allExecutions.length;
      failedCount += allExecutions.filter((item) => !item.result.ok).length;
      const proofs: string[] = activePlan.planProof ? [activePlan.planProof] : [];

      const failedCalls = allExecutions.filter((item) => !item.result.ok && ENABLED_ERROR_CODES.has(item.result.errorCode || ""));
      if (failedCalls.length && activePlan.planProof && executedCount < MAX_TOOL_CALLS && !combined.signal.aborted) {
        const retryBody = {
          agentRunId: activePlan.agentRunId,
          previousPlanProof: activePlan.planProof,
          failedCalls: failedCalls.map((item) => ({ callId: item.call.id, errorCode: item.result.errorCode || "tool_error" }))
        };
        const retryPlanResult = await plan(prompt, currentLanguage, trace, combined.signal, retryBody);
        if (retryPlanResult.plan) {
          const retryPlan = retryPlanResult.plan;
          if (retryPlan.planProof) proofs.push(retryPlan.planProof);
          plannedCount += retryPlan.toolCalls.length;
          const remaining = MAX_TOOL_CALLS - executedCount;
          const retryCalls = retryPlan.toolCalls.slice(0, remaining);
          omitted.push(...retryPlan.toolCalls.slice(remaining).map(toolTarget));
          if (retryCalls.length) {
            const retryExecutions = await executeCalls(retryCalls, prompt, combined.signal, trace);
            allExecutions = [...allExecutions, ...retryExecutions];
            executedCount += retryExecutions.length;
            failedCount += retryExecutions.filter((item) => !item.result.ok).length;
          }
        }
      }
      omittedTargets = omitted.slice(0, 20);
      partial = Boolean(omitted.length || failedCount);
      const synthesisStarted = Date.now();
      const synthesisId = "synthesis";
      emitStep(makeStep(synthesisId, "synthesis", "running", stepLabel("synthesis", ""), synthesisStarted));
      const synthesisBody: Record<string, unknown> = {
        contractVersion: "v2",
        agentRunId: activePlan.agentRunId,
        planProofs: proofs.slice(0, MAX_PLAN_PROOFS),
        question: text(prompt, 4_000),
        language: currentLanguage,
        context: { memory: text(request.memoryText, MAX_MEMORY_TEXT), history: clipHistory(baseHistory) },
        toolResults: allExecutions.map(projectedToolResult),
        trace: { runId: trace.runId, questionEventId: trace.questionEventId, tracePhase: "synthesis" }
      };
      const synthesisResult = await streamSynthesis(synthesisBody, combined.signal, (token) => {
        response += token;
        messages = messages.map((item, index) => index === messages.length - 1 ? { ...item, content: response } : item);
        callbacks.onToken?.(token);
        notify();
      });
      let finalResponse = synthesisResult.response.trim();
      if (!finalResponse) {
        finalResponse = fallbackAnswer(allExecutions, currentLanguage, omitted);
        fallbackDelivered = true;
      }
      const synthesisStep = makeStep(synthesisId, "synthesis", finalResponse ? "done" : "error", stepLabel("synthesis", ""), synthesisStarted);
      emitStep(synthesisStep);
      appendTraceStep(trace, synthesisStep, ++traceSequence);
      const events = allExecutions.flatMap((item) => {
        const event = memoryEvent(item, prompt, partial);
        return event ? [event] : [];
      });
      const result = commitDone(baseHistory, prompt, finalResponse, partial, omitted, events, synthesisResult.errorCode && fallbackDelivered ? "synthesis_unavailable" : undefined);
      completeTrace(trace, { status: "done", partial, stopped: false, fallback: fallbackDelivered, planned: plannedCount, executed: executedCount, failed: failedCount, errorCode: synthesisResult.errorCode && fallbackDelivered ? "synthesis_unavailable" : null });
      await completeQuestion("success");
      return result;
    } catch (error) {
      if (isAbortError(error, combined.signal)) {
        const stoppedSteps = steps.map((step) => step.status === "running" ? { ...step, status: "stopped" as const, elapsedMs: Math.max(0, Date.now() - started) } : step);
        steps = stoppedSteps;
        const result = commitStopped(baseHistory, trace, plannedCount, executedCount, failedCount);
        await completeQuestion("failed");
        return result;
      }
      status = "error";
      response = "";
      messages = baseHistory.slice();
      errorCode = "agent_session_error";
      lastResultOk = false;
      notify();
      const result: AgentSessionResult = { ok: false, status: "error", response: "", steps: steps.slice(), memoryEvents: [], errorCode };
      completeTrace(trace, { status: "error", partial, stopped: false, fallback: fallbackDelivered, planned: plannedCount, executed: executedCount, failed: failedCount, errorCode });
      await completeQuestion("failed");
      return result;
    } finally {
      combined.dispose();
      linked.dispose();
      activeController = null;
      activeCallbacks = null;
    }
  }

  const feedback: AgentFeedback = {
    isAvailable: () => Boolean(currentQuestion?.answer.trim() && lastResultOk),
    async submit(reasonCode: string, reasonDetail = ""): Promise<AgentFeedbackResult> {
      const question = currentQuestion;
      const allowed = ["inaccurate", "not_answered", "incomplete_data", "unclear", "other"];
      if (!question || !question.answer.trim() || !lastResultOk) return { ok: false, errorCode: "feedback_unavailable" };
      if (!allowed.includes(reasonCode)) return { ok: false, errorCode: "invalid_reason" };
      const record = await completeQuestion("success");
      if (!record || options.enableQuestionLogging === false) return { ok: false, errorCode: "question_log_unavailable" };
      const feedbackEventId = question.feedbackEventId || randomUuid();
      currentQuestion = { ...question, feedbackEventId };
      try {
        const payload = await requestJson<JsonPayload>("/api/chat/stream?operation=feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            feedbackEventId,
            questionEventId: record.recordId,
            sessionId: getSessionId(storage),
            mode: "agent",
            prompt: question.prompt,
            answer: question.answer.slice(0, 120_000),
            language: question.language,
            reasonCode,
            reasonDetail: text(reasonDetail, 4_000)
          })
        });
        return payload.ok === false ? { ok: false, errorCode: safeErrorCode(payload.errorCode) } : { ok: true };
      } catch (error) {
        if (isRecord(error) && Number(error.status) === 409) return { ok: true, alreadyExists: true };
        return { ok: false, errorCode: "feedback_error" };
      }
    }
  };

  function setLanguage(language: UiLanguage): void {
    currentLanguage = language === "en" ? "en" : "zh";
    notify();
  }

  function stop(): void {
    activeController?.abort();
  }

  function newConversation(): void {
    if (status === "running") return;
    history = [];
    messages = [];
    steps = [];
    response = "";
    partial = false;
    omittedTargets = [];
    errorCode = null;
    currentQuestion = null;
    lastResultOk = false;
    memory = emptyAgentMemory();
    saveAgentMemory(storage, memory);
    status = "idle";
    notify();
  }

  function downloadLogs(kind: "questions" | "feedback", format: "csv" | "jsonl"): boolean {
    if (typeof document === "undefined") return false;
    const safeKind = kind === "feedback" ? "feedback" : "questions";
    const safeFormat = format === "jsonl" ? "jsonl" : "csv";
    const anchor = document.createElement("a");
    anchor.href = "/api/chat/stream?operation=" + safeKind + "&format=" + safeFormat;
    anchor.download = "agent-" + safeKind + "." + safeFormat;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  }

  function onChange(listener: (next: AgentSessionState) => void): () => void {
    if (disposed) return () => undefined;
    listeners.add(listener);
    listener(state());
    return () => listeners.delete(listener);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    activeController?.abort();
    activeController = null;
    listeners.clear();
  }

  return {
    getState: state,
    setLanguage,
    submit,
    stop,
    newConversation,
    executeTool: executeFrontendTool,
    onChange,
    feedback,
    downloadLogs,
    dispose
  };
}
