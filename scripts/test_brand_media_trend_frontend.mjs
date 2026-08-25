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
assertEqual(
  hooks.revenueFlowSelectedIds({
    merchants: [
      { merchantId: "101", name: "Alpha" },
      { merchantId: 202, merchantName: "Beta" },
      { merchantId: "101", name: "Duplicate Alpha" }
    ]
  }),
  ["101", "202"],
  "Revenue flow should preserve a deduplicated multi-brand selection"
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
    totalOrders: 5,
    points: [
      { date: "2026-05-01", revenue: 19, orders: 2 },
      { date: "2026-05-02", revenue: 0, orders: 0 },
      { date: "2026-05-05", revenue: 22, orders: 3 }
    ],
    clickPoints: [
      { date: "2026-05-01", clicks: 120 },
      { date: "2026-05-02", clicks: 80 }
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
if (!chart.includes('class="brand-media-total-series"') ||
    !chart.includes('data-brand-media-total="true"') ||
    !chart.includes('data-brand-media-total-metric="orders"')) {
  throw new Error("the unlocked order chart should include the black all-media order line");
}
const chartModel = hooks.brandMediaChartModel(chartPayload);
if (Math.round(chartModel.xFor("2026-05-01")) !== 82 ||
    Math.round(chartModel.xFor("2026-05-05")) !== 1152) {
  throw new Error("series points should share the same date-to-x coordinate as the axis");
}
if (chartModel.primaryMetric !== "orders" ||
    chartModel.dailyOrderTotals["2026-05-01"] !== 2 ||
    chartModel.dailyRevenueTotals["2026-05-01"] !== 19) {
  throw new Error("the line model should plot orders while retaining daily revenue values");
}


const sankeyPayload = {
  merchant: { merchantId: 101, merchantName: "Alpha" },
  dateRange: { startDate: "2026-05-01", endDate: "2026-05-05" },
  sankey: {
    available: true,
    nodes: [
      { id: "brand:101", type: "brand", label: "Alpha", value: 155 },
      { id: "product:ASIN-A", type: "product", label: "Widget A full product name", productKey: "ASIN-A", value: 140 },
      { id: "product:ASIN-B", type: "product", label: "Widget B full product name", productKey: "ASIN-B", value: 15 },
      { id: "media:9", type: "media", label: "Media Nine", value: 145 },
      { id: "media:12", type: "media", label: "Media Twelve", value: 10 }
    ],
    links: [
      { source: "brand:101", target: "product:ASIN-A", value: 140 },
      { source: "brand:101", target: "product:ASIN-B", value: 15 },
      { source: "product:ASIN-A", target: "media:9", value: 130 },
      { source: "product:ASIN-A", target: "media:12", value: 10 },
      { source: "product:ASIN-B", target: "media:9", value: 15 }
    ],
    summary: { productCount: 2, mediaCount: 2, totalRevenue: 155 }
  }
};
const sankeyModel = hooks.brandMediaSankeyModel(sankeyPayload);
if (!sankeyModel || sankeyModel.productCount !== 2 || sankeyModel.mediaCount !== 2) {
  throw new Error("Sankey model should preserve the three-column product/media structure");
}
if (sankeyModel.totalRevenue !== 155 || sankeyModel.links.length !== 5) {
  throw new Error("Sankey model should preserve Revenue values and links");
}
if (!sankeyModel.hoverIndex || !sankeyModel.hoverIndex["product:ASIN-A"] ||
    !sankeyModel.hoverIndex["media:9"]) {
  throw new Error("Sankey model should precompute hover relationships for every interactive node");
}
if (!hooks.brandMediaSankeyPayload(sankeyPayload)) {
  throw new Error("Sankey payload hook should expose the rendered model");
}
assertEqual(
  hooks.brandMediaSankeyProductAsin(sankeyModel.products[0]),
  "ASIN-A",
  "product nodes should expose their ASIN as the compact label"
);
const productHover = hooks.brandMediaSankeyHoverState(sankeyModel, "product:ASIN-A");
assertEqual(
  Array.from(productHover.nodeIds).sort(),
  ["brand:101", "media:9", "media:12", "product:ASIN-A"].sort(),
  "hovering a product should focus its connected media"
);
assertEqual(
  Array.from(productHover.linkIndexes).sort(function (a, b) { return a - b; }),
  [0, 2, 3],
  "hovering a product should focus its brand and product-media links"
);
const mediaHover = hooks.brandMediaSankeyHoverState(sankeyModel, "media:9");
assertEqual(
  Array.from(mediaHover.nodeIds).sort(),
  ["brand:101", "media:9", "product:ASIN-A", "product:ASIN-B"].sort(),
  "hovering media should focus every related product"
);
assertEqual(
  Array.from(mediaHover.linkIndexes).sort(function (a, b) { return a - b; }),
  [0, 1, 2, 4],
  "hovering media should focus its related product and brand links"
);
assertEqual(
  hooks.brandMediaSankeyToggleSelection(sankeyModel, "", "product:ASIN-A"),
  "product:ASIN-A",
  "clicking a product should pin its relationship focus"
);
assertEqual(
  hooks.brandMediaSankeyToggleSelection(sankeyModel, "product:ASIN-A", "product:ASIN-A"),
  "",
  "clicking the pinned product again should return to the main view"
);
assertEqual(
  hooks.brandMediaSankeyToggleSelection(sankeyModel, "product:ASIN-A", "media:9"),
  "media:9",
  "clicking another node should move the pinned relationship focus"
);
const indexedOnlyModel = Object.assign({}, sankeyModel, { links: [] });
const indexedProductHover = hooks.brandMediaSankeyHoverState(indexedOnlyModel, "product:ASIN-A");
assertEqual(
  Array.from(indexedProductHover.nodeIds).sort(),
  ["brand:101", "media:9", "media:12", "product:ASIN-A"].sort(),
  "indexed product hover should not rescan raw links"
);
const indexedMediaHover = hooks.brandMediaSankeyHoverState(indexedOnlyModel, "media:9");
assertEqual(
  Array.from(indexedMediaHover.linkIndexes).sort(function (a, b) { return a - b; }),
  [0, 1, 2, 4],
  "indexed media hover should preserve all related links"
);
const sankeyLayout = hooks.brandMediaSankeyLayout(sankeyModel, 1160);
if (!sankeyLayout || sankeyLayout.width !== 1160 || sankeyLayout.links.length !== 5) {
  throw new Error("Sankey should expose a reusable Canvas layout with every flow link");
}
if (!Number.isFinite(sankeyLayout.surfaceWidth) || sankeyLayout.surfaceWidth <= sankeyLayout.width) {
  throw new Error("Sankey should reserve horizontal surface space for the right-most media labels");
}
if (!sankeyLayout.nodes.length || !sankeyLayout.links.every(function (link) {
  return Number.isFinite(link.top) && Number.isFinite(link.bottom) && link.bottom >= link.top;
})) {
  throw new Error("Sankey Canvas layout should expose node entries and link paint bounds");
}
const visibleSankeyEntries = hooks.brandMediaSankeyVisibleEntries(sankeyLayout, 180, 100, 20);
if (!visibleSankeyEntries || visibleSankeyEntries.startY !== 160 || visibleSankeyEntries.endY !== 300 ||
    !visibleSankeyEntries.nodes.length || !visibleSankeyEntries.links.length) {
  throw new Error("Sankey should select only entries intersecting the scroll viewport and overscan");
}
const sankeyTileLayout = hooks.brandMediaSankeyTileLayout(sankeyLayout, 160);
if (!sankeyTileLayout || sankeyTileLayout.tileHeight !== 160 || sankeyTileLayout.tiles.length !== 3 ||
    !sankeyTileLayout.tiles.every(function (tile, index) {
      return tile.index === index && tile.endY > tile.startY && Array.isArray(tile.links);
    })) {
  throw new Error("Sankey should split the full graph into independently drawable Canvas tiles");
}

const multiBrandSankeyPayload = {
  merchants: [
    { merchantId: 101, merchantName: "Alpha" },
    { merchantId: 202, merchantName: "Beta" }
  ],
  sankey: {
    available: true,
    nodes: [
      { id: "brand:101", type: "brand", label: "Alpha", merchantId: "101", value: 140 },
      { id: "brand:202", type: "brand", label: "Beta", merchantId: "202", value: 60 },
      { id: "product:101:ASIN-A", type: "product", label: "Alpha product", productKey: "ASIN-A", merchantId: "101", value: 140 },
      { id: "product:202:ASIN-A", type: "product", label: "Beta product", productKey: "ASIN-A", merchantId: "202", value: 60 },
      { id: "media:9", type: "media", label: "Media Nine", value: 200 }
    ],
    links: [
      { source: "brand:101", target: "product:101:ASIN-A", value: 140 },
      { source: "brand:202", target: "product:202:ASIN-A", value: 60 },
      { source: "product:101:ASIN-A", target: "media:9", value: 140 },
      { source: "product:202:ASIN-A", target: "media:9", value: 60 }
    ],
    summary: { brandCount: 2, productCount: 2, mediaCount: 1, totalRevenue: 200 }
  }
};
const multiBrandModel = hooks.brandMediaSankeyModel(multiBrandSankeyPayload);
if (!multiBrandModel || multiBrandModel.brandCount !== 2 || multiBrandModel.brands.length !== 2) {
  throw new Error("Sankey model should preserve multiple selected brands");
}
assertEqual(
  Array.from(hooks.brandMediaSankeyHoverState(multiBrandModel, "media:9").nodeIds).sort(),
  ["brand:101", "brand:202", "media:9", "product:101:ASIN-A", "product:202:ASIN-A"].sort(),
  "media hover should include products and brands from every selected merchant"
);
const responsiveLayout = hooks.brandMediaSankeyLayout(multiBrandModel, 1480);
if (responsiveLayout.width !== 1480 || responsiveLayout.columnX.product <= 500 ||
    responsiveLayout.columnX.media <= 1000 || responsiveLayout.surfaceWidth < 1480) {
  throw new Error("Sankey columns should expand across a wide chart instead of staying pinned left");
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
      points: [{ date: "2026-05-03", revenue: 8, orders: 1 }],
      clickPoints: [{ date: "2026-05-03", clicks: 40 }]
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

const singleClickChart = hooks.brandMediaClickChartModel(lockPayload, [lockedPublishers[0]]);
if (!singleClickChart || singleClickChart.isCumulative || !singleClickChart.hasData) {
  throw new Error("one locked media should render a regular click bar chart");
}
if ((singleClickChart.svg.match(/class="brand-media-click-bar/g) || []).length !== 2) {
  throw new Error("the single-media click chart should render one bar per observed date");
}

const cumulativeClickChart = hooks.brandMediaClickChartModel(lockPayload, lockPayload.publishers);
if (!cumulativeClickChart || !cumulativeClickChart.isCumulative || !cumulativeClickChart.hasData) {
  throw new Error("multiple locked media should render a cumulative click bar chart");
}
if (!cumulativeClickChart.svg.includes("brand-media-click-svg is-cumulative") ||
    !cumulativeClickChart.svg.includes("brand-media-click-bar is-cumulative")) {
  throw new Error("the multi-media click chart should use cumulative stacked bars");
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
const authSource = fs.readFileSync("public/auth.js", "utf8");
if (!indexHtml.includes("styles.css?v=20260825-revenue-flow-multibrand") ||
    !authSource.includes("app.js?v=20260825-revenue-flow-multibrand")) {
  throw new Error("Revenue flow should invalidate the cached app and stylesheet assets");
}
[
  'id="brandMediaPage"',
  'id="brandMediaChartPanel"',
  'id="brandMediaChartExpand"',
  'id="brandMediaMerchantSearch"',
  'id="brandMediaManagerFilter"',
  'id="brandMediaStartDate"',
  'id="brandMediaEndDate"',
  'id="brandMediaChart"',
  'id="brandMediaTotalKey"',
  'id="brandMediaClicksPanel"',
  'id="brandMediaClickChart"',
  'id="brandMediaTableRows"'
].forEach(function (required) {
  if (!indexHtml.includes(required)) throw new Error("brand media page is missing " + required);
});
[
  'id="revenueFlowPage"',
  'id="revenueFlowMerchantSearch"',
  'id="revenueFlowMerchantDropdown"',
  'id="revenueFlowSelectedBrands"',
  'id="revenueFlowRangeButtons"',
  'id="revenueFlowStartDate"',
  'id="revenueFlowEndDate"',
  'id="revenueFlowChartExpand"',
  'id="revenueFlowChart"',
  'id="revenueFlowCount"',
  'id="revenueFlowKpis"'
].forEach(function (required) {
  if (!indexHtml.includes(required)) throw new Error("revenue flow page is missing " + required);
});
if (indexHtml.includes('id="brandMediaSankeyPanel"')) {
  throw new Error("Sankey should be removed from the Brand media page");
}
if (!indexHtml.includes('data-i18n="brandMedia.manager"')) {
  throw new Error("media summary should expose the manager association");
}

const appSource = fs.readFileSync("public/app.js", "utf8");
if (!appSource.includes("/api/ui/db/brand-media-sankey?") || !appSource.includes('switchPage("revenue-flow")')) {
  throw new Error("Revenue flow should use the selected brand/date endpoint from its standalone page");
}
if (!appSource.includes("var graphWidth = Math.max(1160, Number(width || 0))") ||
    !appSource.includes("responsiveExtra") ||
    !appSource.includes("_brandMediaSankeyLayoutWidth(chart)")) {
  throw new Error("Revenue flow layout should fill wide chart viewports responsively");
}
if (!appSource.includes("merchantIds: merchantIds.join(\",\")") ||
    !appSource.includes("_revenueFlowPayloadCache") ||
    !appSource.includes("_revenueFlowOfferCatalogOptions") ||
    !appSource.includes("_publishersRequest")) {
  throw new Error("Revenue flow should batch multi-brand requests and reuse catalog/payload requests");
}
if (!indexHtml.includes('aria-multiselectable="true"') ||
    !appSource.includes("_revenueFlowToggleMerchant")) {
  throw new Error("Revenue flow should expose checkbox-style multi-brand selection with removable chips");
}
if (!appSource.includes("_revenueFlowSetChartExpanded") ||
    !appSource.includes("revenue-flow-chart-expanded")) {
  throw new Error("Revenue flow should support toggling a full-screen chart view");
}
if (!appSource.includes("_brandMediaSankeyProductAsin(node)") ||
    !appSource.includes("_brandMediaBindSankeyInteractions(chart)") ||
    !appSource.includes("brand-media-sankey-canvas") ||
    !appSource.includes("brand-media-sankey-node-layer") ||
    !appSource.includes("data-brand-media-sankey-tile") ||
    !appSource.includes("_brandMediaSankeyToggleLockedNode(chart") ||
    !appSource.includes("data-brand-media-sankey-canvas-action")) {
  throw new Error("Revenue flow should render static Canvas tiles with pinned ASIN node interactions");
}
if (appSource.includes('class="brand-media-sankey-link"') ||
    appSource.includes('class="brand-media-sankey-svg"')) {
  throw new Error("Revenue flow should not generate the old long SVG Sankey");
}
if (!appSource.includes("getContext(\"2d\")") ||
    !appSource.includes('addEventListener("scroll"') ||
    !appSource.includes("requestAnimationFrame") ||
    !appSource.includes("_brandMediaSankeyVisibleEntries")) {
  throw new Error("Sankey scrolling should schedule visible-range Canvas rendering");
}
const sankeyHoverSourceStart = appSource.indexOf("function _brandMediaSankeyClearHover");
const sankeyHoverSourceEnd = appSource.indexOf("function _brandMediaSankeyNodeFromTarget");
const sankeyHoverSource = appSource.slice(sankeyHoverSourceStart, sankeyHoverSourceEnd);
if (sankeyHoverSource.includes("querySelectorAll")) {
  throw new Error("Sankey hover should update indexed elements instead of scanning the full SVG");
}
if (!appSource.includes("_brandMediaSankeyFocus") ||
    !appSource.includes("_brandMediaSankeyRenderTiles") ||
    !appSource.includes("_brandMediaSankeyCanvasZoom") ||
    !appSource.includes("_brandMediaSankeyCanvasClamp") ||
    !appSource.includes('data-brand-media-sankey-canvas-action="toggle-pan"') ||
    !appSource.includes("_brandMediaSankeyPanMode") ||
    !appSource.includes("event.ctrlKey") ||
    !appSource.includes("event.code === \"Space\"") ||
    appSource.includes("_brandMediaSankeyRenderFrame")) {
  throw new Error("Sankey should expose static Canvas navigation and a universal two-axis pan tool");
}
const sankeyScrollSourceStart = appSource.indexOf('scrollTarget.addEventListener("scroll"');
const sankeyScrollSourceEnd = appSource.indexOf("if (typeof ResizeObserver", sankeyScrollSourceStart);
const sankeyScrollSource = appSource.slice(sankeyScrollSourceStart, sankeyScrollSourceEnd);
if (sankeyScrollSource.includes("_brandMediaSankeyScheduleFrame")) {
  throw new Error("Sankey scroll should move pre-rendered tiles without scheduling Canvas redraws");
}
const stylesSource = fs.readFileSync("public/styles.css", "utf8");
if (!stylesSource.includes(".revenue-flow-brand-chip") ||
    !stylesSource.includes(".revenue-flow-option-check")) {
  throw new Error("Revenue flow should style selected brand chips and checkbox options");
}
if (!/\.brand-media-sankey-chart-wrap\s*\{[^}]*height:\s*clamp\(/s.test(stylesSource) ||
    !/\.brand-media-sankey-chart-wrap\s*\{[^}]*overflow:\s*hidden/s.test(stylesSource) ||
    !/\.brand-media-sankey-canvas-viewport\s*\{[^}]*overflow:\s*auto/s.test(stylesSource)) {
  throw new Error("Revenue flow should use one unclipped, vertically and horizontally scrollable Sankey viewport");
}
if (!stylesSource.includes(".revenue-flow-panel.is-expanded") ||
    !stylesSource.includes("body.revenue-flow-chart-expanded")) {
  throw new Error("Revenue flow should provide full-screen panel styling");
}
if (!stylesSource.includes(".brand-media-sankey-tile") ||
    !stylesSource.includes(".brand-media-sankey-canvas") ||
    !stylesSource.includes(".brand-media-sankey-canvas-viewport") ||
    !stylesSource.includes(".brand-media-sankey-canvas-grid") ||
    !stylesSource.includes(".brand-media-sankey-canvas-stage") ||
    !stylesSource.includes(".brand-media-sankey-node-layer") ||
    !stylesSource.includes(".brand-media-sankey-canvas-viewport.is-pan-mode") ||
    !stylesSource.includes(".brand-media-sankey-canvas-toolbar button.is-active") ||
    !stylesSource.includes("position: absolute") ||
    !stylesSource.includes("touch-action: none")) {
  throw new Error("Sankey should style static Canvas tiles and a pannable lightweight node layer");
}
if (stylesSource.includes(".brand-media-sankey-link") ||
    stylesSource.includes(".brand-media-sankey-svg") ||
    stylesSource.includes(".brand-media-sankey-viewport") ||
    /\.brand-media-sankey-[^}]+\{[^}]*position:\s*sticky/s.test(stylesSource)) {
  throw new Error("Sankey CSS should not depend on a sticky viewport or the old SVG surface");
}
const vercelConfig = fs.readFileSync("vercel.json", "utf8");
if (!vercelConfig.includes("/api/ui/db/brand-media-sankey") ||
    !vercelConfig.includes('"args": "ui-brand-media-sankey"')) {
  throw new Error("Vercel must route the Revenue flow endpoint to the DB WSGI function");
}

console.log("Brand media trend frontend checks passed");
