import fs from "node:fs";
import vm from "node:vm";

function loadWindowPayload(file, name) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, "utf8"), context);
  return context.window[name];
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const chatbotData = loadWindowPayload("protected_data/chatbot_data.js", "CHATBOT_DATA");
const sheetReportData = loadWindowPayload("protected_data/sheet_report_data.js", "SHEET_REPORT_DATA");

const categoryColumnByTier = {
  "Tier 1": 23,
  "Tier 2": 22,
  "Tier 3": 12,
  "Tier 4": 13
};

for (const [tier, expectedIndex] of Object.entries(categoryColumnByTier)) {
  const sheet = sheetReportData.sheets.find((entry) => entry.name === tier);
  if (!sheet) throw new Error(`${tier}: sheet report payload is missing the tier sheet`);
  assertEqual(sheet.headers.indexOf("Category") + 1, expectedIndex, `${tier} Category column`);
}

const tier1Sheet = sheetReportData.sheets.find((entry) => entry.name === "Tier 1");
const tier1DirectNetworkRows = tier1Sheet.rows.filter((row) => row.Agency === "Direct" && row.Network === "Direct");
assertEqual(tier1DirectNetworkRows.length, 0, "Tier 1 Direct-agency rows with Direct network");
const tier1DirectSample = tier1Sheet.rows.find((row) => row["Merchant ID"] === "362178" && row["Merchant Name"] === "Hcalory");
if (!tier1DirectSample) throw new Error("Tier 1 Hcalory sample row is missing");
assertEqual(tier1DirectSample.Agency, "Direct", "Tier 1 Hcalory Agency should remain Direct");
assertEqual(tier1DirectSample.Network, "Amazon", "Tier 1 Hcalory Network should be Amazon");

const expectedOfferCategories = [
  ["Tier 1", "362653", "Shokz Official", "Electronics"],
  ["Tier 2", "369227", "True Classic", "Clothing, Shoes & Jewelry"],
  ["Tier 3", "380681", "Lebanta Haircare", "Beauty & Personal Care"],
  ["Tier 4", "363153", "EGOHOME by MLILY", "Home & Kitchen"]
];

for (const [tier, merchantId, brand, category] of expectedOfferCategories) {
  const offer = chatbotData.offers.find((entry) => (
    entry.tier === tier && entry.merchantId === merchantId && entry.brand === brand
  ));
  if (!offer) throw new Error(`${tier} ${merchantId} ${brand}: offer is missing`);
  assertEqual(offer.sheetCategory, category, `${tier} ${brand} sheetCategory`);
  assertEqual(offer.category, category, `${tier} ${brand} category`);
  assertEqual(offer.mainCategory, category, `${tier} ${brand} mainCategory`);
  assertEqual(offer.categorySource, "Google Sheet", `${tier} ${brand} categorySource`);
}

console.log("Sheet category checks passed");
