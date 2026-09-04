import fs from "node:fs";
import assert from "node:assert/strict";

const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
const html = read("public/index.html");
const entry = read("frontend/src/entry.ts");
const runtime = read("frontend/src/runtime/modernApp.ts");
const agentHost = read("frontend/src/features/agent/CopilotKitAgentHost.vue");
const chatbotStyles = read("frontend/src/features/chatbot/chatbot.css");

assert.match(html, /id="modernAppRoot"/, "index.html 必须提供唯一 modern root");
assert.doesNotMatch(html, /id="(?:chatbotModernRoot|agentModernRoot)"/, "index.html 不得保留页面级旧根节点");
assert.match(entry, /createChatbotSession/, "entry.ts 必须创建 Chatbot session");
assert.match(entry, /createAgentSession/, "entry.ts 必须创建 Agent session");
assert.match(entry, /dashboard:\s*chatbotFactory/, "entry.ts 必须注册 dashboard factory");
assert.match(entry, /agent:\s*agentFactory/, "entry.ts 必须注册 agent factory");
assert.match(runtime, /mountApplication\(element, initialPage = "agent"\)/, "Modern Runtime 必须支持完整应用挂载");
assert.match(runtime, /mountPageInternal\(\w+,\s*standalonePageHost\)/, "Shell 导航必须切换 standalone 页面");
assert.match(agentHost, /toolExecutor/, "CopilotKit 前端工具必须注入独立执行器");
assert.doesNotMatch(entry + runtime + agentHost, /OI_LEGACY_BRIDGE/, "运行时不得引用旧 bridge");
assert.match(chatbotStyles, /@media\s*\(max-width:\s*1120px\)/, "Chatbot 必须保留单栏断点");
console.log("PASS: M6 modern mount contract");
