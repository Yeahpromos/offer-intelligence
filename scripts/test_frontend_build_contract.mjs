import fs from "node:fs";
import vm from "node:vm";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const read = (file) => {
  assert(fs.existsSync(file), `${file} 不存在`);
  return fs.readFileSync(file, "utf8");
};

const packageJson = JSON.parse(read("frontend/package.json"));
for (const script of ["typecheck", "test", "build"]) {
  assert(typeof packageJson.scripts?.[script] === "string", `frontend/package.json 缺少 ${script} script`);
}
assert(packageJson.dependencies?.vue, "frontend/package.json 缺少 vue");
assert(packageJson.dependencies?.["@copilotkit/vue"], "frontend/package.json 缺少 @copilotkit/vue");

const viteConfig = read("frontend/vite.config.ts");
assert(viteConfig.includes("../public/assets/modern"), "Vite 输出目录必须是 public/assets/modern");
assert(viteConfig.includes('fileName: () => "oi-modern.js"'), "modern JS 文件名必须固定");
assert(viteConfig.includes('cssFileName: "oi-modern"'), "modern CSS 文件名必须固定");

for (const file of [
  "frontend/src/runtime/contracts.ts",
  "frontend/src/runtime/modernApp.ts",
  "frontend/src/entry.ts",
  "frontend/src/shell/AppShell.vue",
  "frontend/src/features/chatbot/chatbotSession.ts",
  "frontend/src/features/agent/agentSession.ts",
  "frontend/src/features/agent/CopilotKitAgentHost.vue",
  "frontend/src/shared/export/xlsx.ts",
  "frontend/src/shared/export/xlsx.test.ts"
]) read(file);

for (const removed of [
  "frontend/src/legacy/bridge.ts",
  "frontend/src/legacy/contracts.ts",
  "public/app.js",
  "public/styles.css"
]) assert(!fs.existsSync(removed), `${removed} 必须在 M7 中删除`);

const indexHtml = read("public/index.html");
assert(indexHtml.includes("./assets/modern/oi-modern.css?v=20260904-m7-final"), "index.html 缺少 modern CSS");
assert(indexHtml.includes('id="modernAppRoot"'), "index.html 缺少唯一 modern 根节点");
assert(indexHtml.indexOf("./page_access.js") < indexHtml.indexOf("./auth.js"), "page_access.js 必须在 auth.js 之前加载");
assert(!/styles\.css|app\.js|ModernRoot/.test(indexHtml.replace(/modernAppRoot/g, "")), "index.html 仍引用旧页面资源或旧页面根节点");

const auth = read("public/auth.js");
assert(auth.includes("async function loadModernApp()"), "auth.js 缺少 modern 加载边界");
assert(auth.includes("window.OI_MODERN_APP.bootstrap("), "auth.js 未调用 modern bootstrap");
assert(auth.includes("mountApplication(modernAppRoot, initialPage)"), "auth.js 未按用户等级挂载 modern 应用");
assert(auth.includes("if (user.level === 2)"), "auth.js 缺少 level 2 的最小数据启动分支");
assert(!/LegacyRollback|LEGACY_|legacyRollback|\.\/app\.js|\.\/styles\.css/.test(auth), "auth.js 仍包含旧运行时回滚路径");

const vercel = JSON.parse(read("vercel.json"));
assert(vercel.installCommand === "npm ci && npm --prefix frontend ci", "Vercel installCommand 不正确");
assert(vercel.buildCommand === "npm --prefix frontend run build", "Vercel buildCommand 不正确");
assert(vercel.outputDirectory === "public", "Vercel outputDirectory 必须保持 public");

const ci = read(".github/workflows/ci.yml");
for (const command of [
  "npm --prefix frontend run typecheck",
  "npm --prefix frontend run test -- --run",
  "npm --prefix frontend run build",
  "node scripts/test_m7_modern_entry.mjs"
]) assert(ci.includes(command), `CI 缺少命令: ${command}`);

const bundlePath = "public/assets/modern/oi-modern.js";
const cssPath = "public/assets/modern/oi-modern.css";
assert(fs.existsSync(bundlePath), `${bundlePath} 未生成`);
assert(fs.existsSync(cssPath), `${cssPath} 未生成`);
const sandbox = { console, window: {} };
vm.runInNewContext(fs.readFileSync(bundlePath, "utf8"), sandbox, { filename: bundlePath });
const modernApp = sandbox.window.OI_MODERN_APP;
assert(modernApp && typeof modernApp.bootstrap === "function", "modern bundle 未注册 OI_MODERN_APP");
for (const page of ["agent", "dashboard", "offer-list-tracker", "payments", "publishers", "monthly-new-merchants", "brand-media", "revenue-flow", "google-ads", "sheets", "category", "tier"]) {
  assert(modernApp.hasPage(page), `modern bundle 未注册 ${page}`);
}

console.log("PASS: frontend build contract");
