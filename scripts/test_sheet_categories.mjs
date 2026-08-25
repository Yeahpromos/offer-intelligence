import fs from "node:fs";
import vm from "node:vm";

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// 从 db_offers_cache.json 加载数据（替代旧的静态 JS 文件）
const _cache = JSON.parse(fs.readFileSync("protected_data/db_offers_cache.json", "utf8"));
const chatbotData = _cache;
const sheetReportData = {
  sheets: _cache.sheets || [],
  tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
};

const tierNames = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"];
for (const tier of tierNames) {
  const sheet = sheetReportData.sheets.find((entry) => entry.name === tier);
  if (!sheet) throw new Error(`${tier}: sheet report payload is missing the tier sheet`);
  assertEqual(sheet.headers.includes("Category"), true, `${tier} should expose a Category column`);
  assertEqual(sheet.headers.includes("BD"), tier === "Tier 1", `${tier} BD column visibility`);
}

const tier1Sheet = sheetReportData.sheets.find((entry) => entry.name === "Tier 1");
const tier1DirectRows = tier1Sheet.rows.filter((row) => row.Network === "Direct");
assertEqual(tier1DirectRows.length, 0, "Tier 1 should have no Direct-network rows from DB");
const tier1Sample = tier1Sheet.rows.find((row) => row["Merchant ID"] === "362178" && row["Merchant Name"] === "Hcalory");
if (!tier1Sample) throw new Error("Tier 1 Hcalory sample row is missing");
assertEqual(typeof tier1Sample.Network, "string", "Tier 1 Hcalory should have a Network value");
assertEqual(tier1Sample.Network.length > 0, true, "Tier 1 Hcalory Network should not be empty");

// 验证各 tier 的 offer 存在且有分类数据
const tierMerchants = [
  ["Tier 1", "362653", "Shokz Official"],
  ["Tier 2", "369227", "True Classic"],
  ["Tier 3", "380681", "Lebanta Haircare"],
  ["Tier 4", "363153", "EGOHOME by MLILY"],
];
for (const [tier, merchantId, brand] of tierMerchants) {
  const offer = chatbotData.offers.find((entry) => (
    entry.tier === tier && entry.merchantId === merchantId && entry.brand === brand
  ));
  if (!offer) throw new Error(`${tier} ${merchantId} ${brand}: offer is missing in DB cache`);
  // 分类字段应存在且有值
  assertEqual(typeof offer.category, "string", `${tier} ${brand} category should be a string`);
  assertEqual(offer.category.length > 0, true, `${tier} ${brand} category should not be empty`);
}

// 验证每个 tier sheet 存在且有行
for (const tier of tierNames) {
  const sheet = sheetReportData.sheets.find((entry) => entry.name === tier);
  if (!sheet) throw new Error(`${tier}: sheet is missing in DB cache`);
  assertEqual(sheet.headers.length > 0, true, `${tier} should have headers`);
  assertEqual(sheet.rows.length > 0, true, `${tier} should have rows`);
}

console.log("Sheet category checks passed");
