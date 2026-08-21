import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(label + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
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
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  document: {
    getElementById() { return elementStub; },
    querySelectorAll() { return []; },
    querySelector() { return elementStub; },
    createElement() { return { ...elementStub }; }
  }
};
sandbox.window.document = sandbox.document;

const offersCache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
sandbox.window.CHATBOT_DATA = {
  summary: offersCache.summary || {},
  offers: offersCache.offers || [],
  paymentRecords: offersCache.paymentRecords || []
};
sandbox.window.SHEET_REPORT_DATA = {
  sheets: offersCache.sheets || [],
  tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};
sandbox.window.PRODUCT_KEYWORDS = JSON.parse(
  fs.readFileSync("protected_data/db_keywords_cache.json", "utf8")
);

runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
if (!hooks) throw new Error("app should expose test hooks in test mode");

const segments = hooks.brandMediaLineSegments([
  { date: "2026-05-01", revenue: 19 },
  { date: "2026-05-02", revenue: 0 },
  { date: "2026-05-05", revenue: 22 }
]);
assertEqual(
  segments.map(function (segment) { return segment.map(function (point) { return point.date; }); }),
  [["2026-05-01", "2026-05-02"], ["2026-05-05"]],
  "missing source dates should break a series while a real zero stays connected"
);

const options = hooks.brandMediaCatalogOptions({
  merchantNameMap: { "362653": "Shokz Official", "204": "Beta" },
  publishers: [
    { merchantIds: [362653] },
    { merchantIds: [362653, 204] },
    { merchantIds: [362653] }
  ]
});
assertEqual(
  options[0],
  { merchantId: "362653", name: "Shokz Official", count: 3 },
  "brand selection should surface the exact merchant ID and associated media count"
);

if (hooks.brandMediaColor(0) === hooks.brandMediaColor(1)) {
  throw new Error("different media should receive different line colors");
}

assertEqual(
  hooks.brandMediaDateKey("2026-03-08"),
  "2026-03-08",
  "valid ISO dates should remain stable for chart coordinates"
);
assertEqual(
  hooks.brandMediaDayOrdinal("2026-03-08") - hooks.brandMediaDayOrdinal("2026-03-07"),
  1,
  "date coordinates should advance by one calendar day across DST boundaries"
);

const chartPayload = {
  dateRange: { startDate: "2026-05-01", endDate: "2026-05-05" },
  publishers: [{
    userId: 9,
    userName: "Media Nine",
    adminName: "timmy",
    totalRevenue: 41,
    points: [
      { date: "2026-05-01", revenue: 19 },
      { date: "2026-05-02", revenue: 0 },
      { date: "2026-05-05", revenue: 22 }
    ]
  }]
};
const chart = hooks.brandMediaChartPayload(chartPayload);
if ((chart.match(/class="brand-media-series"/g) || []).length !== 2) {
  throw new Error("the chart should emit two SVG paths for one publisher with a missing-date gap");
}
if (!chart.includes('data-brand-media-date="2026-05-05"')) {
  throw new Error("the x-axis should expose the exact end date used by the plot");
}
if (!chart.includes('class="brand-media-crosshair brand-media-crosshair-date"') ||
    !chart.includes('class="brand-media-crosshair brand-media-crosshair-value"') ||
    !chart.includes('data-brand-media-publisher-index="0"')) {
  throw new Error("the chart should include crosshair and publisher interaction targets");
}
const chartModel = hooks.brandMediaChartModel(chartPayload);
if (Math.round(chartModel.xFor("2026-05-01")) !== 82 ||
    Math.round(chartModel.xFor("2026-05-05")) !== 1152) {
  throw new Error("series points should share the same date-to-x coordinate as the axis");
}

const lockPayload = {
  dateRange: { startDate: "2026-05-01", endDate: "2026-05-05" },
  publishers: [
    chartPayload.publishers[0],
    {
      userId: 12,
      userName: "Media Twelve",
      adminName: "stella",
      totalRevenue: 8,
      totalOrders: 2,
      points: [{ date: "2026-05-03", revenue: 8 }]
    }
  ]
};
const lockedKey = hooks.brandMediaPublisherKey(lockPayload.publishers[0], 0);
const lockedPublishers = hooks.brandMediaVisiblePublishers(lockPayload, [lockedKey]);
assertEqual(
  lockedPublishers.map(function (publisher) { return publisher.userId; }),
  [9],
  "locking one media should hide other publishers from the chart view"
);
const lockedChart = hooks.brandMediaChartModel(lockPayload, lockedPublishers);
if (!lockedChart || !lockedChart.publisherByIndex[0] || lockedChart.publisherByIndex[1]) {
  throw new Error("locked chart model should keep the selected source index and exclude the other media");
}
if (!lockedChart.svg.includes('data-brand-media-publisher-index="0"') ||
    lockedChart.svg.includes('data-brand-media-publisher-index="1"')) {
  throw new Error("locked chart should render only the selected media line");
}

assertEqual(
  hooks.brandMediaManagerOptions(lockPayload),
  ["stella", "timmy"],
  "manager options should be derived from brand media publishers"
);
assertEqual(
  hooks.brandMediaManagerFilteredPublishers(lockPayload, "timmy").map(function (publisher) {
    return publisher.userId;
  }),
  [9],
  "manager filter should keep only publishers associated with the selected manager"
);

const indexHtml = fs.readFileSync("public/index.html", "utf8");
[
  'id="brandMediaPage"',
  'id="brandMediaMerchantSearch"',
  'id="brandMediaManagerFilter"',
  'id="brandMediaStartDate"',
  'id="brandMediaEndDate"',
  'id="brandMediaChart"',
  'id="brandMediaTableRows"'
].forEach(function (required) {
  if (!indexHtml.includes(required)) throw new Error("brand media page is missing " + required);
});
if (!indexHtml.includes('data-i18n="brandMedia.manager"')) {
  throw new Error("media summary should expose the manager association");
}

console.log("Brand media trend frontend checks passed");
