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

function assert(condition, label) {
  if (!condition) throw new Error(label);
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
sandbox.window.PRODUCT_KEYWORDS = JSON.parse(
  fs.readFileSync("protected_data/db_keywords_cache.json", "utf8")
);

runScript("public/chatbot_i18n.js", sandbox);
runScript("public/tier2_recommendation_rules.js", sandbox);
runScript("public/app.js", sandbox);

const hooks = sandbox.window.OFFER_INTELLIGENCE_TEST_HOOKS;
assert(hooks, "app should expose test hooks in test mode");

assertEqual(
  hooks.normalizeMonthlyNewMerchantRecord({
    recordId: "12",
    reportMonth: "2026-08",
    merchantId: null,
    merchantName: "  Acme  ",
    businessManager: " Dora ",
    program: " Amazon ",
    platform: " Levanta ",
    gmvRequirement: " $ 12,500.50 ",
    pastMonthPurchase: " 100+ bought in the past month ",
    independentWebsites: " 250,000 Monthly Views ",
    reviewSummary: " 4.8/5 from 1,250 ratings ",
    ourCommission: "35.00",
    presetCommission: "20",
    isPriority: 1,
    gmvMonthlyTarget: "12500.50",
    completionReward: " Bonus "
  }),
  {
    recordId: 12,
    reportMonth: "2026-08",
    merchantId: "",
    merchantName: "Acme",
    businessManager: "Dora",
    program: "Amazon",
    platform: "Levanta",
    gmvRequirement: "$ 12,500.50",
    pastMonthPurchase: "100+ bought in the past month",
    independentWebsites: "250,000 Monthly Views",
    reviewSummary: "4.8/5 from 1,250 ratings",
    ourCommission: 35,
    presetCommission: 20,
    isPriority: true,
    gmvMonthlyTarget: 12500.5,
    completionReward: "Bonus",
    createdBy: "",
    updatedBy: "",
    createdAt: "",
    updatedAt: ""
  },
  "record normalization should preserve manual fields and priority"
);

const records = [
  { recordId: 1, merchantId: "101", merchantName: "Alpha Home", businessManager: "Dora", platform: "Levanta" },
  { recordId: 2, merchantId: "202", merchantName: "Beta Beauty", businessManager: "Alex" }
];
assertEqual(
  hooks.resolveMonthlyNewMerchantId({ merchantName: "Merach", platform: "Levanta" }),
  "380945",
  "blank merchant IDs should resolve from an exact Tier 1 brand match"
);
assertEqual(
  hooks.resolveMonthlyNewMerchantId({ merchantName: "Manspot", platform: "Levanta" }),
  "363268",
  "platform should disambiguate exact non-Tier-1 brand matches"
);
assertEqual(
  hooks.resolveMonthlyNewMerchantId({ merchantId: "999999", merchantName: "Merach" }),
  "999999",
  "an explicitly stored merchant ID should remain authoritative"
);
assertEqual(
  hooks.filteredMonthlyNewMerchantRecords(records, "alpha").map((record) => record.recordId),
  [1],
  "search should match merchant names"
);
assertEqual(
  hooks.filteredMonthlyNewMerchantRecords(records, "levanta").map((record) => record.recordId),
  [1],
  "search should match the additional merchant fields"
);
assertEqual(
  hooks.filteredMonthlyNewMerchantRecords(records, "202").map((record) => record.recordId),
  [2],
  "search should match merchant IDs"
);
assertEqual(
  hooks.filteredMonthlyNewMerchantRecords(records, "dora").map((record) => record.recordId),
  [1],
  "search should match BD names"
);
assertEqual(
  hooks.monthlyNewMerchantTargetTotal([
    { gmvMonthlyTarget: 50000 },
    { gmvMonthlyTarget: null },
    { gmvMonthlyTarget: "12500.50" }
  ]),
  62500.5,
  "GMV target summary should total the currently visible records"
);

assertEqual(
  hooks.buildMonthlyNewMerchantPayload({
    reportMonth: "2026-08",
    merchantName: "Merchant only"
  }),
  {
    action: "upsert",
    reportMonth: "2026-08",
    merchantId: "",
    merchantName: "Merchant only",
    businessManager: "",
    program: "",
    platform: "",
    gmvRequirement: "",
    pastMonthPurchase: "",
    independentWebsites: "",
    reviewSummary: "",
    ourCommission: null,
    presetCommission: null,
    isPriority: false,
    gmvMonthlyTarget: null,
    completionReward: ""
  },
  "merchant-only entries should keep every other field optional"
);

assertEqual(
  hooks.buildMonthlyNewMerchantPayload({
    recordId: "8",
    reportMonth: "2026-08",
    merchantId: "380001",
    merchantName: "Full merchant",
    businessManager: "Dora",
    program: "Amazon",
    platform: "Levanta",
    gmvRequirement: "$50,000.25",
    pastMonthPurchase: "500+ bought in the past month",
    independentWebsites: "2,900,000 Monthly Views",
    reviewSummary: "4.9/5 from 15,000 ratings",
    ourCommission: "35%",
    presetCommission: "20",
    isPriority: true,
    gmvMonthlyTarget: "50000.25",
    completionReward: "2% bonus"
  }),
  {
    action: "upsert",
    recordId: 8,
    reportMonth: "2026-08",
    merchantId: "380001",
    merchantName: "Full merchant",
    businessManager: "Dora",
    program: "Amazon",
    platform: "Levanta",
    gmvRequirement: "$50,000.25",
    pastMonthPurchase: "500+ bought in the past month",
    independentWebsites: "2,900,000 Monthly Views",
    reviewSummary: "4.9/5 from 15,000 ratings",
    ourCommission: 35,
    presetCommission: 20,
    isPriority: true,
    gmvMonthlyTarget: 50000.25,
    completionReward: "2% bonus"
  },
  "complete entries should serialize to the manual database API contract"
);

assertEqual(
  hooks.parseMonthlyNewMerchantTable('Brand,Program,Reviews Numbers,Our Commission\n"Acme, Inc.",Amazon,"4.8/5 from 1,250 ratings",35%'),
  [
    ["Brand", "Program", "Reviews Numbers", "Our Commission"],
    ["Acme, Inc.", "Amazon", "4.8/5 from 1,250 ratings", "35%"]
  ],
  "CSV parser should preserve quoted commas"
);

const imported = hooks.monthlyNewMerchantImportRows(
  hooks.parseMonthlyNewMerchantTable(
    "Brand\tProgram\tPlatform\tGMV need to be reach\tPast Month Purchase\tIndependent Websites\tReviews Numbers\tOur Commission\tPreset Commission\n"
    + "Merach\tAmazon\tLevanta\t$ 100,000.00\t800+ bought in the past month\t2,900,000 Monthly Views\t15,000\t35%\t20%\n"
    + "Merach\tAmazon\tLevanta\tMake Money\t100+ bought in past week\t-\t4,000\t15%\t"
  ),
  "2026-08"
);
assertEqual(imported.recognizedHeaders, 9, "all screenshot headers should be recognized");
assertEqual(imported.rows[0].payload, {
  action: "upsert",
  reportMonth: "2026-08",
  merchantId: "",
  merchantName: "Merach",
  businessManager: "",
  program: "Amazon",
  platform: "Levanta",
  gmvRequirement: "$ 100,000.00",
  pastMonthPurchase: "800+ bought in the past month",
  independentWebsites: "2,900,000 Monthly Views",
  reviewSummary: "15,000",
  ourCommission: 35,
  presetCommission: 20,
  isPriority: false,
  gmvMonthlyTarget: 100000,
  completionReward: ""
}, "screenshot row should map to the database API payload");
assert(imported.rows[1].errors.some((error) => error.includes("Duplicate")),
  "duplicate brands in one import should be highlighted before saving");

const indexHtml = fs.readFileSync("public/index.html", "utf8");
assert(indexHtml.includes('id="monthlyNewMerchantsNav"'), "primary navigation should expose the new page");
assert(indexHtml.includes('id="monthlyNewMerchantsPage"'), "the monthly new merchants page should exist");
assert(indexHtml.includes('id="monthlyNewMerchantAdd"'), "the page should expose a manual add action");
assert(indexHtml.includes('id="monthlyNewMerchantImport"'), "the page should expose a table import action");
assert(indexHtml.includes('id="monthlyNewMerchantImportDialog"'), "the import preview dialog should exist");
assert(indexHtml.includes('id="monthlyNewMerchantImportFile"'), "the import should accept spreadsheet files");
assert(indexHtml.includes('id="monthlyNewMerchantImportPaste"'), "the import should accept pasted spreadsheet rows");
assert(indexHtml.includes('id="monthlyNewMerchantForm"'), "the add and edit drawer form should exist");
assert(!indexHtml.includes('id="monthlyNewMerchantsRefresh"'), "database auto-discovery refresh should be removed");

const publishersNavIndex = indexHtml.indexOf('id="publishersNav"');
const monthlyNewMerchantsNavIndex = indexHtml.indexOf('id="monthlyNewMerchantsNav"');
const targetsNavIndex = indexHtml.indexOf('id="targetNav"');
const reportsNavIndex = indexHtml.indexOf('id="sheetsNav"');
assert(
  publishersNavIndex < monthlyNewMerchantsNavIndex
    && monthlyNewMerchantsNavIndex < targetsNavIndex
    && targetsNavIndex < reportsNavIndex,
  "monthly new merchants and Targets should be top-level pages before Reports"
);
const reportsSubnavMatch = indexHtml.match(/<div class="nav-subnav" id="reportsSubnav"[\s\S]*?<\/div>/);
assert(
  reportsSubnavMatch && !reportsSubnavMatch[0].includes('id="monthlyNewMerchantsNav"'),
  "monthly new merchants should not be nested inside the Reports submenu"
);
assert(
  reportsSubnavMatch && !reportsSubnavMatch[0].includes('id="targetNav"'),
  "Targets should not be nested inside the Reports submenu"
);
assertEqual(
  [
    hooks.pageBelongsToReports("sheets"),
    hooks.pageBelongsToReports("category"),
    hooks.pageBelongsToReports("tier"),
    hooks.pageBelongsToReports("monthly-new-merchants")
  ],
  [false, true, true, false],
  "Targets and monthly new merchants should not activate the Reports parent"
);

const formMatch = indexHtml.match(/<form id="monthlyNewMerchantForm">([\s\S]*?)<\/form>/);
assert(formMatch, "monthly new merchant form markup should be readable");
const formHtml = formMatch[1];
[
  "monthlyNewMerchantId",
  "monthlyNewMerchantName",
  "monthlyNewMerchantManager",
  "monthlyNewMerchantProgram",
  "monthlyNewMerchantPlatform",
  "monthlyNewMerchantGmvRequirement",
  "monthlyNewMerchantPastMonthPurchase",
  "monthlyNewMerchantIndependentWebsites",
  "monthlyNewMerchantReviewSummary",
  "monthlyNewMerchantOurCommission",
  "monthlyNewMerchantPresetCommission",
  "monthlyNewMerchantPriority",
  "monthlyNewMerchantGmvTarget",
  "monthlyNewMerchantReward"
].forEach((id) => {
  assert(formHtml.includes(`id="${id}"`), `form should contain ${id}`);
});

const merchantNameTag = formHtml.match(/<input[^>]*id="monthlyNewMerchantName"[^>]*>/)?.[0] || "";
assert(/\brequired\b/.test(merchantNameTag), "merchant name should be required");
["monthlyNewMerchantId", "monthlyNewMerchantManager", "monthlyNewMerchantGmvTarget"].forEach((id) => {
  const tag = formHtml.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] || "";
  assert(tag && !/\brequired\b/.test(tag), `${id} should remain optional`);
});
const priorityTag = formHtml.match(/<input[^>]*id="monthlyNewMerchantPriority"[^>]*>/)?.[0] || "";
assert(/type="checkbox"/.test(priorityTag), "priority should be a checkbox in the manual form");

assert(indexHtml.includes('data-i18n="monthlyNewMerchants.priority">Priority</th>'),
  "the table should expose the priority marker");
const merchantIdHeaderIndex = indexHtml.indexOf(
  'data-i18n="monthlyNewMerchants.merchantId">Merchant ID</th>'
);
const priorityHeaderIndex = indexHtml.indexOf(
  'data-i18n="monthlyNewMerchants.priority">Priority</th>'
);
assert(
  merchantIdHeaderIndex >= 0 && merchantIdHeaderIndex < priorityHeaderIndex,
  "Merchant ID should be the first table column"
);
assert(indexHtml.includes('data-i18n="monthlyNewMerchants.gmvRequirement">GMV need to be reached</th>'),
  "the table should expose the imported GMV requirement");
assert(indexHtml.includes('data-i18n="monthlyNewMerchants.presetCommission">Preset commission</th>'),
  "the table should expose imported commission fields");
assert(indexHtml.includes('data-i18n="monthlyNewMerchants.updated">Updated</th>'),
  "the table should show the manual record update time");

const appSource = fs.readFileSync("public/app.js", "utf8");
assert(appSource.includes('class="monthly-new-merchant-id-cell"'),
  "each merchant row should render the resolved Merchant ID first");
assert(appSource.includes("monthlyNewMerchantsMonth.showPicker()"),
  "clicking the month input should open the native picker across the full control");
assert(appSource.includes('data-monthly-new-merchant-action="priority"'),
  "each manual merchant should have a persistent priority toggle");
assert(appSource.includes('data-monthly-new-merchant-action="edit"'),
  "each manual merchant should be editable");
assert(appSource.includes('data-monthly-new-merchant-action="delete"'),
  "each manual merchant should be removable");

const styles = fs.readFileSync("public/styles.css", "utf8");
assert(styles.includes(".monthly-new-merchant-id-column"),
  "the first Merchant ID column should have dedicated table styling");
assert(styles.includes(".monthly-new-merchants-table tbody tr.is-priority td"),
  "priority merchants should receive a row highlight");
assert(styles.includes(".monthly-new-merchant-drawer-backdrop"),
  "manual add and edit drawer styles should be restored");
assert(styles.includes(".monthly-new-merchant-import-backdrop"),
  "spreadsheet import should have a dedicated preview dialog");

console.log("Monthly new merchants manual frontend checks passed");
