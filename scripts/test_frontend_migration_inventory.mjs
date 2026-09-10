import fs from "node:fs";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const inventoryPath = "docs/frontend-migration-inventory.md";
const markdown = fs.readFileSync(inventoryPath, "utf8");
const match = markdown.match(/<!-- FRONTEND_MIGRATION_INVENTORY_START -->\s*```json\s*([\s\S]*?)```\s*<!-- FRONTEND_MIGRATION_INVENTORY_END -->/);
assert(match, "迁移清单缺少受控 JSON 区块");
const inventory = JSON.parse(match[1]);
assert(Array.isArray(inventory.pages), "迁移清单必须包含 pages 数组");

const expectedPages = [
  "offer-list-tracker", "offer-performance", "payments", "publishers", "monthly-new-merchants",
  "brand-media", "revenue-flow", "google-ads", "sheets", "category", "tier",
  "dashboard", "agent"
].sort();
const actualPages = inventory.pages.map((page) => page.pageKey).sort();
assert(JSON.stringify(actualPages) === JSON.stringify(expectedPages), "迁移清单页面集合与 Modern Runtime 不一致");

for (const page of inventory.pages) {
  assert(page.status === "removed", `${page.pageKey} 必须标记为 removed，表示旧实现已删除`);
  assert(Array.isArray(page.legacyEntry) && page.legacyEntry.length === 0, `${page.pageKey}.legacyEntry 必须为空`);
  assert(Array.isArray(page.modernEntry) && page.modernEntry.length > 0, `${page.pageKey}.modernEntry 不能为空`);
  assert(Array.isArray(page.tests) && page.tests.length > 0, `${page.pageKey}.tests 不能为空`);
  for (const testPath of page.tests) assert(fs.existsSync(testPath), `${page.pageKey} 引用了不存在的测试: ${testPath}`);
}

const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
assert(ci.includes("node scripts/test_frontend_migration_inventory.mjs"), "CI 未运行迁移清单契约测试");
console.log(`PASS: frontend migration inventory covers ${inventory.pages.length} modern pages`);
