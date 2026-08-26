import fs from "node:fs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const styles = fs.readFileSync("public/styles.css", "utf8");

assert(html.includes('id="dashboardSubnav"'), "Dashboard must expose a child navigation");
assert(!html.includes('class="panel source-panel"'), "Sidebar source status card should be removed");
for (const group of ["workspace", "merchants", "media", "products"]) {
  assert(html.includes(`data-nav-group="${group}"`), `Sidebar group ${group} is missing`);
}
assert(html.includes('id="chatbotNav"'), "Chatbot child navigation is missing");
assert(html.includes('id="agentNav"'), "Agent child navigation is missing");
assert(/<button class="page-nav-button active" id="agentNav"/.test(html), "Agent should be the active Dashboard child by default");
assert(!/<button class="page-nav-button active" id="chatbotNav"/.test(html), "Chatbot should not be the default Dashboard child");
assert(/<section class="topbar dashboard-page hidden">/.test(html), "Chatbot topbar should be hidden in the Agent default state");
assert(/<section class="main-grid dashboard-page hidden">/.test(html), "Chatbot workspace should be hidden in the Agent default state");
assert(/<section class="dashboard-agent-page" id="dashboardAgentPage"/.test(html), "Agent page should be visible in the default HTML state");
assert(html.includes('id="dashboardAgentPage"'), "Agent page shell is missing");
assert(html.includes('aria-label="Chat Agent"'), "Agent page accessible title should use Chat Agent");
assert(html.includes('>Chat Agent</h2>'), "Agent page title should use Chat Agent");
assert(html.includes('aria-label="Chat Agent chat"'), "Agent chat accessible title should use Chat Agent");
assert(!html.includes("Conversation Agent"), "Legacy Conversation Agent copy should be removed");
assert(html.includes('id="agentChatForm"'), "Agent page form is missing");
assert(app.includes('switchPage("agent")'), "Agent navigation must route to the Agent page");
assert(app.includes('state.page === "agent"'), "Agent page state must be handled");
assert(/page:\s*"agent"/.test(app), "Agent should be the default application page");
assert(
  html.includes('data-nav-group="workspace"')
    && html.includes('data-nav-group-toggle')
    && app.includes('toggleNavigationGroup(toggle)'),
  "Workspace navigation should use the shared accordion behavior"
);
assert(app.includes('navigationGroupForPage(page)'), "Page routing should resolve the active navigation group");
assert(app.includes("switchPage(state.page);"), "Initialization should synchronize the DOM with the default page state");
assert(app.includes("agentPage: {"), "Agent page needs isolated state");
assert(app.includes("handleAgentPageSubmit"), "Agent page submit handler is missing");
assert(styles.includes(".dashboard-agent-page"), "Agent page styles are missing");
assert(html.includes('class="agent-page-title-row"'), "Agent page title row is missing");
assert(html.includes('data-agent-surface="workspace"'), "Agent workspace marker is missing");
assert(styles.includes(".dashboard-agent-page .message.user .chat-stream-text"), "Agent user message contrast styles are missing");
assert(styles.includes(".dashboard-agent-page .chat-stream-text table"), "Agent response table styles are missing");
assert(styles.includes('html[lang="zh-Hans"] body.dashboard-mode .dashboard-agent-page .message.user::before'), "Agent Chinese message labels are missing");
assert(html.includes('class="agent-chat-context"'), "Agent chat context bar is missing");
assert(!html.includes('class="agent-input-meta"'), "Agent input should not show a secondary meta row");
assert(html.includes('class="agent-send-icon"'), "Agent send icon is missing");
assert(html.includes('class="agent-example-prompt"'), "Agent example prompt card is missing");
assert(html.includes("Tapo，ID398679，epc和conversion帮我查询下"), "Agent example prompt copy is missing");
assert(styles.includes(".dashboard-agent-page .agent-chat-context"), "Agent context bar styles are missing");
assert(!styles.includes(".dashboard-agent-page .agent-input-meta"), "Agent input meta styles should be removed with the meta row");
assert(styles.includes(".dashboard-agent-page .agent-send-icon"), "Agent send icon styles are missing");
assert(styles.includes(".dashboard-agent-page .agent-example-prompt"), "Agent example prompt styles are missing");
assert(app.includes("agent-chat-log-has-messages"), "Agent conversation state class is missing");
assert(app.includes("data-agent-example-prompt-key"), "Agent example prompt click target is missing");
assert(app.includes("agentChatInput.value = prompt"), "Agent example prompt should populate the composer");
assert(styles.includes(".agent-chat-log.agent-chat-log-has-messages .agent-page-welcome"), "Agent welcome state hide styles are missing");
assert(styles.includes(".agent-page-chat-panel .message.assistant"), "Agent assistant surface override is missing");
assert(styles.includes(".agent-page-chat-panel {\n    height: clamp(520px, calc(100dvh - 260px), 680px);"), "Agent mobile chat panel height constraint is missing");
assert(styles.includes("@media (prefers-reduced-motion: reduce)"), "Reduced-motion coverage is missing");
assert(styles.includes("@keyframes navGroupEnter"), "Navigation entry motion is missing");
assert(styles.includes("max-height: 520px"), "Accordion expansion transition is missing");

console.log("PASS: Dashboard Chatbot/Agent page contract");
