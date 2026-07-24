import fs from "node:fs";
import vm from "node:vm";

function runScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
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

runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
if (!hooks) throw new Error("app should expose test hooks in test mode");

const merchantRow = { "Merchant ID": "362653", "Merchant Name": "Shokz Official" };
assertEqual(
  hooks.tierRowBaseKey(merchantRow, "Tier 1", 0),
  hooks.tierRowBaseKey(merchantRow, "Tier 1", 999),
  "merchant row key should not change when the report ordering changes"
);
assertEqual(
  hooks.tierRowBaseKey(merchantRow, "Tier 1", 0),
  "merchant:362653:Tier 1",
  "merchant row key should use Merchant ID and source tier"
);

const migrated = hooks.rekeyManualTierMovesForTest({
  "merchant:362653:Tier 1:12": {
    sourceTier: "Tier 1",
    targetTier: "Tier 2",
    merchantId: "362653",
    merchantName: "Shokz Official",
    movedAt: "2026-07-22"
  }
});
assertEqual(migrated.changed, true, "legacy row-index move key should be migrated");
assertEqual(
  Object.keys(migrated.moves),
  ["merchant:362653:Tier 1"],
  "legacy move should resolve to the stable Merchant ID key"
);
assertEqual(
  migrated.moves["merchant:362653:Tier 1"].targetTier,
  "Tier 2",
  "migrated move should preserve its target tier"
);

const moves = {
  first: { sourceTier: "Tier 1", targetTier: "Tier 2" },
  second: { sourceTier: "Tier 4", targetTier: "Tier 2" },
  unrelated: { sourceTier: "Tier 3", targetTier: "Tier 1" }
};
assertEqual(
  Array.from(hooks.tierReportDependencyTiers("Tier 2", moves)),
  ["Tier 2", "Tier 1", "Tier 4"],
  "target tier should load every incoming move source"
);
assertEqual(
  Array.from(hooks.tierReportDependencyTiers("Tier 3", moves)),
  ["Tier 3"],
  "unrelated moves should not add report dependencies"
);

const reportRows = Array.from({ length: 1201 }, (_, index) => index + 1);
const firstPage = hooks.tierTablePagination(reportRows, 1, 500);
assertEqual(firstPage.rows.length, 500, "Tier 4 first page should render 500 rows");
assertEqual(firstPage.rows[0], 1, "Tier 4 first page should start at row 1");
assertEqual(firstPage.rows[499], 500, "Tier 4 first page should end at row 500");
assertEqual(firstPage.totalPages, 3, "Tier 4 should calculate its total page count");

const secondPage = hooks.tierTablePagination(reportRows, 2, 500);
assertEqual(secondPage.rows[0], 501, "Tier 4 next page should start at row 501");
assertEqual(secondPage.rows[499], 1000, "Tier 4 next page should end at row 1000");

const clampedLastPage = hooks.tierTablePagination(reportRows, 99, 500);
assertEqual(clampedLastPage.page, 3, "Tier 4 page should clamp after filtering");
assertEqual(clampedLastPage.rows.length, 201, "Tier 4 last page should render only remaining rows");
assertEqual(clampedLastPage.rows[0], 1001, "Tier 4 previous and next pages should not overlap");

const unorderedTierHeaders = [
  "Revenue",
  "ATC",
  "Merchant Name",
  "Visual Status Reason",
  "Conversion Rate",
  "Merchant ID",
  "AOV",
  "Commission Rate",
  "Brand",
  "Category",
  "DPV",
  "Network",
  "Clicks"
];
const expectedDefaultTierHeaders = [
  "Merchant ID",
  "Merchant Name",
  "Brand",
  "Network",
  "Commission Rate",
  "Category",
  "Clicks",
  "DPV",
  "ATC",
  "AOV",
  "Conversion Rate",
  "Revenue"
];
assertEqual(
  hooks.defaultTierHeadersForSheet("Tier 2", unorderedTierHeaders),
  expectedDefaultTierHeaders,
  "all tier pages should use the requested default field order"
);
assertEqual(
  hooks.visibleTierHeadersForSheet("Tier 4", unorderedTierHeaders),
  expectedDefaultTierHeaders,
  "tier pages without a saved selection should show only the requested default fields"
);
assertEqual(
  hooks.defaultTierHeadersForSheet("Tier 3", ["Clicks", "Agency", "Conversion", "Merchant ID"]),
  ["Merchant ID", "Agency", "Clicks", "Conversion"],
  "default tier fields should support legacy Network and Conversion header aliases"
);

for (const tierName of ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]) {
  assertEqual(
    hooks.formatTierSheetCell(tierName, { Clicks: "18.0" }, "Clicks"),
    "18",
    `${tierName} clicks should display without decimals`
  );
  assertEqual(
    hooks.formatTierSheetCell(tierName, { DPV: "14.0" }, "DPV"),
    "14",
    `${tierName} DPV should display without decimals`
  );
  assertEqual(
    hooks.formatTierSheetCell(tierName, { ATC: "0.0" }, "ATC"),
    "0",
    `${tierName} ATC should display without decimals`
  );
  assertEqual(
    hooks.formatTierSheetCell(tierName, { "Order count": "6.0" }, "Order count"),
    "6",
    `${tierName} order count should display without decimals`
  );
}

assertEqual(
  hooks.formatTierSheetCell("Tier 1", { AOV: "154.489751", COUNTRY: "US" }, "AOV"),
  "$154.49",
  "US tier AOV should show dollars with two decimal places"
);
assertEqual(
  hooks.formatTierSheetCell("Tier 2", { AOV: "99.9", COUNTRY: "UK" }, "AOV"),
  "£99.90",
  "UK tier AOV should show pounds with two decimal places"
);
assertEqual(
  hooks.formatTierSheetCell("Tier 3", { AOV: "325.2175", COUNTRY: "DE" }, "AOV"),
  "€325.22",
  "German tier AOV should show euros with two decimal places"
);
assertEqual(
  hooks.formatTierSheetCell("Tier 4", { AOV: "0.0", COUNTRY: "FR" }, "AOV"),
  "€0.00",
  "French tier AOV should retain zero with two decimal places"
);
assertEqual(
  hooks.formatTierSheetCell("Tier 4", { AOV: "20", COUNTRY: "US", Currency: "GBP" }, "AOV"),
  "£20.00",
  "explicit tier currency should take precedence over country"
);
assertEqual(
  hooks.formatTierSheetCell("Tier 4", { AOV: "", COUNTRY: "US" }, "AOV"),
  "",
  "missing tier AOV should remain blank"
);

console.log("Tier report frontend checks passed");
