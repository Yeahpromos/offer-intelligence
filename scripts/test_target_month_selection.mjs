import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy, got ${JSON.stringify(value)}`);
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  appendChild() {},
  querySelectorAll() { return []; },
  querySelector() { return null; },
  setAttribute() {},
  removeAttribute() {},
  style: {}
};

const sandbox = {
  console,
  Date,
  Math,
  Number,
  String,
  RegExp,
  Array,
  Object,
  Set,
  Map,
  JSON,
  URLSearchParams,
  window: { __OFFER_INTELLIGENCE_TEST__: true },
  localStorage: {
    getItem() { return null; },
    setItem() {},
    removeItem() {}
  },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return { ...elementStub }; }
  }
};
sandbox.window.document = sandbox.document;

// 从 db_offers_cache.json / db_keywords_cache.json 加载数据（替代旧的静态 JS 文件）
const _offersCache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
sandbox.window.CHATBOT_DATA = {
  summary: _offersCache.summary || {},
  offers: _offersCache.offers || [],
  paymentRecords: _offersCache.paymentRecords || [],
  sources: { mode: "db", month: _offersCache.month }
};
sandbox.window.SHEET_REPORT_DATA = {
  sheets: _offersCache.sheets || [],
  tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};
const _kwCache = JSON.parse(fs.readFileSync("protected_data/db_keywords_cache.json", "utf8"));
sandbox.window.PRODUCT_KEYWORDS = _kwCache;
runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assertTruthy(hooks, "app should expose test hooks in test mode");
assertTruthy(hooks.targetRecords, "targetRecords hook should be exposed");
assertTruthy(hooks.preferredTargetMonth, "preferredTargetMonth hook should be exposed");
assertTruthy(hooks.targetMonthlyTrendRows, "targetMonthlyTrendRows hook should be exposed");
assertTruthy(hooks.setTargetFilters, "setTargetFilters hook should be exposed");
assertTruthy(hooks.currentReportingMonthKey, "current reporting month hook should be exposed");
assertTruthy(hooks.reportOverviewMonthKeys, "report overview month option hook should be exposed");
assertTruthy(hooks.ensureReportingMonthRecord, "future reporting month hook should be exposed");
assertTruthy(hooks.targetDbStatusMonthKey, "database month selection hook should be exposed");

const records = hooks.targetRecords();
const months = Array.from(new Set(records.map((row) => row.Month).filter(Boolean)));
assertTruthy(months.includes("May 2026"), "May database reporting month should be selectable");
assertTruthy(months.includes("June 2026"), "June database reporting month should be selectable");
assertTruthy(months.includes("July 2026"), "July target template should remain available");
assertEqual(hooks.reportOverviewMonthKeys().join(","), "2026-05,2026-06,2026-07", "report overview should expose the current month and the two prior months");
assertEqual(hooks.preferredTargetMonth(records), "July 2026", "target matrix should default to the latest month with real summary metrics");

hooks.setTargetFilters({ month: "July 2026", tier: "all" });
const julyRows = hooks.targetMonthlyTrendRows(records);
assertEqual(julyRows.length, 3, "monthly trend should retain historical context through a manually selected July month");
assertEqual(julyRows[julyRows.length - 1].label, "July 2026", "monthly trend should end at the selected July month");
assertEqual(julyRows[julyRows.length - 1].selected, true, "monthly trend should highlight the selected July month");
assertTruthy(Number.isFinite(julyRows[julyRows.length - 1].value), "July monthly trend should render a numeric value");

const augustRecords = hooks.ensureReportingMonthRecord(records, "2026-08");
const augustRecord = augustRecords.find((row) => row.__monthKey === "2026-08");
assertTruthy(augustRecord, "the active calendar month should be available without a static sheet row");
assertEqual(augustRecord.Month, "August 2026", "future reporting month should use the visible month label");
assertEqual(augustRecord.__databaseOnly, true, "auto-created reporting months should be marked as database-only");
hooks.setTargetFilters({ month: "August 2026", tier: "all" });
assertEqual(hooks.targetDbStatusMonthKey(), "2026-08", "selecting August should request the August database window");
const augustRows = hooks.targetMonthlyTrendRows(augustRecords);
assertEqual(augustRows[augustRows.length - 1].label, "August 2026", "monthly trend should end at the auto-created August month");
