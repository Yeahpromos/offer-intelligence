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

function assertNoMatch(actual, pattern, label) {
  if (pattern.test(actual)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual).slice(0, 300)} not to match ${pattern}`);
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
    aggregation: "calendar_day",
    cumulative: false,
    delayDays: 2,
    currentDate: "2026-07-08",
    observedThrough: "2026-07-06",
    expectedCompleteThrough: "2026-07-06",
    rows: [
      { date: "2026-07-04", orders: 94, revenue: 4120, clicks: 940, state: "observed", isComplete: true },
      { date: "2026-07-05", orders: 100, revenue: 4300, clicks: 960, activeBrands: 38, state: "observed", isComplete: true },
      { date: "2026-07-06", orders: 115, revenue: 4890, clicks: 1010, activeBrands: 42, state: "observed", isComplete: true },
      { date: "2026-07-07", orders: null, revenue: null, clicks: null, state: "delay", isComplete: false },
      { date: "2026-07-08", orders: null, revenue: null, clicks: null, state: "delay", isComplete: false }
    ]
  },
  recentMonths: {
    window: { startMonth: "2026-05", endMonth: "2026-07", throughDate: "2026-07-08", months: 3 },
    aggregateOrders: [
      { month: "2026-05", orders: 69922, revenue: 11233862.95, activeBrands: 1241, aggregateRows: 31218 },
      { month: "2026-06", orders: 58328, revenue: 10877607.62, activeBrands: 1362, aggregateRows: 29442 },
      { month: "2026-07", orders: 13946, revenue: 2407355.03, activeBrands: 974, aggregateRows: 8032 }
    ],
    amazonClicks: [
      { month: "2026-05", clicks: 782161, clickRows: 87120 },
      { month: "2026-06", clicks: 1101264, clickRows: 99610 },
      { month: "2026-07", clicks: 238926, clickRows: 24140 }
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
assertEqual(rows[2].activeBrands, 42, "daily trend rows should preserve API active brand counts");
assertEqual(rows[3].state, "delay", "first post-complete day should be delay");
assertEqual(rows[4].isDelay, true, "current day should be marked as delay");

const chartHtml = hooks.dbDailyTrendChartHtml(rows, model.delayDays);
assertMatch(chartHtml, /db-trend-tooltip/, "daily bar chart should render hover tooltips");
assertMatch(chartHtml, /tabindex="0"/, "daily bars should be keyboard-focusable");
assertMatch(chartHtml, /115 orders/, "tooltip should include order count");
assertMatch(chartHtml, /orders \//, "tooltip separators should remain ASCII-safe");

assertTruthy(hooks.targetTrendHtml, "targetTrendHtml hook should be exposed");
assertTruthy(hooks.targetTrendPlotHtml, "targetTrendPlotHtml hook should be exposed");
assertTruthy(hooks.targetProgressHtml, "targetProgressHtml hook should be exposed");
assertTruthy(hooks.setTargetFilters, "target filter setter hook should be exposed");
assertTruthy(hooks.setTargetTrendView, "trend view setter hook should be exposed");
assertTruthy(hooks.setDbStatusData, "DB status data setter hook should be exposed");
assertTruthy(hooks.setDbTierSummaryData, "DB tier summary setter hook should be exposed");
assertTruthy(hooks.demoDbStatusPayload, "demo DB status payload hook should be exposed");
assertTruthy(hooks.dbMonthlyTrendRows, "monthly database trend hook should be exposed");

const monthlyRows = hooks.dbMonthlyTrendRows(sampleStatus);
assertEqual(monthlyRows.length, 3, "monthly database rows should merge aggregate and click sources");
assertEqual(monthlyRows[1].monthKey, "2026-06", "monthly database rows should normalize month keys");
assertEqual(monthlyRows[1].orders, 58328, "monthly database rows should use aggregate order totals");
assertEqual(monthlyRows[1].clicks, 1101264, "monthly database rows should use click totals");
assertEqual(monthlyRows[1].activeBrands, 1362, "monthly database rows should preserve active merchant counts");

const targetTrend = hooks.targetTrendHtml(hooks.targetRecords());
assertMatch(targetTrend, /data-target-trend-view="month"/, "trend card should include a month view option");
assertMatch(targetTrend, /data-target-trend-view="day"/, "trend card should include a day view option");
assertNoMatch(targetTrend, /db-status-card/, "target trend should not reintroduce the removed reporting coverage panel");

hooks.setDbStatusData(sampleStatus);
hooks.setTargetFilters({ month: "July 2026", tier: "all" });
hooks.setTargetTrendView("month");
const monthlyTargetTrend = hooks.targetTrendPlotHtml(hooks.targetRecords());
assertMatch(monthlyTargetTrend, /Monthly Revenue trend/, "monthly trend plot should use monthly aria labeling");
assertMatch(monthlyTargetTrend, /July 2026: .*production database/, "selected month should use the database total");
assertMatch(monthlyTargetTrend, /May 2026/, "monthly trend should retain historical context before the selected month");

hooks.setTargetTrendView("day");
const dailyTargetTrend = hooks.targetTrendPlotHtml(hooks.targetRecords());
assertMatch(dailyTargetTrend, /Day Revenue trend/, "daily trend plot should use day-view aria labeling");
assertMatch(dailyTargetTrend, /data-trend-aggregation="daily-independent"/, "daily trend should explicitly declare independent calendar-day aggregation");
assertMatch(dailyTargetTrend, /target-daily-bar/, "daily trend should use independent bars instead of an accumulating line");
assertMatch(dailyTargetTrend, /target-trend-tooltip/, "daily trend bars should render visible hover and keyboard-focus tooltips");
assertMatch(dailyTargetTrend, /Jul 6/, "daily trend tooltip should include the calendar date");
assertMatch(dailyTargetTrend, /Jul 6: \$4\.9K/, "daily trend plot should show API revenue data");
assertMatch(dailyTargetTrend, /Pending/, "daily trend plot should mark delay-window values as pending");
assertNoMatch(dailyTargetTrend, /single day|partial day/i, "daily trend tooltips should not add extra day-type labels");

const progressHtml = hooks.targetProgressHtml(hooks.targetRecords());
assertMatch(progressHtml, /Tier 1[\s\S]*GMV target/, "Tier 1 should reserve a GMV target card");
assertMatch(progressHtml, /Tier 2[\s\S]*Commission target/, "Tier 2 should reserve a commission target card");
assertMatch(progressHtml, /Tier 3[\s\S]*Merchant removal target/, "Tier 3 should reserve a merchant removal target card");
assertMatch(progressHtml, /Tier 4[\s\S]*Merchant removal target/, "Tier 4 should reserve a merchant removal target card");
assertMatch(progressHtml, /Target needed/, "unconfigured tier goals should stay visible as placeholders");

hooks.setTargetFilters({ month: "June 2026", tier: "all" });
const juneRecords = hooks.targetRecords().filter((row) => row.__monthKey === "2026-06");
const juneProgressHtml = hooks.targetProgressHtml(juneRecords);
assertMatch(juneProgressHtml, /Tier 1[\s\S]*GMV target[\s\S]*131\.1%[\s\S]*\$500K[\s\S]*\$655\.4K/, "June Tier 1 should use the written GMV target and verified tier actual");
assertMatch(juneProgressHtml, /Tier 2[\s\S]*Commission target[\s\S]*Target needed[\s\S]*\$196\.7K/, "June Tier 2 should show verified payout without inventing a commission target");
assertMatch(juneProgressHtml, /Tier 3[\s\S]*Merchant removal target[\s\S]*1,400\.0%[\s\S]*10 merchants[\s\S]*140 removed/, "June Tier 3 should use the written removal target and tier exit count");
assertMatch(juneProgressHtml, /Tier 4[\s\S]*Merchant removal target[\s\S]*706\.7%[\s\S]*30 merchants[\s\S]*212 removed/, "June Tier 4 should use the written removal target and tier exit count");

hooks.setDbTierSummaryData({
  ok: true,
  month: "2026-06",
  tiers: [
    { tier: "Tier 1", brandCount: 42, clicks: 75000, orders: 47000, revenue: 600000, payout: 100000, conversionRate: 0.6267 },
    { tier: "Tier 2", brandCount: 52, clicks: 360000, orders: 130000, revenue: 1100000, payout: 210000, conversionRate: 0.3611 },
    { tier: "Tier 3", brandCount: 370, clicks: 108000, orders: 68000, revenue: 570000, payout: 77000, conversionRate: 0.6296 },
    { tier: "Tier 4", brandCount: 5807, clicks: 8500, orders: 4300, revenue: 6400, payout: 1000, conversionRate: 0.5059 }
  ],
  total: { brandCount: 6271, clicks: 551500, orders: 249300, revenue: 2276400, payout: 388000, conversionRate: 0.452 }
});
const liveJuneRecords = hooks.targetRecords().filter((row) => row.__monthKey === "2026-06");
const liveJuneProgressHtml = hooks.targetProgressHtml(liveJuneRecords);
assertMatch(liveJuneProgressHtml, /Tier 1[\s\S]*120\.0%[\s\S]*\$600K/, "live Tier 1 database values should replace the fallback snapshot");
assertMatch(liveJuneProgressHtml, /Tier 2[\s\S]*Commission target[\s\S]*\$210K/, "live Tier 2 payout should drive the displayed commission actual");

hooks.setDbStatusData({
  ...sampleStatus,
  dailyTrend: {
    ...sampleStatus.dailyTrend,
    cumulative: true,
    rows: [
      { date: "2026-07-01", revenue: 1200, orders: 20, clicks: 200, state: "observed", isComplete: true },
      { date: "2026-07-02", revenue: 1650, orders: 28, clicks: 260, state: "observed", isComplete: true }
    ]
  }
});
const normalizedSingleDayRows = hooks.targetDailyTrendRows({ key: "revenue", label: "Revenue" });
assertEqual(normalizedSingleDayRows[0].value, 1200, "the first cumulative snapshot should remain the first day's value");
assertEqual(normalizedSingleDayRows[1].value, 450, "cumulative payloads should be converted to the second day's increment");
hooks.setDbStatusData(sampleStatus);

hooks.setTargetFilters({ month: "June 2026", tier: "all" });
const staleMonthTrend = hooks.targetTrendPlotHtml(hooks.targetRecords());
assertMatch(staleMonthTrend, /Loading June daily trend data/, "daily trend should not show stale July data when June is selected");
assertNoMatch(staleMonthTrend, /Jul 6/, "daily trend should hide stale July labels while selected month data loads");

const juneDemo = hooks.demoDbStatusPayload("2026-06");
assertEqual(juneDemo.dailyTrend.month, "2026-06", "demo DB status payload should respect the requested June month");
assertEqual(juneDemo.dailyTrend.rows[0].date, "2026-06-01", "June demo trend should start on June 1");
assertEqual(juneDemo.dailyTrend.rows[juneDemo.dailyTrend.rows.length - 1].date, "2026-06-30", "June demo trend should end on June 30");
assertEqual(juneDemo.recentMonths.window.endMonth, "2026-06", "demo monthly trend should end at the requested month");
assertEqual(juneDemo.recentMonths.aggregateOrders.length, 6, "demo monthly trend should preserve a six-month window");
