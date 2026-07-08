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
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual).slice(0, 300)} to match ${pattern}`);
  }
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

runScript("protected_data/chatbot_data.js", sandbox);
runScript("protected_data/product_keywords.js", sandbox);
runScript("protected_data/sheet_report_data.js", sandbox);
runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assertTruthy(hooks, "app should expose test hooks in test mode");
assertTruthy(hooks.dbStatusViewModel, "dbStatusViewModel hook should be exposed");
assertTruthy(hooks.dbDailyTrendRows, "dbDailyTrendRows hook should be exposed");

const sampleStatus = {
  ok: true,
  checkedAt: "2026-07-08T01:30:00+08:00",
  staticSnapshot: { generatedAt: "2026-07-08T01:10:00+08:00", merchantIds: 6279 },
  latestDates: {
    amazonOrders: { latest: "2026-07-06" },
    amazonClicks: { latest: "2026-07-05" },
    aggregateOrders: { latest: "2026-07-07" },
    products: { latest: "2026-07-07" }
  },
  coverage: {
    staticNumericMerchantIds: 6279,
    cnpscy_advert: { matched: 6279, total: 6279, coverage: 1 },
    cnpscy_amazon_product: { matched: 6273, total: 6279, coverage: 0.999044 }
  },
  dailyTrend: {
    month: "2026-07",
    delayDays: 2,
    currentDate: "2026-07-08",
    observedThrough: "2026-07-06",
    expectedCompleteThrough: "2026-07-06",
    rows: [
      { date: "2026-07-04", orders: 94, revenue: 4120, clicks: 940, state: "observed", isComplete: true },
      { date: "2026-07-05", orders: 100, revenue: 4300, clicks: 960, state: "observed", isComplete: true },
      { date: "2026-07-06", orders: 115, revenue: 4890, clicks: 1010, state: "observed", isComplete: true },
      { date: "2026-07-07", orders: null, revenue: null, clicks: null, state: "delay", isComplete: false },
      { date: "2026-07-08", orders: null, revenue: null, clicks: null, state: "delay", isComplete: false }
    ]
  }
};

const model = hooks.dbStatusViewModel(sampleStatus);
assertEqual(model.title, "July reporting coverage", "status module should use business-facing title");
assertEqual(model.health, "fresh", "status should be fresh when observed through the expected complete day");
assertEqual(model.delayDays, 2, "delay policy should be two days");
assertEqual(model.observedThrough, "2026-07-06", "observed through date");
assertEqual(model.latestDataDate, "2026-07-07", "latest aggregate data date should be preserved separately");
assertEqual(model.expectedCompleteThrough, "2026-07-06", "expected complete through date");
assertEqual(model.delayWindowText, "Jul 7-Jul 8", "delay window label");
assertEqual(model.coverageCards[0].value, "6,279 / 6,279", "offer coverage card");
assertEqual(model.latestCards[0].label, "Offer aggregate", "aggregate freshness should be the first latest-date card");

const juneModel = hooks.dbStatusViewModel({
  ...sampleStatus,
  dailyTrend: {
    ...sampleStatus.dailyTrend,
    month: "2026-06",
    currentDate: "2026-07-08",
    observedThrough: "2026-06-30",
    latestDataDate: "2026-06-30",
    expectedCompleteThrough: "2026-06-30",
    rows: []
  }
});
assertEqual(juneModel.title, "June reporting coverage", "status title should follow the selected API month");

const rows = hooks.dbDailyTrendRows(sampleStatus);
assertEqual(rows.length, 5, "daily trend rows should preserve chart rows");
assertEqual(rows[2].date, "2026-07-06", "latest complete trend date");
assertEqual(rows[2].state, "observed", "latest complete row should be observed");
assertEqual(rows[2].ordersDelta, 15, "daily order delta should compare with previous observed day");
assertEqual(rows[3].state, "delay", "first post-complete day should be delay");
assertEqual(rows[4].isDelay, true, "current day should be marked as delay");

const chartHtml = hooks.dbDailyTrendChartHtml(rows, model.delayDays);
assertMatch(chartHtml, /db-trend-tooltip/, "daily bar chart should render hover tooltips");
assertMatch(chartHtml, /tabindex="0"/, "daily bars should be keyboard-focusable");
assertMatch(chartHtml, /115 orders/, "tooltip should include order count");
assertMatch(chartHtml, /orders \//, "tooltip separators should remain ASCII-safe");
