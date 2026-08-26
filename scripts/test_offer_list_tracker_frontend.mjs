import fs from "node:fs";
import vm from "node:vm";

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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
  Intl,
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
  TextEncoder,
  TextDecoder,
  Uint8Array,
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
sandbox.window.PRODUCT_KEYWORDS = JSON.parse(fs.readFileSync("protected_data/db_keywords_cache.json", "utf8"));

for (const file of ["public/chatbot_i18n.js", "public/tier2_recommendation_rules.js", "public/app.js"]) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
}

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assert(hooks, "app should expose offer tracker test hooks");

const high = {
  merchantId: "101",
  merchantName: "Alpha Beauty",
  tier: "Tier 1",
  network: "Levanta",
  mainCategory: "Beauty & Personal Care",
  affCommissionRate: 20,
  commissionRate: 12,
  salesAmount: 1200,
  aov: 100,
  aovType: "actual",
  recommendation: "Source recommendation should not be exported",
  topAsins: [
    "B012345678", "B012345678", "B087654321", "not-an-asin",
    "B011223344", "B055667788", "B099887766", "B000000001"
  ]
};
const lowAov = {
  merchantId: "202",
  merchantName: "Beta Home",
  tier: "Tier 3",
  network: "Levanta",
  mainCategory: "Home & Kitchen",
  affCommissionRate: 12,
  salesAmount: 0,
  aov: 80,
  aovType: "tentative",
  aovSampleProductCount: 5,
  aovSourceDate: "2026-07-09"
};
const recommended = {
  merchantId: "303",
  merchantName: "Gamma Fitness",
  tier: "Tier 3",
  network: "Amazon Associates",
  mainCategory: "Sports & Outdoors",
  affCommissionRate: 12,
  salesAmount: 450,
  aov: 180,
  aovType: "actual"
};
const bbMind = { merchantName: "Mammotion US" };
const bbOpen = { merchantName: "Ottocast" };
const bbUnknown = { merchantName: "Unlisted Brand" };
const tierTwoFirst = {
  merchantId: "401",
  merchantName: "Tier Two First",
  tier: "Tier 2",
  affCommissionRate: 20,
  aov: 140
};
const tierTwoSecond = {
  merchantId: "402",
  merchantName: "Tier Two Second",
  tier: "Tier 2",
  affCommissionRate: 15,
  aov: 120
};
const wayward = {
  ...lowAov,
  merchantId: "404",
  merchantName: "Delta Home",
  network: "Wayward"
};

assertEqual(hooks.offerTrackerCommissionRate(high), 20, "affiliate commission should be preferred for tracker filtering");
assertEqual(hooks.offerTrackerRevenue(high), 1200, "tracker revenue should use the offer salesAmount field");
assertEqual(hooks.offerTrackerRevenue({ salesAmount: null }), 0, "missing tracker revenue should be treated as zero");
assertEqual(hooks.offerTrackerCommissionRate({ commissionRate: 30 }), 0, "generic commission should never be presented as AFF Commission");
assertEqual(hooks.offerTrackerAovType(high), "actual", "actual AOV provenance should remain explicit");
assertEqual(hooks.offerTrackerAovType(lowAov), "estimated", "tentative AOV provenance should display as estimated");
assertEqual(hooks.offerTrackerAovTypeLabel(high, "en"), "Actual", "actual AOV should have an English source label");
assertEqual(hooks.offerTrackerAovTypeLabel(lowAov, "en"), "Estimated", "tentative AOV should have an English source label");
assert(hooks.offerTrackerAovCellHtml(high).includes("offer-tracker-aov-badge actual"), "actual AOV cells should show an actual badge");
assert(hooks.offerTrackerAovCellHtml(lowAov).includes("offer-tracker-aov-badge estimated"), "tentative AOV cells should show an estimated badge");
assertEqual(hooks.offerTrackerBbPolicyKey(bbMind), "mind", "brands that prohibit BB should be marked as minding BB");
assertEqual(hooks.offerTrackerBbPolicyKey({ merchantName: "Mammotion" }), "mind", "known regional brand aliases should share the BB policy");
assertEqual(hooks.offerTrackerBbPolicyKey({ merchantName: "Beatbot Amazon" }), "mind", "database merchant suffixes should preserve the brand BB policy");
assertEqual(hooks.offerTrackerBbPolicyKey(bbOpen), "open", "brands that allow BB should be marked as open");
assertEqual(hooks.offerTrackerBbPolicyKey({ merchantName: "Shokz Official" }), "open", "official-store suffixes should preserve the brand BB policy");
assertEqual(hooks.offerTrackerBbPolicyKey({ merchantName: "AutoPlay (Ottocast)" }), "open", "confirmed brands should match when the brand appears as a merchant suffix");
assertEqual(hooks.offerTrackerBbPolicyKey(bbUnknown), "unknown", "unlisted brands should have an unknown BB policy");
assertEqual(hooks.offerTrackerBbPolicyLabel(bbMind, "zh"), "介意 BB", "BB policy labels should support Chinese");
assertEqual(hooks.offerTrackerBbPolicyLabel(bbOpen, "en"), "Doesn't mind BB", "BB policy labels should support English");
assert(hooks.offerTrackerBbPolicyCellHtml(bbMind).includes("offer-tracker-bb-badge mind"), "BB-sensitive brands should render a red badge class");
assert(hooks.offerTrackerBbPolicyCellHtml(bbOpen).includes("offer-tracker-bb-badge open"), "BB-open brands should render a green badge class");
assert(hooks.offerTrackerBbPolicyCellHtml(bbUnknown).includes("offer-tracker-bb-badge unknown"), "unknown brands should render a gray badge class");
assertEqual(hooks.offerTrackerDateRange("2026-08-01", "2026-08-31").ok, true, "valid tracker date ranges should be accepted");
assertEqual(hooks.offerTrackerDateRange("2026-08-31", "2026-08-01").reason, "order", "reversed tracker date ranges should be rejected");
assertEqual(hooks.offerTrackerDateRange("2025-01-01", "2026-08-01").reason, "length", "tracker date ranges should have a bounded length");
assertEqual(
  hooks.filterOfferTrackerRows([bbMind, bbOpen, bbUnknown], { bbPolicy: "mind" }).map((offer) => offer.merchantName),
  ["Mammotion US"],
  "BB-sensitive filter should keep only brands that mind BB"
);
assertEqual(
  hooks.filterOfferTrackerRows([bbMind, bbOpen, bbUnknown], { bbPolicy: "open" }).map((offer) => offer.merchantName),
  ["Ottocast"],
  "BB-open filter should keep only brands that do not mind BB"
);
assertEqual(
  hooks.offerTrackerAsins(high),
  ["B012345678", "B087654321", "B011223344", "B055667788", "B099887766"],
  "ASIN display and export should deduplicate, validate, and keep the top five values"
);
assertEqual(hooks.offerTrackerScore(high), 11, "score should combine tier, commission, AOV, and ASIN signals");
assertEqual(hooks.offerTrackerPriority(high).key, "high", "strong commercial offers should be high priority");
assertEqual(hooks.offerTrackerPriority(lowAov).key, "low-aov", "accessible AOV offers should enter the low-AOV group");
assertEqual(hooks.offerTrackerPriority(recommended).key, "recommended", "remaining offers should enter the recommendation pool");
assertEqual(hooks.offerTrackerRecommendation(high), "", "recommendation values should remain blank");

const filtered = hooks.filterOfferTrackerRows(
  [recommended, lowAov, high],
  { tier: "all", category: "all", minAov: "70", maxAov: "150", minCommission: "10", maxCommission: "25", network: "Levanta" },
  "",
  hooks.defaultOfferTrackerRules()
);
assertEqual(filtered.map((offer) => offer.merchantId), ["101", "202"], "commercial filters should combine inclusively and keep priority order");
assertEqual(
  hooks.filterOfferTrackerRows(
    [recommended, lowAov, high],
    { tier: "all", category: "all", network: "all", revenueStatus: "positive", revenueSort: "revenue-desc" }
  ).map((offer) => offer.merchantId),
  ["101", "303"],
  "positive-revenue filter should exclude zero revenue and sort high to low"
);
assertEqual(
  hooks.filterOfferTrackerRows(
    [recommended, lowAov, high],
    { tier: "all", category: "all", network: "all", revenueStatus: "positive", revenueSort: "revenue-asc" }
  ).map((offer) => offer.merchantId),
  ["303", "101"],
  "revenue sorting should support low to high"
);
assertEqual(
  hooks.filterOfferTrackerRows(
    [recommended, lowAov, high],
    { tier: "all", category: "all", network: "all", revenueStatus: "none", revenueSort: "priority" }
  ).map((offer) => offer.merchantId),
  ["202"],
  "no-revenue filter should keep only zero-revenue offers"
);
assertEqual(
  hooks.filterOfferTrackerRows(
    [recommended, wayward, high],
    { tier: "all", category: "all", networks: ["Levanta", "Wayward"] },
    "",
    hooks.defaultOfferTrackerRules()
  ).map((offer) => offer.merchantId),
  ["101", "404"],
  "network filter should include offers from every selected network"
);
assertEqual(
  hooks.offerTrackerSelectedNetworks({ network: "Levanta" }),
  ["Levanta"],
  "legacy saved views with one network should remain compatible"
);
assertEqual(
  hooks.offerTrackerSelectedNetworks({ networks: ["Levanta", "Wayward", "Levanta", "all"] }),
  ["Levanta", "Wayward"],
  "network selections should be normalized and deduplicated"
);
assertEqual(
  hooks.filterOfferTrackerRows(
    [recommended, tierTwoFirst, lowAov, high],
    { tiers: ["Tier 1", "Tier 2"], categories: ["Beauty & Personal Care", "Uncategorized"] }
  ).map((offer) => offer.merchantId),
  ["101", "401"],
  "tier and category filters should OR within each multi-select and AND across filters"
);
assertEqual(hooks.offerTrackerSelectedTiers({ tier: "tier 2" }), ["Tier 2"], "legacy single-tier saved views should remain compatible");
assertEqual(hooks.offerTrackerSelectedCategories({ category: "Home & Kitchen" }), ["Home & Kitchen"], "legacy single-category saved views should remain compatible");
assertEqual(
  hooks.offerTrackerSelectedTiers({ tiers: ["Tier 1", "tier 2", "Tier 1", "all"] }),
  ["Tier 1", "Tier 2"],
  "tier selections should be canonicalized and deduplicated"
);
assertEqual(
  hooks.offerTrackerSelectedCategories({ categories: ["Home & Kitchen", "Sports & Outdoors", "Home & Kitchen", "all"] }),
  ["Home & Kitchen", "Sports & Outdoors"],
  "category selections should be normalized and deduplicated"
);
const preexistingSelection = hooks.updateOfferTrackerRowSelection([wayward], true, new Set());
const pageSelection = hooks.updateOfferTrackerRowSelection([high, lowAov], true, preexistingSelection);
assert(hooks.offerTrackerRowsAreSelected([high, lowAov], pageSelection), "current-page rows should remain selectable as a group");
assert(!hooks.offerTrackerRowsAreSelected([high, lowAov, recommended], pageSelection), "current-page selection should not imply cross-page selection");
const filteredSelection = hooks.updateOfferTrackerRowSelection([high, lowAov, recommended], true, pageSelection);
assert(hooks.offerTrackerRowsAreSelected([high, lowAov, recommended], filteredSelection), "all matching rows should be selectable across pages");
const clearedFilteredSelection = hooks.updateOfferTrackerRowSelection([high, lowAov, recommended], false, filteredSelection);
assertEqual(clearedFilteredSelection.size, 1, "clearing matching rows should preserve selections outside the current filters");
assert(hooks.offerTrackerRowsAreSelected([wayward], clearedFilteredSelection), "unmatched selected rows should remain selected");
assertEqual(
  hooks.offerTrackerSelectionSummary([high, lowAov, recommended], [high, lowAov], filteredSelection),
  { selectedCount: 3, allFilteredSelected: true, allPageSelected: true },
  "selection summary should keep filtered and current-page state aligned"
);
assertEqual(
  hooks.filterOfferTrackerRows([recommended, lowAov, high], { tier: "all", category: "all", network: "all" }, "303").map((offer) => offer.merchantId),
  ["303"],
  "search should match merchant IDs"
);
assert(
  hooks.offerTrackerFilterChipLabels({ tier: "all", category: "all", network: "all", minCommission: "10", maxCommission: "25" }).includes("AFF 10%–25%"),
  "commission filter chips should identify AFF Commission"
);
assert(
  hooks.offerTrackerFilterChipLabels({ tier: "all", category: "all", network: "all", revenueStatus: "positive", revenueSort: "revenue-desc" }).includes("已产生 Revenue"),
  "revenue filter chips should identify positive revenue"
);
assertEqual(
  hooks.offerTrackerFilterChipLabels({ tier: "all", category: "all", networks: ["Levanta", "Wayward"] }),
  ["Levanta", "Wayward"],
  "each selected network should be visible in the applied-filter chips"
);
assertEqual(
  hooks.offerTrackerFilterChipLabels({ tiers: ["Tier 1", "Tier 2"], categories: ["Beauty & Personal Care", "Home & Kitchen"], networks: [] }),
  ["Tier 1", "Tier 2", "Beauty & Personal Care", "Home & Kitchen"],
  "each selected tier and category should be visible in the applied-filter chips"
);

const exportSourceRows = [tierTwoFirst, tierTwoSecond, lowAov, recommended, high];
const tierQuantities = {
  "Tier 1": { enabled: false, quantity: 1 },
  "Tier 2": { enabled: true, quantity: 1 },
  "Tier 3": { enabled: true, quantity: 2 },
  "Tier 4": { enabled: false, quantity: 0 },
  "BLACK TIER": { enabled: false, quantity: 0 }
};
assertEqual(
  hooks.offerTrackerTierCounts(exportSourceRows),
  { "Tier 1": 1, "Tier 2": 2, "Tier 3": 2, "Tier 4": 0, "BLACK TIER": 0 },
  "export setup should count the available offers in each Tier"
);
assertEqual(
  hooks.offerTrackerExportRows(exportSourceRows, tierQuantities).map((offer) => offer.merchantId),
  ["401", "202", "303"],
  "per-Tier quantities should keep the current within-Tier order"
);
assertEqual(
  hooks.offerTrackerExportTierSpans(exportSourceRows, tierQuantities),
  {
    "Tier 1": null,
    "Tier 2": { start: 1, end: 1, quantity: 1 },
    "Tier 3": { start: 2, end: 3, quantity: 2 },
    "Tier 4": null,
    "BLACK TIER": null
  },
  "Tier output spans should use exported data row numbers"
);
assertEqual(
  hooks.validateOfferTrackerBackgroundRanges([
    { start: 1, end: 1, color: "#D6EEDD" },
    { start: 2, end: 3, color: "#CCFFFF" }
  ], 3).ok,
  true,
  "valid non-overlapping row highlights should pass"
);
assertEqual(
  hooks.validateOfferTrackerBackgroundRanges([
    { start: 1, end: 2, color: "#D6EEDD" },
    { start: 2, end: 3, color: "#CCFFFF" }
  ], 3).ok,
  false,
  "overlapping row highlights should be rejected"
);
assertEqual(
  hooks.worksheetRowBackgroundColor(1, [{ start: 1, end: 1, color: "#D6EEDD" }]),
  "#D6EEDD",
  "worksheet row backgrounds should resolve from exported data row numbers"
);

assertEqual(
  hooks.offerTrackerOfferExportColumns().map(([header]) => header),
  ["Priority", "Merchant ID", "Merchant Name", "Tier", "AFF Commission", "AOV", "Revenue", "AOV Type", "BB Preference", "Category", "Recommendation"],
  "offer worksheet should preserve the approved business columns"
);
assertEqual(
  hooks.offerTrackerProductExportColumns().map(([header]) => header),
  ["Priority", "Merchant ID", "Merchant Name", "AOV", "Revenue", "AOV Type", "BB Preference", "Category", "Top Rank ASINs"],
  "product worksheet should preserve the reference workbook columns"
);

const workbook = hooks.createRecommendationWorkbook([high, lowAov], {
  rowBackgroundRanges: [
    { start: 1, end: 1, color: "#D6EEDD" },
    { start: 2, end: 2, color: "#CCFFFF" }
  ],
  sheets: [
    { sheetName: "List of Offers", rows: [high, lowAov], columns: hooks.offerTrackerOfferExportColumns() },
    { sheetName: "Brand Product List", rows: [high, lowAov], columns: hooks.offerTrackerProductExportColumns() }
  ]
});
const workbookText = new TextDecoder().decode(workbook);
const styledWorksheetXml = hooks.worksheetXml([high, lowAov], {
  columns: hooks.offerTrackerOfferExportColumns(),
  rowBackgroundRanges: [
    { start: 1, end: 1, color: "#D6EEDD" },
    { start: 2, end: 2, color: "#CCFFFF" }
  ],
  workbookBackgroundColors: ["#D6EEDD", "#CCFFFF"]
});
assert(styledWorksheetXml.includes('r="A2" s="4"'), "worksheet XML should style the first highlighted data row");
assert(styledWorksheetXml.includes('r="A3" s="7"'), "worksheet XML should style the second highlighted data row");
assert(workbookText.includes("List of Offers"), "workbook should contain the List of Offers worksheet");
assert(workbookText.includes("Brand Product List"), "workbook should contain the Brand Product List worksheet");
assert(workbookText.includes("B099887766"), "workbook should include the fifth Top Rank ASIN");
assert(!workbookText.includes("B000000001"), "workbook should omit ASINs after the top five");
assert(!workbookText.includes("Source recommendation should not be exported"), "workbook recommendation cells should remain blank");
assert(workbookText.includes("FFD6EEDD"), "workbook styles should include the first configured row background");
assert(workbookText.includes("FFCCFFFF"), "workbook styles should include the second configured row background");
assert(workbookText.includes('r="A2" s="4"'), "the first data row should use the first configured background style");
assert(workbookText.includes('r="A3" s="7"'), "the second data row should use the second configured background style");

const html = fs.readFileSync("public/index.html", "utf8");
const trackerIndex = html.indexOf('id="offerListTrackerNav"');
const productsIndex = html.indexOf('data-nav-group="products"');
const productsSubnavMatch = html.match(/<div class="nav-subnav[^\"]*" id="productsSubnav"[\s\S]*?<\/div>/);
assert(productsIndex >= 0 && trackerIndex > productsIndex, "Offer List Tracker should appear inside Products & offers");
assert(productsSubnavMatch && productsSubnavMatch[0].includes('id="offerListTrackerNav"'), "Products & offers should expose Offer List Tracker as a child page");
assert(html.includes('id="offerListTrackerPage"'), "Offer List Tracker page should exist");
assert(html.includes('id="offerTrackerExportSelected"'), "selected-row workbook export should exist");
assert(html.includes('data-i18n="offerTracker.commissionRange">AFF Commission range</span>'), "commission filters should be labeled as AFF Commission");
assert(html.includes('id="offerTrackerRevenueStatus"'), "revenue status filter should exist");
assert(html.includes('id="offerTrackerRevenueSort"'), "revenue sort control should exist");
assert(html.includes('id="offerTrackerStartDate"'), "tracker should provide a start date control");
assert(html.includes('id="offerTrackerEndDate"'), "tracker should provide an end date control");
assert(html.includes('id="offerTrackerBbPolicy"'), "tracker should provide a BB preference filter");
assert(html.includes('id="offerTrackerTierMenu"'), "tier filter should provide a checkbox menu");
assert(html.includes('aria-controls="offerTrackerTierMenu"'), "tier filter toggle should expose its menu to assistive technology");
assert(html.includes('id="offerTrackerCategoryMenu"'), "category filter should provide a checkbox menu");
assert(html.includes('aria-controls="offerTrackerCategoryMenu"'), "category filter toggle should expose its menu to assistive technology");
assert(html.includes('id="offerTrackerNetworkMenu"'), "network filter should provide a checkbox menu");
assert(html.includes('aria-controls="offerTrackerNetworkMenu"'), "network filter toggle should expose its menu to assistive technology");
assert(html.includes('id="offerTrackerSelectAllFiltered"'), "tracker should provide an all-matching cross-page selection action");

const appSource = fs.readFileSync("public/app.js", "utf8");
assert(appSource.includes('aria-label="Select current page"'), "the table header should retain current-page selection");
assert(appSource.includes('commission: "AFF Commission"'), "tracker table headers should identify AFF Commission");
assert(appSource.includes('class="offer-tracker-aov-badge ${type}"'), "tracker AOV cells should render provenance badges");
assert(appSource.includes('bbPolicy: "BB Preference"'), "tracker table headers should include the BB preference column");
assert(appSource.includes('DB_OFFERS_UI_API'), "tracker should request the selected date range from the offers API");
assert(appSource.includes('"Mammotion", "3W", "Gosovr"'), "tracker should preserve the confirmed prohibited-BB brand list");
const selectionHandlerStart = appSource.indexOf("function handleOfferTrackerSelectionChange");
const selectionHandlerEnd = appSource.indexOf("function toggleOfferTrackerFilteredSelection", selectionHandlerStart);
const selectionHandlerSource = appSource.slice(selectionHandlerStart, selectionHandlerEnd);
assert(selectionHandlerStart >= 0 && selectionHandlerEnd > selectionHandlerStart, "tracker selection handler should remain discoverable");
assert(selectionHandlerSource.includes("syncOfferTrackerSelectionUi"), "tracker selection should update only selection UI");
assert(!selectionHandlerSource.includes("renderOfferListTrackerPage();"), "tracker selection should not rebuild the entire page");

const styles = fs.readFileSync("public/styles.css", "utf8");
assert(styles.includes(".offer-tracker-aov-badge.actual"), "actual AOV badges should have dedicated styling");
assert(styles.includes(".offer-tracker-aov-badge.estimated"), "estimated AOV badges should have dedicated styling");
assert(styles.includes(".offer-tracker-bb-badge.mind"), "BB-sensitive brands should have red badge styling");
assert(styles.includes(".offer-tracker-bb-badge.open"), "BB-open brands should have green badge styling");
assert(styles.includes(".offer-tracker-bb-badge.unknown"), "unknown BB policies should have gray badge styling");
assert(styles.includes(".offer-tracker-network-option"), "network checkbox options should have dedicated styling");
assert(styles.includes(".offer-tracker-select-filtered"), "all-matching selection action should have dedicated styling");
const trackerTableRule = styles.slice(styles.indexOf(".offer-tracker-table {"), styles.indexOf("}", styles.indexOf(".offer-tracker-table {")) + 1);
const trackerTableHeadRule = styles.slice(styles.indexOf(".offer-tracker-table th {"), styles.indexOf("}", styles.indexOf(".offer-tracker-table th {")) + 1);
assert(trackerTableRule.includes("font-size: 12px;"), "tracker table body text should remain comfortably readable");
assert(trackerTableHeadRule.includes("font-size: 10px;"), "tracker table headers should remain readable");
assert(trackerTableRule.includes("line-height: 1.45;"), "tracker table cells should use a readable line height");
assert(html.includes('id="offerTrackerExportDialog"'), "workbook export setup dialog should exist");
assert(html.includes('id="offerTrackerExportTiers"'), "per-Tier export quantity controls should exist");
assert(html.includes('id="offerTrackerBackgroundRanges"'), "row background range controls should exist");

if (process.env.OFFER_TRACKER_FIXTURE_PATH) {
  const fixtureSource = hooks.filterOfferTrackerRows(
    sandbox.window.CHATBOT_DATA.offers,
    { tier: "all", category: "all", network: "all" },
    "",
    hooks.defaultOfferTrackerRules()
  );
  const fixtureRows = hooks.offerTrackerExportRows(fixtureSource, {
    "Tier 1": { enabled: false, quantity: 0 },
    "Tier 2": { enabled: true, quantity: 20 },
    "Tier 3": { enabled: true, quantity: 15 },
    "Tier 4": { enabled: false, quantity: 0 },
    "BLACK TIER": { enabled: false, quantity: 0 }
  });
  const fixtureWorkbook = hooks.createRecommendationWorkbook(fixtureRows, {
    referenceStyle: true,
    rowBackgroundRanges: [
      { start: 1, end: 20, color: "#D6EEDD" },
      { start: 21, end: 35, color: "#CCFFFF" }
    ],
    sheets: [
      { sheetName: "List of Offers", rows: fixtureRows, columns: hooks.offerTrackerOfferExportColumns() },
      { sheetName: "Brand Product List", rows: fixtureRows, columns: hooks.offerTrackerProductExportColumns() }
    ]
  });
  fs.writeFileSync(process.env.OFFER_TRACKER_FIXTURE_PATH, fixtureWorkbook);
}

console.log("Offer List Tracker frontend checks passed");
