import fs from "node:fs";
import vm from "node:vm";

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value`);
}

function assertIncludes(haystack, needle, label) {
  if (String(haystack).indexOf(needle) === -1) {
    throw new Error(`${label}: expected ${JSON.stringify(haystack)} to include ${JSON.stringify(needle)}`);
  }
}

const values = Object.create(null);
const storage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
  setItem(key, value) { values[key] = String(value); },
  removeItem(key) { delete values[key]; }
};
const sandbox = {
  window: {},
  console,
  Date,
  JSON,
  Object,
  Array,
  String,
  Number,
  Math,
  RegExp
};

vm.runInNewContext(fs.readFileSync("public/agent_memory_state.js", "utf8"), sandbox, {
  filename: "public/agent_memory_state.js"
});

const memory = sandbox.window.AGENT_MEMORY_STATE;
const now = Date.parse("2026-08-26T08:00:00.000Z");
assertTruthy(memory, "memory module should be exported");
assertEqual(memory.STORAGE_KEY, "oi_agent_memory_v1", "storage key should be versioned");
assertEqual(memory.VERSION, 1, "memory schema version should be one");

let state = memory.empty(now);
assertEqual(state.version, 1, "empty state should use schema v1");
assertEqual(state.focus.merchants.length, 0, "empty state should have no merchants");

state = memory.applyEvents(state, [{
  kind: "tool_success",
  focus: {
    merchants: [{ id: "398679", name: "Tapo" }],
    categories: ["Electronics"],
    tiers: ["Tier 1"]
  },
  query: {
    startMonth: "2026-01",
    endMonth: "2026-08",
    months: 8,
    metrics: ["epc", "conversionRate"]
  },
  lastTool: {
    toolName: "trend",
    headline: "Tapo 趋势 · epc",
    dataSource: "database",
    dataAsOf: "2026-08-26T07:40:00Z",
    estimated: false,
    partial: false
  },
  resolvedEntities: [{ type: "merchant", id: "398679", name: "Tapo" }],
  prompt: "不得保存的原始问题",
  answer: "不得保存的回答正文",
  toolResult: { metrics: { epc: 1.23 }, rows: [{ merchant: "Tapo" }] }
}], now);

assertEqual(state.focus.merchants[0].id, "398679", "merchant id should be retained");
assertEqual(state.focus.merchants[0].name, "Tapo", "canonical merchant name should be retained");
assertEqual(state.query.metrics.join(","), "epc,conversionRate", "metric keys should be retained");
assertEqual(state.query.startMonth, "2026-01", "start month should be retained");
assertEqual(state.query.endMonth, "2026-08", "end month should be retained");
assertEqual(state.lastTool.dataSource, "database", "source metadata should be retained");
assertEqual(JSON.stringify(state).includes("不得保存"), false, "raw text should be discarded");
assertEqual(JSON.stringify(state).includes("1.23"), false, "metric values should be discarded");
assertEqual(JSON.stringify(state).includes("rows"), false, "detail rows should be discarded");

state = memory.applyEvents(state, [{
  kind: "tool_success",
  focus: {
    merchants: [{ id: "398679", name: "Tapo" }, { id: "777777", name: "Other" }],
    categories: ["Electronics"],
    tiers: ["Tier 1"]
  },
  query: { startMonth: "2026-07", endMonth: "2026-08", months: 2, metrics: ["orders"] },
  lastTool: {
    toolName: "merchant_comparison",
    headline: "Tapo vs Other",
    dataSource: "cache",
    dataAsOf: "2026-08-26",
    estimated: false,
    partial: false
  },
  resolvedEntities: [
    { type: "merchant", id: "398679", name: "Tapo" },
    { type: "merchant", id: "777777", name: "Other" }
  ]
}], now);
assertEqual(state.focus.merchants.length, 2, "a new run should replace the prior focus with its active merchants");
assertEqual(state.query.metrics.join(","), "orders", "a new run should replace prior metric keys");
assertEqual(state.lastTool.toolName, "merchant_comparison", "last tool should be the final tool in the run");

const merged = memory.applyEvents(memory.empty(now), [
  {
    kind: "tool_success",
    focus: { merchants: [{ id: "1", name: "Alpha" }], categories: [], tiers: [] },
    query: { startMonth: "2026-07", endMonth: "2026-07", months: 1, metrics: ["epc"] },
    lastTool: { toolName: "merchant_analysis", headline: "Alpha", dataSource: "cache", dataAsOf: "2026-08-26", estimated: false, partial: false },
    resolvedEntities: [{ type: "merchant", id: "1", name: "Alpha" }]
  },
  {
    kind: "tool_success",
    focus: { merchants: [{ id: "2", name: "Beta" }], categories: [], tiers: [] },
    query: { startMonth: "2026-08", endMonth: "2026-08", months: 1, metrics: ["orders"] },
    lastTool: { toolName: "merchant_analysis", headline: "Beta", dataSource: "cache", dataAsOf: "2026-08-26", estimated: false, partial: false },
    resolvedEntities: [{ type: "merchant", id: "2", name: "Beta" }]
  }
], now);
assertEqual(merged.focus.merchants.length, 2, "one run should merge all active merchants");
assertEqual(merged.query.metrics.join(","), "epc,orders", "one run should merge metric keys");

state = memory.applyEvents(state, [{
  kind: "candidates",
  candidates: [
    { type: "merchant", id: "1", name: "Alpha" },
    { type: "merchant", id: "2", name: "Beta" }
  ],
  error: "不应保存错误正文"
}], now);
assertEqual(state.candidates.pending.length, 2, "ambiguous candidates should be pending");
state = memory.applyEvents(state, [{
  kind: "tool_success",
  focus: { merchants: [{ id: "2", name: "Beta" }], categories: [], tiers: [] },
  query: { startMonth: null, endMonth: null, months: null, metrics: [] },
  lastTool: {
    toolName: "merchant_analysis",
    headline: "Beta overview",
    dataSource: "cache",
    dataAsOf: "2026-08-26",
    estimated: false,
    partial: false
  },
  resolvedEntities: [{ type: "merchant", id: "2", name: "Beta" }]
}], now);
assertEqual(state.candidates.pending.length, 0, "selected candidate should clear pending state");
assertEqual(state.candidates.confirmed.some((item) => item.id === "2"), true, "selected candidate should be confirmed");
assertEqual(state.candidates.rejected.some((item) => item.id === "1"), true, "unselected candidate should be rejected");

const stored = memory.save(storage, state, now);
assertEqual(stored, true, "valid memory should save");
const restored = memory.load(storage, now);
assertEqual(restored.lastTool.dataSource, "cache", "saved memory should restore");
assertIncludes(memory.toPromptText(restored, "zh"), "当前商户", "Chinese prompt should label the merchant");
assertIncludes(memory.toPromptText(restored, "zh"), "重新调用数据工具", "Chinese prompt should require fresh data tools");
assertIncludes(memory.toPromptText(restored, "en"), "Active merchants", "English prompt should label the merchant");
assertIncludes(memory.toDisplayText(restored, "zh"), "已恢复上下文", "display text should disclose restoration");

const expired = memory.empty(now - 8 * 24 * 60 * 60 * 1000);
expired.lastTool = {
  toolName: "trend",
  headline: "Old trend",
  dataSource: "cache",
  dataAsOf: "2026-08-18",
  estimated: true,
  partial: false
};
memory.save(storage, expired, now - 8 * 24 * 60 * 60 * 1000);
const afterExpiry = memory.load(storage, now);
assertEqual(afterExpiry.lastTool, null, "expired memory should not restore");
assertEqual(values.oi_agent_memory_v1, undefined, "expired memory should be removed");

values.oi_agent_memory_v1 = JSON.stringify({ version: 999, updatedAt: new Date(now).toISOString() });
const afterVersionMismatch = memory.load(storage, now);
assertEqual(afterVersionMismatch.version, 1, "version mismatch should return empty v1 state");
assertEqual(values.oi_agent_memory_v1, undefined, "version mismatch should be removed");

const throwingStorage = {
  getItem() { throw new Error("storage unavailable"); },
  setItem() { throw new Error("storage unavailable"); },
  removeItem() { throw new Error("storage unavailable"); }
};
assertEqual(memory.load(throwingStorage, now).version, 1, "storage errors should return empty state");
assertEqual(memory.save(throwingStorage, state, now), false, "storage errors should not escape save");
assertEqual(memory.clear(throwingStorage), false, "storage errors should not escape clear");

const html = fs.readFileSync("public/index.html", "utf8");
const auth = fs.readFileSync("public/auth.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
assertTruthy(html.includes("agent_memory_state.js?v=20260826-agent-memory1"), "index should load memory module");
assertTruthy(html.indexOf("agent_memory_state.js") < html.indexOf("auth.js"), "memory module must load before auth bootstrap");
assertTruthy(auth.includes("app.js?v=20260827-google-ads-chart-pan"), "auth should bust the app cache");
assertTruthy(auth.includes("AGENT_MEMORY_STATE.clear(localStorage)"), "logout should clear Agent memory");
assertTruthy(app.includes("memoryText: agentPageMemoryText(language)"), "Agent page should send structured memory");
assertTruthy(ci.includes("node scripts/test_agent_memory_state.mjs"), "CI should run Agent memory tests");

console.log("Agent structured memory state tests passed.");
