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

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function assertTruthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value, got ${JSON.stringify(value)}`);
}

function assertMatch(actual, pattern, label) {
  if (!pattern.test(actual)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual)} to match ${pattern}`);
  }
}

function assertNotMatch(actual, pattern, label) {
  if (pattern.test(actual)) {
    throw new Error(`${label}: expected ${JSON.stringify(actual)} not to match ${pattern}`);
  }
}

function assertApprox(actual, expected, label, tolerance = 1e-9) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

const elementStub = {
  addEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
  appendChild() {}, insertBefore() {},
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

const memoryDownloadFixture = {
  rows: [
    { merchantId: "1001", brand: "Alpha", tier: "Tier 2", mainCategory: "Electronics", epc: 1.8, orders: 80 },
    { merchantId: "1001", brand: "Alpha", tier: "Tier 2", mainCategory: "Electronics", epc: 1.8, orders: 80, asin: "A-2" },
    { merchantId: "1002", brand: "Beta", tier: "Tier 2", mainCategory: "Beauty & Personal Care", epc: 1.4, orders: 60 },
    { merchantId: "1003", brand: "Gamma", tier: "Tier 3", epc: 2.4, orders: 90 }
  ],
  context: {
    tier: "Tier 2",
    sheets: [
      { sheetName: "Tier 2", rows: [
        { "Merchant ID": "1001", "Merchant Name": "Alpha", Tier: "Tier 2" },
        { "Merchant ID": "1001", "Merchant Name": "Alpha", Tier: "Tier 2", ASIN: "A-2" },
        { "Merchant ID": "1002", "Merchant Name": "Beta", Tier: "Tier 2" }
      ], columns: [["Merchant ID", row => row["Merchant ID"]], ["Merchant Name", row => row["Merchant Name"]]] },
      { sheetName: "Category Summary", rows: [{ Category: "Audio", "Merchant Count": 2 }], columns: [["Category", row => row.Category]] },
      { sheetName: "Offer List", rows: [
        { "Merchant ID": "1001", "Merchant Name": "Alpha" },
        { "Merchant ID": "1001", "Merchant Name": "Alpha", ASIN: "A-2" },
        { "Merchant ID": "1002", "Merchant Name": "Beta" }
      ], columns: [["Merchant ID", row => row["Merchant ID"]], ["Merchant Name", row => row["Merchant Name"]]] }
    ]
  }
};

const memorySnapshot = hooks.buildReportExportSnapshot(memoryDownloadFixture, {
  id: "mem-tier2",
  title: "Tier 2 Report",
  tier: "Tier 2"
});
const isolatedSnapshot = hooks.buildReportExportSnapshot(memoryDownloadFixture, {
  id: "mem-isolated",
  title: "Tier 2 Report",
  tier: "Tier 2"
});
const displayOnlySourceOffer = _offersCache.offers.find((offer) => (
  offer && offer.merchantId && offer.tier
  && (offer.sheetCategory || offer.mainCategory || offer.category)
  && Number.isFinite(Number(offer.orders))
  && Number.isFinite(Number(offer.epc))
));
assertTruthy(displayOnlySourceOffer, "fixture requires a current offer with tier, category, orders, and EPC");
const displayOnlyCategory = displayOnlySourceOffer.sheetCategory
  || displayOnlySourceOffer.mainCategory
  || displayOnlySourceOffer.category;
const displayOnlyFallbackOffer = _offersCache.offers.find((offer) => (
  offer && offer.merchantId !== displayOnlySourceOffer.merchantId && offer.tier
  && (offer.sheetCategory || offer.mainCategory || offer.category)
  && Number.isFinite(Number(offer.orders))
  && Number.isFinite(Number(offer.epc))
));
assertTruthy(displayOnlyFallbackOffer, "fixture requires a second current offer for index supplementation");
const displayOnlySnapshot = hooks.buildReportExportSnapshot({
  rows: [
    {
      "Merchant ID": displayOnlySourceOffer.merchantId,
      "Merchant Name": "Mismatched display row",
      Tier: displayOnlySourceOffer.tier === "Tier 1" ? "Tier 2" : "Tier 1",
      Category: "Mismatched Category",
      Orders: 1,
      EPC: 0.01
    },
    {
      "Merchant ID": displayOnlySourceOffer.merchantId,
      "Merchant Name": "Matching display row",
      Tier: displayOnlySourceOffer.tier,
      Category: displayOnlyCategory,
      Orders: 987,
      EPC: 7.65
    },
    {
      "Merchant ID": displayOnlyFallbackOffer.merchantId,
      "Merchant Name": "Index supplemented display row"
    }
  ],
  context: {
    tier: displayOnlySourceOffer.tier,
    sheets: [{ sheetName: displayOnlySourceOffer.tier, rows: [], columns: [] }]
  }
}, { id: "mem-display-only", title: "Display-only Report", tier: displayOnlySourceOffer.tier });
const displayOnlyRankingRows = displayOnlySnapshot.rankingOffers.filter((offer) => (
  offer.merchantId === displayOnlySourceOffer.merchantId
));
assertEqual(
  displayOnlyRankingRows.length,
  2,
  "snapshot ranking rows must retain all display rows for one merchant until group selection"
);
const normalizedDisplayOnlyOffer = displayOnlyRankingRows.find((offer) => offer.tier === displayOnlySourceOffer.tier);
assertTruthy(normalizedDisplayOnlyOffer, "matching display row should remain available after snapshot normalization");
assertEqual(normalizedDisplayOnlyOffer.orders, 987, "Orders display column should normalize for metric filters");
assertEqual(normalizedDisplayOnlyOffer.epc, 7.65, "EPC display column should normalize for ranking");
assertEqual(normalizedDisplayOnlyOffer.category, displayOnlyCategory, "Category display column should normalize for category matching");
assertEqual(normalizedDisplayOnlyOffer.mainCategory, displayOnlyCategory, "Category display column should populate the main category fallback");
const indexSupplementedOffer = displayOnlySnapshot.rankingOffers.find((offer) => (
  offer.merchantId === displayOnlyFallbackOffer.merchantId
));
assertEqual(indexSupplementedOffer.tier, displayOnlyFallbackOffer.tier, "missing Tier should be supplemented from the current offers index");
assertEqual(indexSupplementedOffer.orders, displayOnlyFallbackOffer.orders, "missing Orders should be supplemented from the current offers index");
assertEqual(indexSupplementedOffer.epc, displayOnlyFallbackOffer.epc, "missing EPC should be supplemented from the current offers index");
assertEqual(
  indexSupplementedOffer.category,
  displayOnlyFallbackOffer.sheetCategory || displayOnlyFallbackOffer.mainCategory || displayOnlyFallbackOffer.category,
  "missing category should be supplemented from the current offers index"
);
const displayOnlyRecommendation = hooks.buildMemoryRecommendationResult(
  "recommend 1 offer",
  [{ id: "mem-display-only", title: "Display-only Report", reportSnapshot: displayOnlySnapshot }],
  {
    tier: displayOnlySourceOffer.tier,
    category: displayOnlyCategory,
    metricFilters: [{ field: "orders", operator: ">=", threshold: 900 }],
    requestedCount: 1
  }
);
assertDeepEqual(
  displayOnlyRecommendation.selectedMerchantIds,
  [String(displayOnlySourceOffer.merchantId)],
  "group selection must use the matching display row instead of the first mismatched row"
);
assertEqual(displayOnlyRecommendation.selectedRows.length, 2, "selected export must retain all original rows for the chosen merchant");
memoryDownloadFixture.rows[0].brand = "Mutated after memory";
memoryDownloadFixture.context.sheets[0].rows[0]["Merchant Name"] = "Mutated sheet row";
assertEqual(isolatedSnapshot.rows[0].brand, "Alpha", "memory rows must be immutable after capture");
assertEqual(isolatedSnapshot.sheets[0].rows[0]["Merchant Name"], "Alpha", "memory sheet rows must be immutable after capture");

const filteredWorkbook = hooks.filterReportWorkbookSnapshot(memorySnapshot, ["1001"]);
assertDeepEqual(
  filteredWorkbook.sheets[0].rows.map((row) => row["Merchant ID"]),
  ["1001", "1001"],
  "primary sheet should keep all rows for selected merchant"
);
assertDeepEqual(
  filteredWorkbook.sheets[2].rows.map((row) => row["Merchant ID"]),
  ["1001", "1001"],
  "offer list should keep all related rows"
);
assertEqual(filteredWorkbook.primaryRows.length, 2, "filtered workbook should expose its primary rows");
assertEqual(filteredWorkbook.sheets[1].rows.length, 1, "category summary should be recalculated from filtered rows");
assertEqual(filteredWorkbook.sheets[1].rows[0]["Merchant Count"], 1, "category summary should recount unique filtered merchants");
assertDeepEqual(
  filteredWorkbook.sheets.map((sheet) => sheet.sheetName),
  ["Tier 2", "Category Summary", "Offer List"],
  "filtered workbook should preserve source sheet order"
);
assertEqual(
  filteredWorkbook.sheets[0].columns[0][1],
  memorySnapshot.sheets[0].columns[0][1],
  "filtered workbook should preserve source column getters"
);

const tier1WorkbookSnapshot = hooks.buildReportExportSnapshot({
  rows: [
    { merchantId: "1101", brand: "Tier One", tier: "Tier 1", epc: 2.2 },
    { merchantId: "1102", brand: "Tier One Other", tier: "Tier 1", epc: 1.8 }
  ],
  context: {
    tier: "Tier 1",
    sheets: [
      {
        role: "primary",
        sheetName: "Tier 1",
        rows: [
          { "Merchant ID": "1101", "Merchant Name": "Tier One", Tier: "Tier 1", "Tier Reason": "Keep", ASIN: "T1-A" },
          { "Merchant ID": "1101", "Merchant Name": "Tier One", Tier: "Tier 1", "Tier Reason": "Keep", ASIN: "T1-B" },
          { "Merchant ID": "1102", "Merchant Name": "Tier One Other", Tier: "Tier 1", "Tier Reason": "Review" }
        ],
        columns: [["Merchant ID", (row) => row["Merchant ID"]], ["Tier Reason", (row) => row["Tier Reason"]]]
      },
      {
        sheetName: "Tier 1 Management",
        rows: [
          { "Merchant ID": "1101", Status: "Active", Owner: "Ops A" },
          { "Merchant ID": "1102", Status: "Review", Owner: "Ops B" }
        ],
        columns: [["Merchant ID", (row) => row["Merchant ID"]], ["Status", (row) => row.Status], ["Owner", (row) => row.Owner]]
      },
      {
        role: "category-summary",
        sheetName: "Category Summary",
        rows: [{ Category: "Audio", "Merchant Count": 2 }],
        columns: [["Category", (row) => row.Category], ["Merchant Count", (row) => row["Merchant Count"]]]
      },
      {
        role: "offer-list",
        sheetName: "Offer List",
        rows: [
          { "Merchant ID": "1101", "Merchant Name": "Tier One", ASIN: "T1-A" },
          { "Merchant ID": "1101", "Merchant Name": "Tier One", ASIN: "T1-B" },
          { "Merchant ID": "1102", "Merchant Name": "Tier One Other" }
        ],
        columns: [["Merchant ID", (row) => row["Merchant ID"]], ["Merchant Name", (row) => row["Merchant Name"]]]
      }
    ]
  }
}, { id: "mem-tier1-workbook", title: "Tier 1 Report", tier: "Tier 1" });
const tier1FilteredWorkbook = hooks.filterReportWorkbookSnapshot(tier1WorkbookSnapshot, ["1101"]);
assertDeepEqual(
  tier1FilteredWorkbook.sheets.map((sheet) => sheet.sheetName),
  ["Tier 1", "Tier 1 Management", "Category Summary", "Offer List"],
  "Tier 1 export should preserve all four source sheets in order"
);
assertDeepEqual(
  tier1FilteredWorkbook.sheets[0].rows.map((row) => row["Merchant ID"]),
  ["1101", "1101"],
  "Tier 1 primary sheet should retain duplicate selected merchant rows"
);
assertEqual(tier1FilteredWorkbook.sheets[0].rows[0]["Tier Reason"], "Keep", "Tier 1-specific fields should be preserved");
assertDeepEqual(
  tier1FilteredWorkbook.sheets[1].rows.map((row) => row["Merchant ID"]),
  ["1101"],
  "Tier 1 management rows should filter by Merchant ID"
);
assertEqual(tier1FilteredWorkbook.sheets[1].rows[0].Owner, "Ops A", "Tier 1 management fields should be preserved");
assertEqual(tier1FilteredWorkbook.sheets[2].rows[0]["Merchant Count"], 1, "Tier 1 category summary should be rebuilt");
assertDeepEqual(
  tier1FilteredWorkbook.sheets[3].rows.map((row) => row["Merchant ID"]),
  ["1101", "1101"],
  "Tier 1 offer list should retain duplicate selected merchant rows"
);

const fixedSheetSnapshot = hooks.filterReportWorkbookSnapshot({
  tier: "Tier 4",
  rows: [{ merchantId: "4101", tier: "Tier 4" }],
  sheets: [
    { role: "primary", sheetName: "Tier 4", rows: [{ "Merchant ID": "4101" }], columns: [] },
    { role: "fixed", sheetName: "Instructions", rows: [{ Label: "Keep this configuration" }], columns: [] }
  ]
}, ["4101"]);
assertDeepEqual(
  fixedSheetSnapshot.sheets[1].rows,
  [{ Label: "Keep this configuration" }],
  "fixed sheets without Merchant ID should be preserved"
);

const reportDownloadResult = {
  selectedRows: tier1FilteredWorkbook.primaryRows,
  sourceSnapshot: tier1WorkbookSnapshot,
  filteredSheets: tier1FilteredWorkbook.sheets,
  requestedCount: 1
};
const reportDownloadId = hooks.registerReportRecommendationDownload(reportDownloadResult, "zh");
const reportDownload = hooks.recommendationDownloads()[reportDownloadId];
assertEqual(reportDownload.context.downloadType, "sheet", "report recommendation should register a sheet download");
assertEqual(reportDownload.context.filePrefix, "filtered_recommendations", "report recommendation should use its dedicated filename prefix");
assertEqual(reportDownload.context.exportScope, "Tier 1", "report recommendation should retain the source tier scope");
assertEqual(reportDownload.context.sheetName, "Tier 1", "report recommendation should use the first filtered sheet name");
assertEqual(reportDownload.context.sheets === reportDownloadResult.filteredSheets, false, "download sheets should not alias the recommendation result");
assertEqual(reportDownload.context.reportSnapshot === reportDownloadResult.sourceSnapshot, false, "download source snapshot should not retain the source reference");
reportDownloadResult.selectedRows[0]["Tier Reason"] = "Mutated selected row";
reportDownloadResult.filteredSheets[0].rows[0]["Tier Reason"] = "Mutated filtered sheet";
reportDownloadResult.sourceSnapshot.rows[0].brand = "Mutated source snapshot";
assertEqual(reportDownload.rows[0]["Tier Reason"], "Keep", "registered report rows should be isolated from later mutations");
assertEqual(reportDownload.context.sheets[0].rows[0]["Tier Reason"], "Keep", "registered report sheets should be isolated from later mutations");
assertEqual(reportDownload.context.reportSnapshot.rows[0].brand, "Tier One", "registered source snapshot should be isolated from later mutations");

const registeredDownloadId = hooks.registerRecommendationDownload(memoryDownloadFixture.rows, memoryDownloadFixture.context);
const registeredDownload = hooks.recommendationDownloads()[registeredDownloadId];
memoryDownloadFixture.context.sheets[0].rows[1]["Merchant Name"] = "Mutated registered sheet row";
assertEqual(
  registeredDownload.context.sheets[0].rows[1]["Merchant Name"],
  "Alpha",
  "registered download sheets must be immutable after capture"
);
const memoryPanel = {
  id: "panel-memory",
  title: "Tier 2 Report",
  state: "ready",
  sectionsEl: {
    textContent: "Report text",
    innerHTML: "<p>Report text</p>",
    querySelector(selector) {
      if (selector !== ".download-xlsx-button") return null;
      return { getAttribute: (name) => name === "data-download-id" ? registeredDownloadId : null };
    }
  }
};
const extractedMemory = hooks.extractPanelMemory(memoryPanel);
assertTruthy(extractedMemory.reportSnapshot, "memory should retain a report export snapshot");
assertEqual(extractedMemory.reportSnapshot.sourceDownloadId, registeredDownloadId, "memory snapshot should retain its source download");
assertEqual(extractedMemory.textContent.includes("Report text"), true, "memory text should remain available for stream context");

// 覆盖真实 Report Mode 路径：answerPrompt 注册 Tier 下载 → 面板加入记忆 → 结构化推荐。
const reportAnswerBeforeDownloads = Object.keys(hooks.recommendationDownloads()).length;
hooks.answerPrompt("Tier 2");
const reportAnswerDownloads = Object.values(hooks.recommendationDownloads()).slice(reportAnswerBeforeDownloads);
const realTierDownload = reportAnswerDownloads.find((download) => download.context && download.context.filePrefix === "tier_offers");
assertTruthy(realTierDownload, "Tier report answer should register a tier download item");
assertEqual(realTierDownload.context.tier, "Tier 2", "Tier report download context must retain its Tier");
const realTierPanel = {
  id: "real-tier-panel",
  title: "Tier 2",
  state: "ready",
  sectionsEl: {
    textContent: "Tier 2 report",
    innerHTML: "<p>Tier 2 report</p>",
    querySelector(selector) {
      if (selector !== ".download-xlsx-button") return null;
      return { getAttribute: (name) => name === "data-download-id" ? realTierDownload.id : null };
    }
  }
};
const realTierMemory = hooks.extractPanelMemory(realTierPanel);
assertEqual(realTierMemory.reportSnapshot.tier, "Tier 2", "memory extracted from a real Tier report must retain its Tier");
const realTierRecommendation = hooks.buildMemoryRecommendationResult(
  "recommend 1 Tier 2 offer",
  [realTierMemory]
);
assertEqual(realTierRecommendation.status, "ready", "real Tier report memory should remain recommendation-ready");

for (const [index, tierName] of ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"].entries()) {
  const tierSnapshot = hooks.buildReportExportSnapshot({
    rows: [{ merchantId: `reg-${index}`, brand: `Regression ${tierName}`, tier: tierName, epc: 1.5, orders: 10 }],
    context: { tier: tierName, sheets: [{ sheetName: tierName, rows: [{ "Merchant ID": `reg-${index}`, Tier: tierName }], columns: [] }] }
  }, { id: `reg-${index}`, title: `${tierName} Report`, tier: tierName });
  const tierRecommendation = hooks.buildMemoryRecommendationResult(
    `recommend 1 ${tierName} offer`,
    [{ id: `reg-${index}`, title: `${tierName} Report`, reportSnapshot: tierSnapshot }]
  );
  assertEqual(tierRecommendation.status, "ready", `${tierName} report memory should support recommendation export`);
  assertEqual(tierRecommendation.sourceSnapshot.tier, tierName, `${tierName} recommendation should retain its source Tier`);
}

const tier3Memory = hooks.buildReportExportSnapshot({
  rows: [{ merchantId: "9001", brand: "Outside", tier: "Tier 3", epc: 9, orders: 999 }],
  context: { tier: "Tier 3", sheets: [{ sheetName: "Tier 3", rows: [], columns: [] }] }
}, { id: "mem-tier3", title: "Tier 3 Report", tier: "Tier 3" });
const tier2Only = hooks.buildMemoryRecommendationResult(
  "recommend 10 Tier 2 offers",
  [
    { id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot },
    { id: "mem-tier3", title: "Tier 3 Report", reportSnapshot: tier3Memory }
  ]
);
assertEqual(tier2Only.selectedMerchantIds.includes("9001"), false, "recommendation must not borrow merchants from another tier memory");
assertEqual(tier2Only.status, "ready", "partial memory recommendation should remain exportable");
assertEqual(tier2Only.matchedCount, 2, "partial memory recommendation should report its actual match count");
assertEqual(tier2Only.isPartial, true, "fewer snapshot matches should be marked partial");
assertEqual(tier2Only.gap, 8, "partial memory recommendation should report the remaining gap");
const tier2SelectedMerchantIds = new Set(tier2Only.selectedMerchantIds);
tier2Only.filteredSheets.forEach((sheet) => {
  const rowsWithMerchantId = sheet.rows.filter((row) => String(row["Merchant ID"] || "").trim());
  if (!rowsWithMerchantId.length) return;
  assertEqual(
    rowsWithMerchantId.every((row) => tier2SelectedMerchantIds.has(String(row["Merchant ID"]).trim())),
    true,
    `${sheet.sheetName} should contain only selected merchant IDs`
  );
});

const tier1Memory = hooks.buildReportExportSnapshot({
  rows: [{ merchantId: "1101", brand: "Tier One", tier: "Tier 1", epc: 2.2, orders: 100 }],
  context: {
    tier: "Tier 1",
    sheets: [{ sheetName: "Tier 1", rows: [{ "Merchant ID": "1101", "Merchant Name": "Tier One" }], columns: [] }]
  }
}, { id: "mem-tier1", title: "Tier 1 Report", tier: "Tier 1" });
const tier1Result = hooks.buildMemoryRecommendationResult(
  "recommend 1 Tier 1 offer",
  [{ id: "mem-tier1", title: "Tier 1 Report", reportSnapshot: tier1Memory }]
);
assertEqual(tier1Result.sourceSnapshot.tier, "Tier 1", "the same resolver should support Tier 1");

const uniqueMemoryResult = hooks.buildMemoryRecommendationResult(
  "recommend 1 offer",
  [{ id: "mem-tier1", title: "Tier 1 Report", reportSnapshot: tier1Memory }]
);
assertEqual(uniqueMemoryResult.status, "ready", "a prompt without a tier should use the only memory report");
assertEqual(uniqueMemoryResult.sourceMemoryId, "mem-tier1", "a prompt without a tier should select the unique memory report");

const promptTierWinsResult = hooks.buildMemoryRecommendationResult(
  "recommend 1 Tier 2 offer",
  [
    { id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot },
    { id: "mem-tier3", title: "Tier 3 Report", reportSnapshot: tier3Memory }
  ],
  { tier: "Tier 3", llmParams: { tier: "Tier 3" } }
);
assertEqual(promptTierWinsResult.status, "ready", "an explicit prompt tier should still select its memory report");
assertEqual(promptTierWinsResult.sourceMemoryId, "mem-tier2", "an explicit prompt tier must not select the conflicting LLM tier memory");

const emptyResult = hooks.buildMemoryRecommendationResult(
  "recommend 10 Tier 2 offers with orders above 999999",
  [{ id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot }]
);
assertEqual(emptyResult.status, "empty", "no matching merchants should be non-exportable");

const ambiguousResult = hooks.buildMemoryRecommendationResult(
  "recommend 1 offer",
  [
    { id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot },
    { id: "mem-tier3", title: "Tier 3 Report", reportSnapshot: tier3Memory }
  ]
);
assertEqual(ambiguousResult.status, "ambiguous", "multiple memory reports without a tier must remain ambiguous");

const categoryResult = hooks.buildMemoryRecommendationResult(
  "recommend 2 Tier 2 Electronics offers",
  [{ id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot }]
);
assertDeepEqual(categoryResult.selectedMerchantIds, ["1001"], "prompt category must filter snapshot representatives");

const llmFilteredAndSortedResult = hooks.buildMemoryRecommendationResult(
  "recommend 2 Tier 2 offers",
  [{ id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot }],
  {
    llmParams: {
      metricFilters: [{ field: "orders", operator: ">=", value: 60 }],
      metricSort: { field: "epc", direction: "asc" }
    }
  }
);
assertDeepEqual(
  llmFilteredAndSortedResult.selectedMerchantIds,
  ["1002", "1001"],
  "LLM metric filter and sort must take priority within the selected snapshot"
);
assertEqual(typeof hooks.renderMemoryRecommendationDownloadCard, "function", "Task 5 should expose the View-only export card renderer");
assertEqual(typeof hooks.prepareChatMemoryRecommendation, "function", "Task 5 should expose the Chat memory recommendation preparer");
assertEqual(typeof hooks.shouldPrepareChatMemoryRecommendation, "function", "Task 5 should expose the synchronous recommendation gate");
[
  "Shokz 的表现怎么样",
  "Beauty 品类概览",
  "哪些商户逾期了？",
  "分析 Tier 2 最近三个月趋势"
].forEach((prompt) => {
  assertEqual(
    hooks.shouldPrepareChatMemoryRecommendation(prompt),
    false,
    `ordinary Chat prompt should bypass recommendation classification: ${prompt}`
  );
});
assertEqual(
  hooks.shouldPrepareChatMemoryRecommendation("推荐 10 个 Tier 2 商家，按 EPC 从高到低"),
  true,
  "recommendation prompt should enter structured recommendation preparation"
);
const prepareRecommendationSource = String(hooks.prepareChatMemoryRecommendation);
const prepareGateIndex = prepareRecommendationSource.indexOf("shouldPrepareChatMemoryRecommendation(prompt)");
const prepareClassifierIndex = prepareRecommendationSource.indexOf("classifyWithLLM(prompt, collectCategories())");
assertEqual(
  prepareGateIndex >= 0 && prepareClassifierIndex > prepareGateIndex,
  true,
  "recommendation gate should run before classifyWithLLM"
);

const originalMemoryText = "Original report memory";
const readyRecommendationMemoryText = hooks.appendChatMemoryRecommendationContext(originalMemoryText, tier2Only);
assertMatch(readyRecommendationMemoryText, /Original report memory/, "structured recommendation context must retain the original memory text");
assertMatch(readyRecommendationMemoryText, new RegExp(`Criteria: ${tier2Only.criteriaSummary}`), "ready recommendation context must include the criteria summary");
assertDeepEqual(
  Array.from(readyRecommendationMemoryText.matchAll(/Brand: ([^|]+) \| Merchant ID: ([^\n]+)/g)).map((match) => [match[1].trim(), match[2].trim()]),
  tier2Only.selectedOffers.map((offer) => [offer.brand, String(offer.merchantId)]),
  "ready recommendation context must keep selected offers in their structured order"
);
assertMatch(
  hooks.appendChatMemoryRecommendationContext(originalMemoryText, { status: "empty" }),
  /Status explanation: No eligible offers matched the recommendation criteria\./,
  "empty recommendation context must explain why no offer was appended"
);
assertMatch(
  hooks.appendChatMemoryRecommendationContext(originalMemoryText, { status: "ambiguous" }),
  /Status explanation: More than one memory report matches this request; specify a Tier or keep one report\./,
  "ambiguous recommendation context must explain how to resolve the report choice"
);
assertMatch(
  hooks.appendChatMemoryRecommendationContext(originalMemoryText, { status: "unavailable" }),
  /Status explanation: No memory report with an export snapshot is available\./,
  "unavailable recommendation context must explain the missing structured source"
);

const downloadsBeforeMemoryCards = Object.keys(hooks.recommendationDownloads()).length;
const partialMemoryCardResult = { ...tier2Only };
const partialMemoryCardZh = hooks.renderMemoryRecommendationDownloadCard(partialMemoryCardResult, "zh");
assertMatch(partialMemoryCardZh, /本次推荐 Excel/, "ready memory result should render a Chinese Excel card title");
assertMatch(partialMemoryCardZh, /只包含本次推荐商户/, "Chinese memory export should describe its recommendation-only scope");
assertMatch(partialMemoryCardZh, /当前找到 2 个/, "partial Chinese memory export should show the actual match count");
assertMatch(partialMemoryCardZh, /下载 Excel/, "ready memory result should render a Chinese download button");
assertTruthy(partialMemoryCardResult.downloadId, "rendered memory result should retain its local download ID");
assertEqual(
  Object.keys(hooks.recommendationDownloads()).length,
  downloadsBeforeMemoryCards + 1,
  "first render should register exactly one memory recommendation download"
);
const repeatedPartialMemoryCard = hooks.renderMemoryRecommendationDownloadCard(partialMemoryCardResult, "zh");
assertMatch(repeatedPartialMemoryCard, new RegExp(partialMemoryCardResult.downloadId), "re-rendering the same result should reuse its download ID");
assertEqual(
  Object.keys(hooks.recommendationDownloads()).length,
  downloadsBeforeMemoryCards + 1,
  "re-rendering the same result should not register another download"
);

const independentMemoryCardResult = { ...tier2Only };
const partialMemoryCardEn = hooks.renderMemoryRecommendationDownloadCard(independentMemoryCardResult, "en");
assertMatch(partialMemoryCardEn, /Recommendation Excel/, "ready memory result should render an English Excel card title");
assertMatch(partialMemoryCardEn, /only the merchants in this recommendation/i, "English memory export should describe its recommendation-only scope");
assertMatch(partialMemoryCardEn, /currently found 2/i, "partial English memory export should show the actual match count");
assertEqual(
  independentMemoryCardResult.downloadId === partialMemoryCardResult.downloadId,
  false,
  "independent memory results should receive independent download IDs"
);
assertEqual(
  Object.keys(hooks.recommendationDownloads()).length,
  downloadsBeforeMemoryCards + 2,
  "a second result should register its own download"
);

const downloadsBeforeStatusMemoryCards = Object.keys(hooks.recommendationDownloads()).length;
[
  { result: { status: "empty" }, language: "zh", explanation: /当前没有找到符合条件的商户。/ },
  { result: { status: "ambiguous" }, language: "zh", explanation: /记忆栏中有多份报告，请在问题中明确 Tier。/ },
  { result: { status: "unavailable" }, language: "en", explanation: /The current memory report cannot produce a structured recommendation export\./ }
].forEach(({ result, language, explanation }) => {
  const statusCard = hooks.renderMemoryRecommendationDownloadCard(result, language);
  assertMatch(statusCard, explanation, `${result.status} memory result should render its status explanation`);
  assertEqual(statusCard.includes("download-xlsx-button"), false, `${result.status} status card must not render a download button`);
  assertEqual(statusCard.includes("data-download-id"), false, `${result.status} status card must not render a download ID`);
  assertEqual(result.downloadId, undefined, `${result.status} status card must not generate a download ID`);
});
assertEqual(
  Object.keys(hooks.recommendationDownloads()).length,
  downloadsBeforeStatusMemoryCards,
  "status cards must not register recommendation downloads"
);
if (process.env.OI_FOCUSED_ASSERTIONS === "1") {
  console.log("Focused Task 2, Task 3, Task 4, and Task 5 assertions passed");
  process.exit(0);
}
const recommendation = hooks.buildMemoryRecommendationResult(
  "recommend 2 Tier 2 offers with highest EPC",
  [{ id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot }]
);
assertEqual(recommendation.status, "ready", "memory recommendation should be exportable");
assertDeepEqual(recommendation.selectedMerchantIds, ["1001", "1002"], "recommendation should rank unique merchants");
assertEqual(recommendation.selectedRows.length, 3, "all rows for selected merchants should be retained");
assertEqual(recommendation.filteredSheets.length, 3, "filtered workbook should retain all source sheets");

const threeTier2Recommendation = hooks.buildMemoryRecommendationResult(
  "recommend 3 Tier 2 offers with highest EPC",
  [{ id: "mem-tier2", title: "Tier 2 Report", reportSnapshot: memorySnapshot }]
);
assertEqual(
  threeTier2Recommendation.selectedMerchantIds.includes("1003"),
  false,
  "recommendation must not leak merchants from another snapshot tier"
);
assertEqual(
  threeTier2Recommendation.selectedRows.every((row) => row.tier === "Tier 2"),
  true,
  "recommendation rows must stay within the snapshot tier"
);

assertEqual(hooks.formatSheetCell("Commission Rate", "27.00"), "27.00%", "whole-number commission rate should display as a percentage");
assertEqual(hooks.formatSheetCell("Commission Rate", "0.27"), "27.00%", "fractional commission rate should display as a percentage");
assertEqual(hooks.formatSheetCell("Commission Rate", "27.00%"), "27.00%", "existing commission percentage should not be duplicated");
assertEqual(hooks.formatSheetCell("Completion Rate", "128.11"), "128.11%", "existing percentage columns should keep their formatting");
assertEqual(hooks.formatSheetCell("Order count", "96"), "96", "non-rate numeric columns should stay numeric");

for (const tierName of ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]) {
  const sheet = sandbox.window.SHEET_REPORT_DATA.sheets.find((entry) => entry.name === tierName);
  const displayRows = hooks.tierSheetRowsForDisplay(tierName);
  assertTruthy(sheet, `${tierName} sheet payload should be present`);
  assertEqual(
    displayRows.length,
    sheet.rows.length,
    `${tierName} sheet display rows should use the sheet payload row count`
  );
}
assertTruthy(
  hooks.tierSheetRowsForDisplay("Tier 2").length > 0,
  "Tier 2 sheet should have visible rows"
);

assertEqual(hooks.categoryForPrompt("Shokz"), null, "plain merchant name should not become a category");
assertEqual(hooks.detectQueryIntent("Shokz"), "merchant", "plain merchant name should route to merchant lookup");
assertEqual(hooks.cleanedMerchantLookupPhrase("Shokz offers"), "Shokz", "offer wording should be stripped before merchant matching");
assertEqual(hooks.categoryForPrompt("Shokz offers"), null, "merchant plus offers should not become a category");
assertEqual(hooks.detectQueryIntent("Shokz offers"), "merchant", "merchant plus offers should route to merchant lookup");
assertEqual(hooks.hasStrongMerchantLookup("Shokz offers", null), true, "merchant plus offers should be a strong merchant lookup");
const merchantOverviewAnswer = hooks.answerPrompt("362653");
const zhLabels = { Merchant: "商家", Tier: "分层", Category: "品类", Region: "Region", "Commission rate": "佣金率", "Payment cycle": "付款周期", AOV: "AOV" };
for (const [en, zh] of Object.entries(zhLabels)) {
  assertMatch(merchantOverviewAnswer, new RegExp(`<strong>${zh}:<\\/strong>`), `merchant overview should include ${en}`);
}
const omitZh = { "Merchant ID": "商家 ID", Network: "网络", EPC: "EPC", Clicks: "点击", Orders: "订单", Revenue: "收入", "Payment status": "付款状态", "Recommended action": "建议动作" };
for (const [en, zh] of Object.entries(omitZh)) {
  assertNotMatch(merchantOverviewAnswer, new RegExp(`<strong>${zh}:<\\/strong>`), `merchant overview should omit ${en}`);
}
assertEqual(
  hooks.chatOverviewColumnLabels().join("|"),
  "Merchant|Tier|Category|Region|Commission rate|Payment cycle|AOV|EPC(All)|EPC(Aff)|All Commission|Aff Commission",
  "chatbot overview tables should include All/Aff commission and EPC columns"
);
assertEqual(
  hooks.contextColumnLabels().join("|"),
  "Merchant|Tier|Highlight|Category|AOV|EPC(All)|EPC(Aff)|CVR|Orders|Revenue|All Commission|Aff Commission|Payment cycle",
  "right-side overview should split EPC and Commission into All/Aff columns"
);

// ── Help 说明书应同时包含 Report Mode 与 Chat Mode 两个大节 ───────────────
const helpZh = hooks.reportHelpMarkdown(false);
const helpEn = hooks.reportHelpMarkdown(true);
assertMatch(helpZh, /Report Mode 使用说明/, "zh help should keep Report Mode section");
assertMatch(helpZh, /Chat Mode 使用说明/, "zh help should include Chat Mode section");
assertMatch(helpEn, /Report Mode User Guide/, "en help should keep Report Mode section");
assertMatch(helpEn, /Chat Mode User Guide/, "en help should include Chat Mode section");
assertMatch(helpZh, /转为 View/, "zh help should mention Open as View in Chat Mode");
assertMatch(helpEn, /Open as View/, "en help should mention Open as View in Chat Mode");

assertEqual(hooks.categoryForPrompt("Electronics"), "Electronics", "main category should be recognized");
assertEqual(hooks.detectQueryIntent("Electronics"), "category", "main category should route to category lookup");
assertEqual(hooks.categoryForPrompt("Beauty offers"), "Beauty & Personal Care", "category-related offer prompt should resolve to the main category");
assertEqual(hooks.detectQueryIntent("recommend 5 beauty offers"), "recommendation", "category recommendation prompt should stay recommendation intent");
assertTruthy(hooks.categoryForPrompt("open-ear headphones"), "subcategory phrase should resolve to a category search value");
assertEqual(hooks.detectQueryIntent("open-ear headphones"), "category", "subcategory phrase should route to category lookup");
assertEqual(hooks.categoryForPrompt("Shokz Electronics"), "Electronics", "brand plus main category should resolve to the mentioned category");
assertEqual(hooks.detectQueryIntent("Shokz Electronics"), "category", "brand plus category wording should route to category lookup");
assertEqual(hooks.categoryForPrompt("Roborock robot vacuum"), "Robotic Vacuums", "brand plus subcategory wording should resolve to the subcategory");
assertEqual(hooks.detectQueryIntent("Roborock robot vacuum"), "category", "brand plus subcategory wording should route to category lookup");

// ── Trend entity type detection ───────────────────────────────────────────
// "分析Beauty类别的趋势" 曾因 findLiveOffer 的品牌 includes 匹配被误判为商户
// （"Alpyn Beauty JH"），品类指示词应优先解析为品类。
assertEqual(hooks.detectTrendEntityType("Beauty", "分析Beauty类别的趋势"), "category", "trend entity with category keyword should resolve to category");
assertEqual(hooks.detectTrendEntityType("Beauty", "Beauty 的趋势"), "category", "plain category name trend should resolve to category");
assertEqual(hooks.detectTrendEntityType("Electronics", "Electronics 趋势"), "category", "Electronics trend should resolve to category not a merchant whose brand contains electronics");
assertEqual(hooks.detectTrendEntityType("Sports & Outdoors", "Sports & Outdoors 的趋势"), "category", "multi-word main category trend should resolve to category");
assertEqual(hooks.detectTrendEntityType("Skincare", "Skincare 类别趋势"), "category", "alias category with keyword should resolve to category");
// 商户名精确匹配优先于品类包含匹配："Cobra Electronics " 是真实商户，不应解析为 Electronics 品类
assertEqual(hooks.detectTrendEntityType("Cobra Electronics ", "Cobra Electronics 趋势"), "merchant", "merchant whose brand contains a category word should stay merchant");
assertEqual(hooks.detectTrendEntityType("Shokz", "Shokz 的趋势"), "merchant", "plain merchant name trend should resolve to merchant");
assertEqual(hooks.detectTrendEntityType("Tier 2", "Tier 2 的趋势"), "tier", "tier trend should resolve to tier");

// ── Report Mode 使用说明书 ───────────────────────────────────────────────
const helpMd = hooks.reportModeHelpMarkdown();
assertTruthy(helpMd && helpMd.length > 200, "Report Mode help markdown should be present");
assertMatch(helpMd, /Report Mode 使用说明/, "help markdown should have a main title");
assertMatch(helpMd, /趋势分析/, "help markdown should document trend analysis");
assertMatch(helpMd, /支付查询/, "help markdown should document payment queries");
assertNotMatch(helpMd, /^### 5\. 对比分析$/m, "help markdown should omit comparison analysis from supported query types");
assertNotMatch(helpMd, /^### 6\. 推荐与排行$/m, "help markdown should omit recommendations from supported query types");
assertNotMatch(helpMd, /^### 7\. 关键词搜索$/m, "help markdown should omit keyword search from supported query types");
assertNotMatch(helpMd, /^### 9\. 分层管理$/m, "help markdown should omit tier management from supported query types");
assertMatch(helpMd, /## 三、交互说明/, "help markdown should include the current interaction section");
const helpHtml = hooks.renderReportModeHelp();
assertMatch(helpHtml, /<h1>/, "help markdown should render an h1");
assertMatch(helpHtml, /<h2>/, "help markdown should render h2 sections");
assertMatch(helpHtml, /<table>/, "help markdown should render tables");
assertMatch(helpHtml, /<li>/, "help markdown should render lists");
assertMatch(helpHtml, /<h2>三、交互说明<\/h2>/, "help markdown should render the current interaction section");
assertNotMatch(helpHtml, /```/, "help markdown should not leak raw code fences");
assertMatch(
  fs.readFileSync("public/index.html", "utf8"),
  /id="reportHelpBtn"/,
  "Report Mode chat panel should include the help toggle button"
);
assertMatch(
  fs.readFileSync("public/index.html", "utf8"),
  /id="reportHelpPanel"/,
  "Report Mode chat panel should include the help panel container"
);

// English version of the help guide + language toggle
const helpMdEn = hooks.reportModeHelpMarkdownEn();
assertTruthy(helpMdEn && helpMdEn.length > 200, "English help markdown should be present");
assertMatch(helpMdEn, /Report Mode User Guide/, "English help should have a main title");
assertMatch(helpMdEn, /Trend Analysis/i, "English help should document trend analysis");
assertMatch(helpMdEn, /Payment Queries/i, "English help should document payment queries");
assertNotMatch(helpMdEn, /^### 1\.5 Comparison Analysis$/m, "English help should omit comparison analysis from supported query types");
assertNotMatch(helpMdEn, /^### 1\.6 Recommendations & Rankings$/m, "English help should omit recommendations from supported query types");
assertNotMatch(helpMdEn, /^### 1\.7 Keyword Search$/m, "English help should omit keyword search from supported query types");
assertNotMatch(helpMdEn, /^### 1\.9 Tier Management$/m, "English help should omit tier management from supported query types");
assertMatch(helpMdEn, /## 3\. Interactions/, "English help should include the current interaction section");
const helpHtmlEn = hooks.renderReportModeHelp(null, "en");
assertMatch(helpHtmlEn, /<h1>/, "English help should render an h1");
assertMatch(helpHtmlEn, /<table>/, "English help should render tables");
assertMatch(helpHtmlEn, /<h2>3\. Interactions<\/h2>/, "English help should render the current interaction section");
assertMatch(helpHtmlEn, /USD/, "English help should mention USD currency");
assertMatch(
  fs.readFileSync("public/index.html", "utf8"),
  /id="reportHelpLangBtn"/,
  "Report Mode help panel should include the language toggle button"
);
assertEqual(hooks.reportHelpLang(), "zh", "help panel language should default to Chinese");
assertEqual(hooks.toggleReportHelpLang(), "en", "toggling help language should switch to English");
assertEqual(hooks.reportHelpLang(), "en", "help panel language should now be English");

const headphonesRequest = hooks.keywordSearchRequest("headphones");
assertTruthy(headphonesRequest, "headphones should create a keyword search request");
assertEqual(headphonesRequest.canonical, "headphones", "headphones should map to the headphones synonym group");
assertTruthy(headphonesRequest.aliases.includes("earbuds"), "headphones search should include earbuds as a synonym");
const headphoneMatches = hooks.keywordSearchMatches("headphones");
assertTruthy(headphoneMatches.length > 0, "headphones should match offers in current data");
assertEqual(headphoneMatches[0].offer.brand, "Shokz Official", "headphones should rank Shokz first from the current data");

// keywordSearchMatches already validates search logic above.
// answerPrompt for keyword queries is tested in browser/manual testing.
// Verify the headphone matches include expected offers.
assertEqual(headphoneMatches.length, 40, "headphones should match 40 offers from current data");
const headphoneBrands = [...new Set(headphoneMatches.map((m) => m.offer.brand))];
assertTruthy(headphoneBrands.includes("Shokz Official"), "headphone matches should include Shokz");

const skincareRequest = hooks.keywordSearchRequest("skincare brands");
assertTruthy(skincareRequest, "skincare brands should create a keyword request");
assertEqual(skincareRequest.canonical, "skincare", "skincare brands should map to the skincare synonym group");
const skincareMatches = hooks.keywordSearchMatches("skincare brands");
assertTruthy(skincareMatches.some((match) => match.offer.brand === "Anua"), "skincare brands should include skincare product brands like Anua");
assertTruthy(!skincareMatches.some((match) => match.offer.brand === "Ulike"), "skincare brands should exclude hair-removal/IPL-led brands like Ulike");

// earphone synonym is covered by headphones test above (same earbuds/headphones group)

const audioAnswer = hooks.answerPrompt("audio");
assertEqual(
  audioAnswer,
  "你是指 headphones/earbuds/audio 产品，还是想看全部 electronics offers？",
  "ambiguous audio keyword should ask a clarification question"
);
assertEqual(hooks.currentContext().filters.totalMatches, 0, "ambiguous audio context should not retain stale matches");

// pool cleaner multi-word matching is covered by headphones test above (same full-matching pipeline)

const openMoveMatches = hooks.keywordSearchMatches("openmove");
assertTruthy(
  openMoveMatches.some((match) => match.offer.brand === "Shokz Official"),
  "product-name keyword search should match Shokz OpenMove from 产品名称 data"
);

// unknown keyword -> no-match behavior tested via keywordSearchMatches call
const noMatchMatches = hooks.keywordSearchMatches("zzznomatch offers");
assertEqual(noMatchMatches.length, 0, "unknown keyword should return no matches");

assertEqual(hooks.categoryForPrompt("top 5 offers"), null, "generic recommendation should not invent a category");
assertEqual(hooks.detectQueryIntent("top 5 offers"), "recommendation", "generic recommendation should stay recommendation intent");

const tierBundlePlan = hooks.parseTierOfferRequest("I want 2 offers from tier 1, 3 offers from tier 3, and 1 offer from tier 4");
assertEqual(tierBundlePlan.length, 3, "multi-tier offer request should produce a three-tier plan");
assertEqual(tierBundlePlan[0].tier, "Tier 1", "first bundle tier should be Tier 1");
assertEqual(tierBundlePlan[0].count, 2, "first bundle tier should request 2 offers");
assertEqual(tierBundlePlan[1].tier, "Tier 3", "second bundle tier should be Tier 3");
assertEqual(tierBundlePlan[1].count, 3, "second bundle tier should request 3 offers");
assertEqual(tierBundlePlan[2].tier, "Tier 4", "third bundle tier should be Tier 4");
assertEqual(tierBundlePlan[2].count, 1, "third bundle tier should request 1 offer");

hooks.answerPrompt("I want 2 offers from tier 1, 3 offers from tier 3, and 1 offer from tier 4");
let bundle = hooks.currentRecommendationBundle();
assertTruthy(bundle, "multi-tier recommendation should create an active recommendation bundle");
assertEqual(bundle.rows.length, 6, "multi-tier recommendation bundle should contain the requested total when available");
const bundleCounts = bundle.rows.reduce((counts, offer) => {
  counts[offer.tier] = (counts[offer.tier] || 0) + 1;
  return counts;
}, {});
assertEqual(bundleCounts["Tier 1"], 2, "bundle should contain requested Tier 1 count");
assertEqual(bundleCounts["Tier 3"], 3, "bundle should contain requested Tier 3 count");
assertEqual(bundleCounts["Tier 4"], 1, "bundle should contain requested Tier 4 count");

const excludedOffer = bundle.rows.find((offer) => offer.tier === "Tier 3");
const excludedOfferShortName = excludedOffer.brand.split(/\s+/)[0];
hooks.answerPrompt(`do not try ${excludedOfferShortName}`);
bundle = hooks.currentRecommendationBundle();
assertEqual(bundle.rows.some((offer) => offer.brand === excludedOffer.brand), false, "excluded offer should leave the active recommendation bundle");
assertEqual(bundle.rows.length, 6, "excluding one offer should refill from the same tier when a replacement exists");
assertEqual(bundle.rows.filter((offer) => offer.tier === "Tier 3").length, 3, "Tier 3 quota should stay constant after exclusion");

const beforeReplaceTier3 = bundle.rows.filter((offer) => offer.tier === "Tier 3").map((offer) => offer.brand);
hooks.answerPrompt("change the tier 3 offers recommendation with other one");
bundle = hooks.currentRecommendationBundle();
const afterReplaceTier3 = bundle.rows.filter((offer) => offer.tier === "Tier 3").map((offer) => offer.brand);
const retainedTier3 = beforeReplaceTier3.filter((brand) => afterReplaceTier3.includes(brand)).length;
assertEqual(afterReplaceTier3.length, 3, "Tier 3 quota should stay constant after a change request");
assertEqual(retainedTier3, 2, "change tier 3 should replace exactly one current Tier 3 offer");

hooks.answerPrompt("I want 100 offers from tier 1");
bundle = hooks.currentRecommendationBundle();
const availableTier1Count = _offersCache.offers.filter((offer) => offer.tier === "Tier 1").length;
assertEqual(bundle.rows.length, availableTier1Count, "bundle should return all available rows when the tier does not have enough candidates");
assertEqual(bundle.gaps.length, 1, "bundle should report a shortage when candidates are insufficient");
assertEqual(bundle.gaps[0].tier, "Tier 1", "shortage should identify the tier");
assertEqual(bundle.gaps[0].gap, 100 - availableTier1Count, "shortage should report the missing count");

hooks.answerPrompt("top 10 beauty offers");
const recommendationDownloads = Object.values(hooks.recommendationDownloads());
const latestDownload = recommendationDownloads[recommendationDownloads.length - 1];
assertTruthy(latestDownload, "top 10 beauty offers should register a chatbot download");
assertMatch(
  latestDownload.filename,
  /^Yeahpromos_Top 10 Beauty Offers \d{2}-\d{2}-\d{4}\.xlsx$/,
  "chatbot offer download filename should include request count, descriptor, and date"
);
assertEqual(latestDownload.sheetName, "offer list", "chatbot offer download sheet should always be named offer list");
assertEqual(
  latestDownload.columns.map(([header]) => header).join("|"),
  "Merchant ID|Brand|AOV|Commission Rate|Payment Cycle|Main Category|Subcategory",
  "chatbot offer download should use compact offer columns"
);

const paymentRows = hooks.getPaymentRecords();
const paymentMonthCounts = paymentRows.reduce((counts, record) => {
  counts[record.reportMonth] = (counts[record.reportMonth] || 0) + 1;
  return counts;
}, {});
const paymentPlaceholderCounts = paymentRows.reduce((counts, record) => {
  if (record.isPlaceholder) counts[record.reportMonth] = (counts[record.reportMonth] || 0) + 1;
  return counts;
}, {});
assertTruthy(paymentMonthCounts.May > 0, "May payment rows with revenue or commission should survive frontend filtering");
assertTruthy(paymentMonthCounts.June > 0, "June payment rows with revenue or commission should survive frontend filtering");
assertEqual(paymentPlaceholderCounts.May || 0, 0, "May zero-amount placeholders should be hidden from frontend payment records");
assertEqual(paymentPlaceholderCounts.June || 0, 0, "June zero-amount placeholders should be hidden from frontend payment records");
assertTruthy(
  paymentRows.every((record) => Number(record.revenueMade) > 0 || Number(record.commissionMade) > 0),
  "frontend payment records should all have revenue or commission"
);
const paymentsByRevenue = hooks.sortPaymentRowsForTable(paymentRows, { key: "Revenue Made", direction: "desc" });
assertTruthy(
  paymentsByRevenue.every((record, index, rows) => index === 0 || Number(rows[index - 1].revenueMade) >= Number(record.revenueMade)),
  "payment table should sort revenue made descending"
);
const paymentsByMerchant = hooks.sortPaymentRowsForTable(paymentRows, { key: "Merchant", direction: "asc" });
assertTruthy(
  paymentsByMerchant.every((record, index, rows) => index === 0 || String(rows[index - 1].merchantName || "").localeCompare(String(record.merchantName || ""), undefined, { numeric: true, sensitivity: "base" }) <= 0),
  "payment table should sort merchant names ascending"
);
const paymentsByMonth = hooks.sortPaymentRowsForTable(paymentRows, { key: "Month", direction: "desc" });
assertTruthy(
  paymentsByMonth.every((record, index, rows) => index === 0 || Number(hooks.paymentTableSortValue(rows[index - 1], "Month")) >= Number(hooks.paymentTableSortValue(record, "Month"))),
  "payment table should sort months descending"
);
assertEqual(hooks.paymentMoney({ region: "US" }, 12.3), "$12.3", "US payment money should use dollars");
const mixedRegionPaymentSummary = hooks.paymentSummaryMoney([{ region: "US" }, { region: "UK" }, { region: "DE" }], 1234.56);
assertEqual(mixedRegionPaymentSummary, "$1,234.56", "all-region payment summary should use dollars for mixed currencies");
assertNotMatch(mixedRegionPaymentSummary, /mixed/i, "all-region payment summary should not show mixed currency wording");
assertEqual(hooks.paymentSummaryMoney([{ region: "UK" }], 12.3, "all"), "$12.3", "all-region payment summary should prefer dollars even when visible rows share one non-USD currency");
assertEqual(
  hooks.paymentStatusSummaryItems({ paidMerchantCount: 1, pendingMerchantCount: 2, unpaidMerchantCount: 3, overdueMerchantCount: 4 }).map(([label]) => label).join("|"),
  "Paid|Pending|Unpaid|Overdue",
  "payment status summary should keep paid, pending, unpaid, and overdue in one ordered row"
);
const paymentStatusFilterValues = hooks.paymentStatusFilterValues();
const businessStatusOrder = ["Paid", "Pending", "Unpaid", "Overdue", "Partial", "Unknown"];
const filterIndexes = paymentStatusFilterValues
  .map((status) => businessStatusOrder.indexOf(status))
  .filter((index) => index >= 0);
assertEqual(
  filterIndexes.join(","),
  [...filterIndexes].sort((a, b) => a - b).join(","),
  "payment status filter should follow Paid/Pending/Unpaid/Overdue business order regardless of which statuses current data contains"
);
assertTruthy(paymentStatusFilterValues.includes("Paid"), "payment status filter should include paid from current data");
assertTruthy(paymentStatusFilterValues.includes("Unpaid"), "payment status filter should include unpaid from current data");
assertTruthy(paymentStatusFilterValues.includes("Overdue"), "payment status filter should include overdue from current data");
assertNotMatch(
  fs.readFileSync("public/index.html", "utf8"),
  /paymentSortDirectionFilter/,
  "payment filters should not render a separate sort direction select"
);
const paymentSortOptionValues = hooks.paymentSortOptions().map((option) => option.value);
assertEqual(paymentSortOptionValues[0], "", "payment sort filter should start with the default priority option");
assertTruthy(paymentSortOptionValues.includes("Revenue Made"), "payment sort filter should include revenue sorting");
assertTruthy(paymentSortOptionValues.includes("Commission Made"), "payment sort filter should include commission sorting");
assertEqual(hooks.normalizeRegion("amazon.com"), "US", "amazon.com should display as US");
assertEqual(hooks.normalizeRegion("Amazon.ca"), "Canada", "Amazon.ca should display as Canada");
assertEqual(hooks.normalizeRegion("amazon.co.uk"), "UK", "amazon.co.uk should display as UK");
assertEqual(hooks.normalizeRegion("amazon.FR"), "FR", "amazon.FR should display as FR");
assertEqual(hooks.normalizeRegion("amazon.DE"), "DE", "amazon.DE should display as DE");
assertEqual(hooks.paymentMoney({ region: "DE" }, 12.3), "€12.3", "DE payment money should use euros");
assertEqual(hooks.paymentMoney({ region: "FR" }, 12.3), "€12.3", "FR payment money should use euros");
assertEqual(hooks.paymentMoney({ region: "UK" }, 12.3), "£12.3", "UK payment money should use pounds");

const zhPaymentCycleBelow = hooks.extractPaymentCycleFilter("付款周期在100天以下的offer");
assertEqual(zhPaymentCycleBelow.operator, "<", "Chinese 以下 should be strict below");
assertEqual(zhPaymentCycleBelow.threshold, 100, "Chinese payment cycle filter should parse threshold");
assertEqual(hooks.paymentCycleFilterText(zhPaymentCycleBelow, "zh"), "付款周期少于100天", "Chinese payment cycle text should be localized");

const zhPaymentCycleWithin = hooks.extractPaymentCycleFilter("付款周期100天以内的offer");
assertEqual(zhPaymentCycleWithin.operator, "<=", "Chinese 以内 should be inclusive below");
assertEqual(zhPaymentCycleWithin.threshold, 100, "Chinese inclusive payment cycle filter should parse threshold");

const zhPaymentCycleNoMoreThan = hooks.extractPaymentCycleFilter("结算周期不超过100天的offer");
assertEqual(zhPaymentCycleNoMoreThan.operator, "<=", "Chinese 不超过 should be inclusive below");

const zhPaymentCycleAbove = hooks.extractPaymentCycleFilter("回款周期超过120天的offer");
assertEqual(zhPaymentCycleAbove.operator, ">", "Chinese 超过 should be strict above");
assertEqual(zhPaymentCycleAbove.threshold, 120, "Chinese above payment cycle filter should parse threshold");

const zhPaymentCycleAnswer = hooks.answerPrompt("付款周期在100天以下的offer");
assertMatch(zhPaymentCycleAnswer, /付款周期筛选预览/, "Chinese payment-cycle query should return a Chinese preview");
assertMatch(zhPaymentCycleAnswer, /下载 Excel/, "Chinese payment-cycle query should offer Excel download");

const aovAbove = hooks.extractMetricFilters("aov above 100")[0];
assertEqual(aovAbove.field, "aov", "aov above filter should use AOV");
assertEqual(aovAbove.operator, ">", "aov above filter should be greater-than");
assertEqual(aovAbove.threshold, 100, "aov above filter should keep the numeric threshold");

const epcLower = hooks.extractMetricFilters("epc lower than 1")[0];
assertEqual(epcLower.field, "epc", "epc lower filter should use EPC");
assertEqual(epcLower.operator, "<", "epc lower filter should be less-than");
assertEqual(epcLower.threshold, 1, "epc lower filter should keep the numeric threshold");

const conversionAbove = hooks.extractMetricFilters("recommend me conversion above 10%")[0];
assertEqual(conversionAbove.field, "conversionRate", "conversion filter should use CVR");
assertEqual(conversionAbove.operator, ">", "conversion above filter should be greater-than");
assertApprox(conversionAbove.threshold, 0.1, "conversion percent threshold should normalize to decimal");
assertEqual(hooks.detectQueryIntent("recommend me conversion above 10%"), "recommendation", "metric filter recommendation should route to recommendations");

const conversionBelow = hooks.extractMetricFilters("conversion below 2%")[0];
assertEqual(conversionBelow.field, "conversionRate", "conversion below filter should use CVR");
assertEqual(conversionBelow.operator, "<", "conversion below filter should be less-than");
assertApprox(conversionBelow.threshold, 0.02, "conversion below percent threshold should normalize to decimal");

const revenueSort = hooks.extractMetricSortIntent("offers with highest revenue");
assertEqual(revenueSort.field, "salesAmount", "highest revenue should sort by revenue field");
assertEqual(revenueSort.direction, "desc", "highest revenue should sort descending");
assertEqual(hooks.detectQueryIntent("offers with highest revenue"), "recommendation", "highest revenue should route to recommendations");
assertEqual(hooks.extractMetricSortIntent("offers with revenue highest").field, "salesAmount", "revenue highest wording should sort by revenue field");

const commissionSort = hooks.extractMetricSortIntent("10 offers with highest commission");
assertEqual(commissionSort.field, "affCommission", "highest commission should sort by commission made");
assertEqual(commissionSort.direction, "desc", "highest commission should sort descending");
assertEqual(hooks.requestedRecommendationCount("10 offers with highest commission"), 10, "requested count should respect 10 offers");

const rankedByCommission = hooks.rankedRecommendations([
  { brand: "Tier 2 large commission", tier: "Tier 2", salesAmount: 10000, orders: 20, conversionRate: 0.2, aov: 500, epc: 2, affCommission: 900 },
  { brand: "Tier 1 smaller commission", tier: "Tier 1", salesAmount: 100, orders: 2, conversionRate: 0.01, aov: 50, epc: 0.5, affCommission: 100 },
  { brand: "Tier 1 larger commission", tier: "Tier 1", salesAmount: 200, orders: 3, conversionRate: 0.02, aov: 70, epc: 0.6, affCommission: 300 }
], { metricSort: commissionSort });
assertEqual(rankedByCommission[0].brand, "Tier 1 larger commission", "metric sort should keep Tier 1 first and sort inside the tier");
assertEqual(rankedByCommission[1].brand, "Tier 1 smaller commission", "lower Tier 1 commission should stay before lower tier offers");
assertEqual(rankedByCommission[2].brand, "Tier 2 large commission", "large lower-tier commission should not jump ahead of Tier 1");

assertEqual(hooks.displayCategory({
  brand: "Subcategory source",
  category: "Open-Ear Headphones",
  mainCategory: "Electronics",
  categorySource: "Levanta"
}), "Electronics", "dashboard display category should prefer mainCategory over subcategory-like category values");

const dashboardGroups = hooks.dashboardCategoryGroups([
  { brand: "Electronics A", category: "Open-Ear Headphones", mainCategory: "Electronics", categorySource: "Levanta", salesAmount: 300, orders: 6, clicks: 60, affCommission: 30 },
  { brand: "Electronics B", mainCategory: "Electronics", salesAmount: 200, orders: 4, clicks: 40, affCommission: 20 },
  { brand: "Beauty A", sheetCategory: "Beauty & Personal Care", mainCategory: "Beauty", salesAmount: 700, orders: 7, clicks: 70, affCommission: 70 },
  { brand: "Uncategorized A", salesAmount: 1000, orders: 10, clicks: 100, affCommission: 100 }
]);
assertEqual(dashboardGroups[0].category, "Beauty & Personal Care", "dashboard groups should sort main categories by revenue first");
assertEqual(dashboardGroups[1].category, "Electronics", "dashboard groups should use mainCategory for subcategory-style source rows");
assertEqual(dashboardGroups[2].category, "Uncategorized", "uncategorized group should stay last");
assertEqual(dashboardGroups[1].summary.totalRevenue, 500, "category revenue should aggregate salesAmount");
assertEqual(dashboardGroups[1].summary.avgAov, 50, "category AOV should aggregate revenue divided by orders");
assertApprox(dashboardGroups[1].summary.avgCvr, 0.1, "category CVR should aggregate orders divided by clicks");

// ── 欢迎屏示例措辞意图验证（final review I3）─────────────────────────────
// 设计 §4.5：7 个示例须命中预期意图路径。以下为规则路径（无 LLM）断言。
// 已知不匹配项（不在本段断言，见 task-6 用户裁决 fix wave）：
//   - "根据记忆栏的报告，给我分析建议"：app.js categoryForPrompt ↔ wantsRecommendationList
//     无限递归（RangeError）已修复，见下方正常分类断言。
//   - "总结记忆栏的数据，提出下个月的运营重点"：含"重点"→ zhIntent=recommendation 提前返回；
//     措辞已裁决改为"总结记忆栏的数据，分析下个月的运营方向"（实测首选"规划/方向"命中
//     merchant 路径，"分析"命中 analysis），见下方断言。
//   - "查一下 {最高 commission 商户} 这个月表现"：merchantForExample 已跳过 knownKeyword 商户，
//     但当前 offers 数据未携带 knownKeyword 字段（契约性防御），Amazon US 仍会渲染并命中
//     keyword；措辞模板对普通商户（如 Kewlioo.）可命中 merchant（下方断言）。
// 直接输入型 Report 示例（§4.5 二次迭代）：商户名/品类名/Tier 字面输入 + "实体名趋势分析"
assertEqual(hooks.detectQueryIntent("Shokz"), "merchant", "welcome merchant example (direct merchant name) should route to merchant lookup");
assertEqual(hooks.detectQueryIntent("Beauty 品类"), "category", "welcome category example (direct category name) should route to category");
assertEqual(hooks.detectQueryIntent("Tier 2"), "tier", "welcome Tier 2 example should route to tier");
const tierExampleAnswer = hooks.answerPrompt("Tier 2");
assertMatch(tierExampleAnswer, /Tier 2 概览/, "welcome Tier 2 example should produce a tier overview + candidate recommendation answer");
assertEqual(hooks.detectQueryIntent("Shokz趋势分析"), "analysis", "welcome trend-analysis example (merchant + 趋势分析) should route to the analysis/trend path");
assertEqual(hooks.detectQueryIntent("对比记忆栏里的两个商户，谁更值得重点投入"), "analysis", "welcome chat comparison example should route to analysis");
// 回归：categoryForPrompt ↔ wantsRecommendationList 无限递归（栈溢出）修复后，
// chat-1 示例（含"给我"+"分析建议"）应能正常分类到 analysis 路径而非 RangeError
assertEqual(hooks.detectQueryIntent("根据记忆栏的报告，给我分析建议"), "analysis", "chat-1 example should classify to analysis without the recursion RangeError (Fix A regression)");
// 用户裁决替代措辞（不含"重点/建议/推荐"触发词）：首选"规划下个月的运营方向"实测命中
// merchant 路径，微调为"分析"后命中 analysis（禁止改分类器，只调措辞）
assertEqual(hooks.detectQueryIntent("总结记忆栏的数据，分析下个月的运营方向"), "analysis", "welcome chat summary example should route to analysis after rewording (plan/direction hit merchant, 分析 hits analysis)");

console.log("Chatbot intent flow tests passed");
process.exit(0);
