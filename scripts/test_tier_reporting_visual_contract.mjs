import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(path) {
  assert(fs.existsSync(path), `${path} 不存在`);
  return fs.readFileSync(path, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertRuleContains(css, selector, declaration, message) {
  const pattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^{}]*)\\}`, "m");
  const match = css.match(pattern);
  assert(match && match[1].includes(declaration), message);
}

const category = read("frontend/src/features/category-report/categoryReport.css");
const tier = read("frontend/src/features/tier-sheet/tierSheet.css");
const tierPage = read("frontend/src/features/tier-sheet/TierSheetPage.vue");

assert(category.includes(".category-page-modern .dashboard-category-report"), "Category report 缺少局部高级面板样式");
assert(category.includes(".category-page-modern .dashboard-category-report-table"), "Category report 表格缺少局部可读性样式");
assert(category.includes("font-variant-numeric: tabular-nums"), "Category report 数值缺少等宽数字排版");
assert(category.includes("cubic-bezier(0.32, 0.72, 0, 1)"), "Category report 交互缺少流畅缓动");
assert(!/^\\s*\\.dashboard-category-report\\s*\\{/m.test(category), "Category report 出现未局部化的面板选择器");
assertRuleContains(category, ".category-page-modern .dashboard-category-report-table > thead > tr > th", "position: sticky", "Category report 表格缺少粘性表头");
assert(category.includes("@media (prefers-reduced-motion: reduce)"), "Category report 缺少 reduced-motion 降级");
assert(category.includes("--category-muted: light-dark(#536a74, #a5b4c8)"), "Category report 小字号文本缺少深浅主题对比度颜色");
assert(!category.includes("#71828b"), "Category report 仍使用对比度不足的旧灰色");

assert(tier.includes(".tier-page-modern > .tier-category-summary"), "Tier category summary 缺少局部高级面板样式");
assert(tier.includes(".tier-page-modern .sheet-table"), "Tier Sheet Records 缺少局部表格可读性样式");
assert(tier.includes("position: sticky"), "Tier Sheet Records 缺少粘性表头或选择列");
assert(tier.includes(".tier-page-modern .sheet-table td"), "Tier Sheet Records 数据单元格缺少可读性样式");
assert(!/^\\s*\\.sheet-table\\s*\\{/m.test(tier), "Tier Sheet Records 出现未局部化的表格选择器");
assertRuleContains(tier, ".tier-page-modern > .tier-table-panel .sheet-table-wrap", "overflow-x: auto", "Tier Sheet Records 缺少横向滚动容器");
assertRuleContains(tier, ".tier-page-modern > .tier-table-panel.sheet-expanded-panel .sheet-table-wrap", "max-height: none", "Tier Sheet Records 展开模式被固定高度限制");
assertRuleContains(tier, ".tier-page-modern > .tier-table-panel.sheet-expanded-panel .sheet-table-wrap", "height: 100%", "Tier Sheet Records 展开模式缺少填充高度");
const stickySelectionRule = tier.match(/\.tier-page-modern \.sheet-table th\.tier-select-cell,\s*\.tier-page-modern \.sheet-table td\.tier-select-cell\s*\{([^{}]*)\}/m);
assert(stickySelectionRule && stickySelectionRule[1].includes("position: sticky"), "Tier Sheet Records 缺少粘性选择列样式");
assert(tier.includes(".tier-page-modern > .tier-table-panel .icon-button:focus-visible"), "Tier Sheet Records 操作按钮缺少焦点反馈");
assert(tier.includes("@media (max-width: 680px)"), "Tier 报表缺少 680px 移动端覆盖");
assert(tier.includes("@media (prefers-reduced-motion: reduce)"), "Tier 报表缺少 reduced-motion 降级");
assert(tier.includes("--tier-muted: light-dark(#536a74, #a5b4c8)"), "Tier 报表小字号文本缺少深浅主题对比度颜色");
assert(!tier.includes("#71828b"), "Tier 报表仍使用对比度不足的旧灰色");
assert(tierPage.includes("'is-selected': tier.selectedKeys.value.has(row.key)"), "Tier Sheet Records 缺少选中行视觉反馈钩子");

console.log("PASS: Tier reporting visual contract");
