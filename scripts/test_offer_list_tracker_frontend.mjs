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
  aov: 100,
  recommendation: "Source recommendation should not be exported",
  topAsins: ["B012345678", "B012345678", "not-an-asin"]
};
const lowAov = {
  merchantId: "202",
  merchantName: "Beta Home",
  tier: "Tier 3",
  network: "Levanta",
  mainCategory: "Home & Kitchen",
  affCommissionRate: 12,
  aov: 80
};
const recommended = {
  merchantId: "303",
  merchantName: "Gamma Fitness",
  tier: "Tier 3",
  network: "Amazon Associates",
  mainCategory: "Sports & Outdoors",
  affCommissionRate: 12,
  aov: 180
};

assertEqual(hooks.offerTrackerCommissionRate(high), 20, "affiliate commission should be preferred for tracker filtering");
assertEqual(hooks.offerTrackerAsins(high), ["B012345678"], "ASIN export should deduplicate and validate values");
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
  hooks.filterOfferTrackerRows([recommended, lowAov, high], { tier: "all", category: "all", network: "all" }, "303").map((offer) => offer.merchantId),
  ["303"],
  "search should match merchant IDs"
);

assertEqual(
  hooks.offerTrackerOfferExportColumns().map(([header]) => header),
  ["Priority", "Merchant ID", "Merchant Name", "Tier", "Commission", "AOV", "Category", "Recommendation"],
  "offer worksheet should preserve the approved business columns"
);
assertEqual(
  hooks.offerTrackerProductExportColumns().map(([header]) => header),
  ["Priority", "Merchant ID", "Merchant Name", "AOV", "Category", "Top Rank ASINs"],
  "product worksheet should preserve the reference workbook columns"
);

const workbook = hooks.createRecommendationWorkbook([high, lowAov], {
  sheets: [
    { sheetName: "List of Offers", rows: [high, lowAov], columns: hooks.offerTrackerOfferExportColumns() },
    { sheetName: "Brand Product List", rows: [high, lowAov], columns: hooks.offerTrackerProductExportColumns() }
  ]
});
const workbookText = new TextDecoder().decode(workbook);
assert(workbookText.includes("List of Offers"), "workbook should contain the List of Offers worksheet");
assert(workbookText.includes("Brand Product List"), "workbook should contain the Brand Product List worksheet");
assert(!workbookText.includes("Source recommendation should not be exported"), "workbook recommendation cells should remain blank");

const html = fs.readFileSync("public/index.html", "utf8");
const targetIndex = html.indexOf('id="targetNav"');
const trackerIndex = html.indexOf('id="offerListTrackerNav"');
const reportsIndex = html.indexOf('id="sheetsNav"');
assert(targetIndex >= 0 && trackerIndex > targetIndex && reportsIndex > trackerIndex, "Targets and Offer List Tracker should be top-level items before Reports");
assert(html.includes('id="offerListTrackerPage"'), "Offer List Tracker page should exist");
assert(html.includes('id="offerTrackerExportSelected"'), "selected-row workbook export should exist");

console.log("Offer List Tracker frontend checks passed");
