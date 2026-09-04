import fs from "node:fs";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const read = (file) => fs.readFileSync(file, "utf8");
const pages = [
  ["offer-list-tracker", '"offer-list-tracker": offerTrackerFactory'],
  ["payments", "payments: paymentsFactory"],
  ["publishers", "publishers: publishersFactory"],
  ["monthly-new-merchants", '"monthly-new-merchants": monthlyNewMerchantsFactory'],
  ["brand-media", '"brand-media": brandMediaFactory'],
  ["revenue-flow", '"revenue-flow": revenueFlowFactory'],
  ["google-ads", '"google-ads": googleAdsFactory'],
  ["sheets", "sheets: targetsFactory"],
  ["category", "category: categoryReportFactory"],
  ["tier", "tier: tierFactory"],
  ["dashboard", "dashboard: chatbotFactory"],
  ["agent", "agent: agentFactory"]
];
const entry = read("frontend/src/entry.ts");
const runtime = read("frontend/src/runtime/modernApp.ts");
const html = read("public/index.html");
const inventorySource = read("docs/frontend-migration-inventory.md");
const match = inventorySource.match(/<!-- FRONTEND_MIGRATION_INVENTORY_START -->\s*```json\s*([\s\S]*?)```\s*<!-- FRONTEND_MIGRATION_INVENTORY_END -->/);
assert(match, "迁移清单缺少受控 JSON 区块");
const inventory = JSON.parse(match[1]);
const pagesByKey = new Map(inventory.pages.map((page) => [page.pageKey, page]));

assert(html.includes('id="modernAppRoot"'), "index.html 缺少 modern root");
assert(!/id="[^"]+ModernRoot"/.test(html), "index.html 仍包含页面级迁移根节点");
for (const [key, registration] of pages) {
  assert(entry.includes(registration), `${key} 未注册 modern factory`);
  assert(pagesByKey.get(key)?.status === "removed", `${key} 清单未确认旧实现已移除`);
  assert(pagesByKey.get(key)?.legacyEntry?.length === 0, `${key} 仍记录旧入口`);
}
assert(/mountPageInternal\(\w+,\s*standalonePageHost\)/.test(runtime), "Modern Runtime 未实现页面切换");
assert(!/legacy|OI_LEGACY_BRIDGE/i.test(entry + runtime), "Modern 页面切换仍依赖旧运行时");
console.log("PASS: all application pages use the modern runtime");
