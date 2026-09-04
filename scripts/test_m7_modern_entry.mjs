import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const removedFiles = [
  "public/app.js",
  "public/styles.css",
  "public/chatbot_i18n.js",
  "public/onboarding_tour.js",
  "public/chatbot_welcome.js",
  "public/tier2_recommendation_rules.js",
  "public/agent_memory_state.js",
  "frontend/src/legacy/bridge.ts",
  "frontend/src/legacy/contracts.ts"
];
for (const file of removedFiles) assert.equal(fs.existsSync(file), false, `${file} 必须删除`);

const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
const html = read("public/index.html");
const auth = read("public/auth.js");
const entry = read("frontend/src/entry.ts");
const runtime = read("frontend/src/runtime/modernApp.ts");
const contracts = read("frontend/src/runtime/contracts.ts");
const trend = read("frontend/src/features/agent/results/AgentTrendResult.vue");
const authCss = read("public/auth.css");

assert.match(html, /id="modernAppRoot"/, "M7 必须提供唯一应用根节点");
assert.match(html, /id="modernAppError"/, "M7 必须提供启动错误态");
assert.match(html, /auth\.css\?v=20260904-m7-final/, "M7 必须加载独立认证样式");
assert.doesNotMatch(html, /(?:styles\.css|app\.js|chatbot_i18n|onboarding_tour|chatbot_welcome|tier2_recommendation_rules|agent_memory_state)/, "入口不得加载已删除资源");
assert.match(auth, /await loadModernApp\(\)/, "认证成功后必须加载 Modern Runtime");
assert.match(auth, /mountApplication\(modernAppRoot, initialPage\)/, "认证成功后必须按用户等级挂载完整应用");
assert.match(auth, /if \(user\.level === 2\)/, "认证壳必须为 level 2 走最小数据启动");
assert.match(auth, /showModernError\(error\)/, "启动失败必须显示错误态");
assert.doesNotMatch(auth, /legacy|LEGACY|\?legacy=1/i, "auth.js 不得保留旧回滚路径");
assert.match(runtime, /getAppSnapshot/, "Modern Runtime 必须持有受控启动快照");
assert.match(contracts, /AppBootstrapData/, "Modern Runtime 必须使用现代启动契约");
assert.doesNotMatch(entry + runtime + contracts, /OI_LEGACY_BRIDGE|OFFER_INTELLIGENCE_TEST_HOOKS|legacy\/(?:bridge|contracts)/, "运行时代码不得引用旧全局或旧模块");
assert.match(trend, /<svg[^>]+class="agent-trend-chart"/, "Agent 趋势必须渲染本地 SVG");
assert.match(authCss, /\.auth-shell\s*\{/, "认证关键样式必须独立存在");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|vue|js)$/.test(entry.name) ? [target] : [];
  });
}
const runtimeSource = sourceFiles("frontend/src").concat(sourceFiles("public"))
  .map((file) => read(file)).join("\n");
assert.doesNotMatch(runtimeSource, /OI_LEGACY_BRIDGE|OFFER_INTELLIGENCE_TEST_HOOKS/, "应用运行时不得包含旧全局");
console.log("PASS: M7 legacy runtime removal contract");
