# Chatbot 完整档案

> 更新日期：2026-09-04 · 分支：`FRONTEND-VUE-MIGRATION`

> **M7 当前实现说明：** 本文中带有 Legacy、`public/app.js`、旧辅助脚本或 `frontend/src/legacy/` 的章节是迁移历史与行为来源记录，不再代表当前文件路径。生产前端现由 `frontend/src/runtime/modernApp.ts`、`frontend/src/entry.ts`、`frontend/src/features/chatbot/` 与 `frontend/src/features/agent/` 承载；认证入口仅为 `public/auth.js`。旧运行时、旧页面 DOM 和运行时回退开关已删除，回滚使用上一份可部署构建。

## 1. 概述

> Agent 请求上限与工具批处理修复（2026-08-24）：规划请求继续使用 64KB；本地和 Vercel 综合流入口实际读取上限统一为 128KB。工具规划结果按每批最多 4 个执行，总预算 6 个；超过总预算时返回 partial、omittedTargets 等元数据，并在综合回答和执行时间线中明确提示结果不完整。

YeahPromos Offer Intelligence 内建了一个对话式 AI 助手，支持中英双语，覆盖商户查询、品类搜索、推荐排名、支付追踪、Tier 管理和数据分析。系统采用 **LLM 意图分类 + 规则引擎回答生成** 的混合架构，所有数据在页面加载时一次性载入前端内存，回答生成零网络延迟。

> Chat Mode Agent（工具调用）设计与实现见 `docs/superpowers/specs/2026-08-14-chat-mode-agent-design.md` 与 `docs/superpowers/plans/2026-08-14-chat-mode-agent.md`。

> Phase 2（2026-08-14）：Agent 工具扩展至 5 个 —— `merchant_comparison`/`tier_analysis`/`category_comparison`/`payment_status`/`trend`（多 Tier 对比未纳入）。

> Agent v1 稳定化（2026-08-17）：对比工具保留多实体差异，品类和付款工具拒绝不完整匹配，规划端限制为 7 个只读工具；自然语言综合失败时保留已完成工具数据。

> Agent 商户月度数据迁移（2026-08-17）：`merchant_analysis` 复用 Report Mode 的 `/api/ui/db/merchant` 月度接口，返回最近 12 个月真实 `monthly` 明细；数据库月度数据不可用时保留当前缓存汇总并返回空月度数组。

> Agent Tier 商家列表迁移（2026-08-17）：`tier_analysis` 保留 `analyzeTier()` 的概览，同时复用 Report Mode `tiers.length` 路径的 `offersInTier()` + `compareRecommendationOffers()` 排序，返回默认最多 100 个 `merchants` 行和 `merchantList` 分页元数据；较大的 Tier 通过 `offset/limit` 继续查询。

> Dashboard 子页面拆分（2026-08-17）：Dashboard 下提供独立的 `Chatbot` 和 `Agent` 子页面。`Chatbot` 保留原有 Report/Chat Mode 与 Deep Window 流程；`Agent` 使用独立聊天记录，只复用 `runChatAgent()` 的只读工具链。

> Agent 执行过程时间线（2026-08-17）：独立 Agent 页面以可折叠的执行摘要展示规划、工具查询、月度范围、结果整理和最终状态；不展示模型原始 Chain-of-Thought。执行中的请求支持通过 `AbortController` 停止，成功完成后时间线默认折叠，失败或停止时保持展开。

> Agent 结构化对话记忆（2026-08-26）：独立 Agent 页面使用版本化 `localStorage` 状态保存商户、品类、Tier、月份、指标名、最近工具和数据来源等安全摘要；刷新可恢复，新对话和登出会清除。原始问题、回答正文、指标数值、月度/付款明细、工具 JSON 和异常堆栈不写入记忆，也不新增数据库表或字段。

> Chat Mode 商户分析的当前相对比较口径单独记录在 [Chat Mode 商户分析相对比较规则](chatbot-analysis-comparison-rules.md)，包括比较范围、指标公式、百分位阈值和已知口径问题。
>
> Chat Mode 面对商户、品类、Tier、趋势和媒体等不同分析类型的内容与边界，见 [Chat Mode 不同分析类型说明](chat-mode-analysis-types.md)。

> M6/M7 当前 Runtime（2026-09-04）：Chatbot Report/Chat、Deep Window 与独立 Agent 由 Vue session/页面渲染；Agent 进入页面后按需加载 `@copilotkit/vue`，通过真实 `/api/copilotkit` Runtime 和同源 `/api/chat/agui` 使用 Python registry。Node Runtime 先验证 v2 `oi_session`，再通过 `no-store` 的同源 `/api/auth/session` 探测确认当前数据库用户；Python AG-UI 也重新查询 `cnpscy_oi_user` 执行 Agent 页面权限。level=2 不允许 Agent，内部 token 只用于 Python AG-UI 调用；Python 继续拥有 7 工具 registry、参数/结果白名单、plan proof、批次、replan 与 synthesis。M7 已删除旧运行时及 parity/legacy runtime 开关；CopilotKit 不可用时停留在 Vue 页面并使用受控 modern session。

### M6 CopilotKit Agent 迁移边界（历史记录，2026-09-03）

- Report Mode 通过 `applyPrompt()` 和 `loadLiveChatbotData()` 复用 merchant、ASIN、category、Tier、recommendation、payment、analysis/trend、keyword、publisher 和 publisher profile 路由；来源状态只暴露 `cache`、`db` 或不可用。
- Chat Mode 复用 Legacy 的 Report Memory、Memory recommendation、`/api/chat/stream` 逐 token/fallback/停止链路、反馈、问题日志、帮助、指南和 onboarding；成功回答才进入历史，停止/失败本轮不进入正式历史。
- Deep Window 通过受控操作保留 quick/deep、多窗口、拖动、置顶、最小化/恢复、关闭/取消、图表指标/分类/列控制、clone、overlay、导出和加入对话；完成的 Legacy panel 不因 Modern 页面卸载而误删。
- Agent 的 Modern 页面由 CopilotKit `useAgent` 管理运行与停止；不可用或显式回退时才复用 Legacy Agent session。Python AG-UI adapter 发出标准 run/text/tool/state/custom 事件，客户端仅执行 Python 已签名的调用。受限 Memory event 和结果组件投影可按需渲染，plan proof、密钥和原始 provider payload 不进入 Vue。
- CopilotKit bundle 与主 `oi-modern.js` 分离，仅在显式启用 Agent Modern 对照且 Runtime 可用时使用；CopilotKit 默认 Sidebar 与全局样式不作为页面 UI。真实登录数据、视觉几何与生产网络验收由用户完成。

### 2026-09-03 Agent 回答行为与趋势组件兼容

#### Agent 工作台、命令与回测

- 新工作台继续挂在 `agentModernRoot`，外部 `primarySidebar` 导航不替换；桌面保留右侧查询详情，窄屏可展开。输入栏在浏览旧内容且没有草稿时收起，点击恢复，尊重 reduced-motion。
- `/` 菜单复用 `ChatbotCommandMenu.vue`，Agent 提供 14 个可筛选的命令，支持方向键、Enter、Escape 和中文输入法。商户/品类/Tier/对比/付款/趋势命令补充原有 Agent 查询；`/publisher`、`/publisherprofile` 使用现有媒体数据和 Report renderer，等待数据完成后通过 `ChatbotResultView` 显示，不向 Python 注册虚构工具。
- CopilotKit 页通过 `createAgentActivity()` 保留原问题日志及反馈机制。原 SVG 趋势图、12 指标切换、结果 registry、停止及成功后历史/记忆规则保持。
- 用户可从“日志 → 对话日志与回测”或错误后的日志面板下载/导入 JSON、主动上传、选择某一轮重新运行并对照原回答。最近最多 10 轮、512 KB；记录问题、原历史与结构化记忆、回答、受控错误码和时间线，不导出 HTML、cookie、plan proof 或原始工具载荷。回测使用原语言/历史/记忆和**当前数据/模型**，不是旧数据快照重放，也不会自动修改代码。
- 本地和 Vercel 共用 `agent_debug_http.py`，在 `/api/chat/stream?operation=agent_debug` 提供认证后的 POST 写入与 GET `id` 读取；不新增 Vercel function。上传显式写入 `cnpscy_oi_agent_debug_cases`，首写按现有 DB 模式建表；无 DDL 权限时可预先使用 `docs/agent-debug-cases.sql`。存储不可用返回 502，前端保留下载入口。未向真实 DB 写入测试日志。
- 验证包括 `AgentPage.test.ts`、`agentDiagnostics.test.ts`、`scripts/test_agent_debug_http.py` 和完整外壳的固定数据浏览器预览。真实登录、LLM/SSE、数据库上传仍需部署环境验收。

- CopilotKit 保留数据查询的 AG-UI transport；`createCopilotAgentSession()` 复用 Legacy 分流规则，原本跳过规划的问题继续走 `/api/chat/stream`，沿用直接回答提示词、历史和 Memory。无工具/规划不可用通过 `oi.planning_fallback` 交给同一来源校验与回退规则处理，不直接把规划文本当作数据事实。
- 每次运行单独保留本地工具结果，复用月度、Tier 商户和付款明细补齐函数；综合失败仍返回工具结果。停止和 plan proof 校验失败不会作为成功回答提交。工具结果、图表和回答只保存在当前会话内存，不写入结构化 Memory。
- `AgentTrendResult.vue` 调用现有 `renderAgentTrendChartHtml()`，保留 SVG、数据来源标识、月份与指标切换；指标/表格/状态/摘要组件继续由本地 registry 渲染。表格保留空列位置并支持最多 100 行，已完成的结果组件绑定到对应回答，追问后仍可查看和切换图表。
- 验证入口：`scripts/test_chat_agent.mjs`、`scripts/test_agent_agui.py`、`CopilotKitAgentRuntime.test.ts`、`AgentTrendResult.test.ts`、`AgentPage.test.ts`。浏览器使用本地固定数据验证交互；生产登录、真实 LLM 和 Vercel SSE 仍需部署后验收。

### 2026-09-03 Chatbot Legacy-first 对齐落地（历史记录）

- 默认入口继续由 `public/app.js:switchPage()` 使用 Legacy；Modern Chatbot/Agent 只在 `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ = true` 且对应 bridge/Runtime 可用时作为逐页对照页挂载。
- `frontend/src/legacy/contracts.ts` 与 `frontend/src/legacy/bridge.ts` 现在保留回答 ID、回答 HTML、Deep Window 关联、反馈状态、工具面板状态、补充异步内容和 Deep Window skeleton/capability 字段；bridge 仍只投影页面安全字段。
- Vue Chatbot 已补齐原版交互表面：Deep Window loading/content/error 生命周期、多窗口操作、拖拽至 Memory、逐答案 View/反馈、帮助/指南/Logs/Clear/onboarding、slash intent 菜单、Context 指标/分类交互和异步 DB 补充结果。
- 原始 `contentHtml`、下载标记、趋势/列控件和数据来源继续通过 Legacy HTML 与受控事件渲染；Vue 层不重新计算 Legacy 报告公式，也不把模型文本当作数据事实。
- 自动化证据入口为 `scripts/test_chatbot_legacy_first_parity_gap.mjs`、`frontend/src/features/chatbot/*test.ts` 和 `frontend/src/legacy/bridge.test.ts`；组件与静态契约不能替代真实登录、视觉几何、SSE 网络和最终浏览器验收。

---

## 2. 完整请求流程

> 本节描述 Report Mode 的意图分类和结构化回答主流程。Chat Mode 进入 `runChatAgent()` 后，先对问题做轻量分流：方法论、能力说明和闲聊追问直接调用 `/api/chat/stream`，不规划取数；需要具体数据的问题才调用 `/api/chat/agent` 规划工具，在浏览器执行工具，再调用 `/api/chat/stream` 综合。若具体数据问题没有工具结果、结构化上下文或用户提供的数据，即使规划返回文本或规划服务失败，也只返回缺少可验证数据来源的提示，不把模型文本当作事实；已有工具失败/未找到结果仍可用于说明，规划不可用的非数据问题继续沿用原有回退路径。

```
用户输入
    │
    ▼
┌─ Step 0: 快速跳过检查 ──────────────────────────────────────────┐
│  canSkipLLMClassify() — ASIN/商户ID/简单Tier名可跳过LLM          │
│  跳过条件满足 → state.llmClassifyResult = null，走全正则路径      │
└──────────────────────┬───────────────────────────────────────┘
                       │ (未跳过)
                       ▼
┌─ Step 1: 意图分类（LLM优先，正则兜底）──────────────────────────┐
│  POST /api/chat/classify  (20s 超时，有缓存)                    │
│  → server.py handle_llm_classify()                              │
│    → llm_classify.classify_intent(prompt, categories)            │
│      → llm_provider.call_llm() → DeepSeek / Claude              │
│      → skills/ 注册表组装system prompt                          │
│      → 返回 { intent, params }                                  │
│  LLM失败 → 返回 null → 前端降级到 detectQueryIntent() 正则匹配   │
│  相同prompt有内存缓存，不重复调用                                  │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌─ Step 2: 路由与回答生成（纯前端，毫秒级）────────────────────────┐
│  applyPrompt() → answerPrompt(prompt)                            │
│    1. tierOfferPlan → recommendationBundleAnswer()               │
│    2. 排除/替换 → recommendationBundleExclusion/Replacement      │
│    3. detectQueryIntent() 确定意图 (LLM结果优先 → 正则兜底)       │
│    4. 按意图路由:                                                │
│       - asin          → asinAnswer()                             │
│       - merchant      → merchantOverview() / merchantOverviewHtml│
│       - payment       → paymentAnswer()                          │
│       - recommendation→ 排序/过滤/推荐流程                        │
│       - category      → categoryAnswer()                         │
│       - tier          → tierAnswer()                             │
│       - analysis      → analysisAnswer()                         │
│    5. contextFollowup → 追问处理（EPC/AOV/订单快速问答）          │
│  数据来源：window.CHATBOT_DATA.offers[]                          │
│  全部在浏览器内存中计算                                           │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌─ Step 3: 侧载补充（异步，不阻塞主回答）──────────────────────────┐
│  dbMerchantOfferForPrompt() → 精确匹配到商户ID                    │
│    → GET /api/ui/db/merchant?merchantId=xxx                      │
│    → loadDbMerchantInsight() 追加产品明细卡片                     │
│  未匹配:                                                         │
│    → GET /api/ui/db/search?q=xxx                                 │
│    → loadDbSearchInsight() 追加DB搜索结果                         │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌─ Step 4: 分析文字（仅 analysis 意图）────────────────────────────┐
│  analysisAnswer() → 同步渲染表格HTML                             │
│  → setTimeout → fetchAnalysisText(summary, language)              │
│    → POST /api/chat/analyze                                      │
│      → llm_classify.generate_analysis_text()                      │
│        → AnalysisTextSkill.generate()                             │
│        → call_llm() → DeepSeek / Claude                          │
│  LLM失败 → fallbackAnalysisText() 模板降级文字                    │
└───────────────────────────────────────────────────────────────────┘
```

### 2.1 Chat Mode Agent 的实体与过滤失败关闭

独立 Agent 的商户分析、商户对比、商户趋势和付款商户过滤共用 `public/app.js` 的 `agentResolveMerchant()`。解析顺序是商户 ID、标准化完整名称、唯一名称子串；输入同时含 ID 和名称时以 ID 为准。解析结果使用以下状态：

| 状态 | Agent 行为 |
|------|------------|
| `resolved` | 唯一命中，继续执行工具 |
| `ambiguous` | 停止当前工具，返回最多 5 个候选的商户 ID、名称、Tier 和品类，请用户选择 |
| `not_found` | 停止当前工具，明确提示未找到商户 |
| `invalid_filter` | 停止当前工具，返回非法字段、原始值和允许值 |

付款工具会校验状态、月份和 Tier；趋势工具会校验 `months`（2–24 的整数）、`metric`（`TREND_METRIC_DEFS` 中的指标）和显式 `entityType`。非法过滤不会被忽略、默认化或转成全量查询。对应回归覆盖在 `scripts/test_chat_agent.mjs`。

---

## 3. 技术栈

| 层级 | 技术 | 文件 |
|------|------|------|
| 前端 | Vanilla JS IIFE（无框架），~8,900 行 | `public/app.js` |
| 国际化 | `CHATBOT_I18N` 全局对象，中英双语 | `public/chatbot_i18n.js` |
| LLM Provider | DeepSeek Chat / Claude，统一 OpenAI 兼容接口 | `llm_provider.py` |
| LLM 编排 | 意图分类 + 分析文字生成 | `llm_classify.py` |
| 技能注册 | 8 个 IntentSkill + 1 个 AnalysisSkill | `skills/*.py` |
| 后端 | Python `http.server`（本地） / Vercel Serverless（生产） | `server.py`, `api/chat/*.py` |
| 数据构建 | Ruby 脚本聚合多数据源 | `scripts/build_offer_chatbot_data.rb` |
| DB | MySQL 只读，动态列映射 | `offer_db.py` |
| 样式 | 纯 CSS 变量系统 | `public/styles.css` |

---

## 4. 意图分类体系

### 4.1 七种意图

| 意图 | 触发场景 | 示例 | Skill 文件 |
|------|---------|------|-----------|
| `asin` | 10 位 ASIN（B 开头） | `B0D2HKCMBP` | `skills/asin.py` |
| `merchant` | 商户名/ID 查询，默认兜底 | `Shokz`、`362653` | `skills/merchant.py` |
| `payment` | 付款状态/周期/佣金 | `四月未付款有哪些` | `skills/payment.py` |
| `recommendation` | 推荐排名/筛选/排序 | `Tier 1 推荐 5 个 aov 高的` | `skills/recommendation.py` |
| `tier` | 查看某个 Tier（无推荐/分析词） | `Tier 2` | `skills/tier.py` |
| `category` | 品类查询 | `Electronics`、`美妆` | `skills/category.py` |
| `analysis` | 数据分析/诊断/升降级 | `分析 Shokz`、`哪些Tier2要升Tier1` | `skills/analysis.py` |

### 4.2 LLM 分类参数提取

LLM 不仅返回意图标签，还提取结构化参数，前端在回答生成时使用：

- **实体识别**: `asin`, `merchantName`, `merchantId`, `category`, `tier`
- **过滤条件**: `metricFilters`（AOV/EPC/CVR…）、`paymentCycleFilter`、`paymentStatus`, `month`
- **排序**: `metricSort`（按指标升/降序）
- **数量**: `count`, `tierOfferPlan`（多 Tier 各 N 个）
- **分析类型**: `analysisType`（merchant/category/tier）、`analysisTarget`
- **推荐配置**: `includeTier4`, `includeBlack`

### 4.3 分类模式

| 模式 | 配置 | 说明 |
|------|------|------|
| 单次调用（默认） | `OI_LLM_TWO_STAGE` 未设置 | 一个 prompt 包含所有 skill 定义 → 一次 LLM 返回 intent+params |
| 两阶段 | `OI_LLM_TWO_STAGE=1` | Stage1: 轻量路由 prompt 仅选 intent → Stage2: 用匹配 skill 的 prompt 提取 params |
| 全正则（降级） | `OI_LLM_ENABLED=0` 或 API 不可用 | 跳过 `/api/chat/classify`，全部走 `detectQueryIntent()` + `chatbot_i18n.detectIntent()` |

### 4.4 Skills 架构

```
skills/
├── __init__.py        ← 自动注册所有 skill 到 SkillRegistry 单例
├── base.py            ← IntentSkill / AnalysisSkill 抽象基类 + SkillRegistry
├── asin.py            ← AsinSkill
├── merchant.py        ← MerchantSkill
├── payment.py         ← PaymentSkill
├── recommendation.py  ← RecommendationSkill
├── tier.py            ← TierSkill
├── category.py        ← CategorySkill
├── analysis.py        ← AnalysisIntentSkill  (意图分类)
└── analysis_text.py   ← AnalysisTextSkill   (文字生成)
```

每个 IntentSkill 自描述：
- `intent` → 规范意图名
- `prompt_intent_section()` → 注入 system prompt 的意图定义
- `param_schema()` → `{参数名: ParamDef(type, required, enum, nested_schema, description)}` 驱动验证
- `examples()` → Few-shot 示例
- `fallback_keywords()` → 前端正则兜底关键词

---

## 5. 完整数据流

### 5.1 数据构建（离线）

```
CSV/JSON 数据源
    │
    ▼
scripts/build_offer_chatbot_data.rb
    ├── brand_epc_by_tier.csv         ← 商户指标表
    ├── tier_1_2_3_backend_epc.csv    ← 后端 EPC 数据
    ├── levanta_unpaid_invoice_items_*.csv  ← 未付款记录
    ├── levanta_brand_categories_api.csv    ← Levanta 品类
    ├── backend_epc_sheet_blocks/     ← Google Sheet 区块
    ├── levanta_invoice_items_*.json  ← 发票详情
    ├── feishu_merchant_categories.csv ← 飞书品类
    └── product_name_keywords_t1_t3.csv ← 产品关键词
    │
    ▼
protected_data/chatbot_data.js  (~4MB)
    window.CHATBOT_DATA = {
      summary: { offerCount, tiers, networks, categories, paymentSummary, ... },
      sources: { tiers, backendEpc, payments, ... },
      offers: [ { id, tier, merchantId, brand, network, region, category,
                  clicks, orders, salesAmount, epc, aov, conversionRate,
                  paymentCycle, paymentRisk, paymentStatus, topAsins,
                  productKeywords, ... }, ... ],
      paymentRecords: [ { id, merchantId, merchantName, reportMonth,
                          revenueMade, commissionMade, paymentStatus,
                          paymentCycle, expectedPaymentDate, ... }, ... ]
    }
```

### 5.2 运行时加载顺序

```
index.html
  ├── <script> chatbot_i18n.js      ← window.CHATBOT_I18N
  ├── <script> tier2_recommendation_rules.js
  ├── <script> page_access.js       ← 注册统一 0/1/2 页面权限矩阵
  ├── <script> auth.js              ← 检查 session，保存非敏感 user，获取 window.__OI_LLM_ENABLED
  │     └── 登录成功后动态加载:
  │         ├── db_offers_cache.json ← /api/ui/db/offers → window.CHATBOT_DATA + SHEET_REPORT_DATA
  │         ├── db_keywords_cache.json ← /api/ui/db/keywords → window.PRODUCT_KEYWORDS
  │         └── app.js              ← 初始化，绑定事件
  └── GSAP CDN (async)
```

### 5.3 Report Memory 推荐与 View 导出数据流

Report Mode 的下载项在加入记忆栏时会被固定为独立的报告导出快照。Chat Mode 的推荐只从这个快照中选择商户，View 和 Excel 下载继续消费同一个推荐结果快照，数据流如下：

```text
Report Mode download item
  -> _extractPanelMemory()
  -> reportMemory.reportSnapshot
  -> buildMemoryRecommendationResult()
  -> selectedMerchantIds + filteredSheets
  -> Chat View
  -> registerReportRecommendationDownload()
  -> createRecommendationWorkbook()
```

Chat Mode 的自然语言回复仍通过现有 `/api/chat/stream` 生成；View 中的导出列表来自前端保存的报告快照和本次推荐结果快照，不会从自由文本中解析商户名，也不会为了下载重新计算推荐。

导出与候选范围规则如下：

- 一次推荐只允许使用一个记忆中的 Tier 报告；明确指定 Tier 时只匹配该 Tier 的记忆报告。支持 Tier 1、Tier 2、Tier 3、Tier 4 和 BLACK TIER，不跨 Tier 或跨报告合并候选。
- 推荐数量按唯一 Merchant ID 计数；同一 Merchant ID 在原始报告中的所有相关行仍保留在 `selectedRows` 和过滤后的工作表中，重复源行不会被压缩掉。
- 请求数量大于实际匹配数时返回实际数量并标记 partial；没有匹配时返回 empty；有多个记忆报告无法唯一确定时返回 ambiguous；没有可用快照时返回 unavailable。后三种状态不注册下载按钮。
- 下载是 View-only：Chat 回复下方不直接放 Excel 按钮，只有进入报告 View 后才由 `renderMemoryRecommendationDownloadCard()` 注册并展示下载项。
- 过滤后的工作簿保留原报告的标签页顺序、字段、列顺序和加入记忆时的列显示状态；Category Summary 按过滤后的主工作表重建，固定说明类标签页保持原样。

---

## 6. 前端代码结构 (app.js)

### 6.1 聊天核心行号索引

| Lines | Section | 关键函数 |
|-------|---------|---------|
| 3286–3320 | LLM 分类调用 | `classifyWithLLM()` — POST /api/chat/classify，20s 超时，内存缓存 |
| 3322–3377 | 分析计算 | `findOfferByMerchantName()`, `offersInCategory()`, `offersInTier()`, `globalAverages()` |
| 3378–3463 | 商户分析 | `analyzeMerchant()` — 指标、百分位排名、对比、强弱项、同行、支付风险 |
| 3465–3500+ | 品类分析 | `analyzeCategory()` — 聚合统计、Tier 分布、Top/Bottom 排名 |
| 3500+–3600+ | Tier 分析 | `analyzeTier()` — 层级概览、跨 Tier 对比、三段分化、异常值；Agent 另由 `offersInTier()` 返回排序后的分页商家行 |
| 3600+–3863 | 分析渲染 | `renderAnalysisTable()`, `fetchAnalysisText()`, `fallbackAnalysisText()` |
| 3864–3963 | 分析入口 | `analysisAnswer()` — 同步渲染表格 + 异步加载 LLM 文字 |
| 3965–3991 | 意图检测 | `detectQueryIntent()` — LLM 优先 → 正则兜底 |
| 3993–4041 | 推荐算法 | `recommendationScore()` — 综合评分公式 |
| 4043–4100+ | 排序比较 | `compareRecommendationOffers()` |
| 4100+–4385 | 聊天渲染 | `renderRecommendationStats()`, `renderMerchantStats()`, `renderASINStats()`, `renderPaymentStats()`, `renderCategoryStats()`, `renderKeywordStats()`, `renderContextPanel()` |
| 4386–4700 | 消息构建 | `fieldRows()`, `merchantOverviewHtml()`, `resultTable()`, `keywordSearchAnswer()`, `recommendationBundleAnswer()` 等 |
| 4701–5480 | DB 查询 + Dashboard | `dbMerchantProductRows()`, `dbMerchantInsightHtml()`, `dbLookupSkipPrompt()`, `dbSearchQueryForPrompt()`, `renderDashboardCategoryReport()` 等 |
| 9441–9899 | 路由分发 | `answerPrompt()` — 按意图路由的主分发函数 |
| 9902–10000+ | 消息渲染 | `addMessage()` — 将 HTML 追加到聊天日志 |
| 11166–11400+ | 入口 | `applyPrompt()` — 主入口：LLM 分类 → answerPrompt → DB 补充 |

记忆推荐与 View 导出函数（以当前 `public/app.js` 为准）：

| 函数 | 行号 | 用途 |
|------|------|------|
| `_extractPanelMemory()` | 10954 | 从 Report Mode 面板提取文本、HTML 和下载项，并写入 `reportSnapshot` |
| `buildReportExportSnapshot()` | 12521 | 深拷贝原始下载项的行、工作表、列定义，并生成唯一 Merchant ID 的排序代表行 |
| `filterReportWorkbookSnapshot()` | 12662 | 按选中的 Merchant ID 过滤原工作簿；保留重复行、重建 Category Summary |
| `buildMemoryRecommendationResult()` | 12757 | 限定单个记忆 Tier，按指标/品类排序，返回 `selectedMerchantIds`、`selectedRows` 和 `filteredSheets` |
| `registerReportRecommendationDownload()` | 12925 | 将 View 推荐结果注册为独立的多工作表下载项 |
| `renderMemoryRecommendationDownloadCard()` | 12937 | ready 结果渲染 View-only 下载卡片；empty、ambiguous、unavailable 显示原因说明 |
| `createRecommendationWorkbook()` | 13335 | 使用已注册的过滤快照生成 XLSX 工作簿 |

### 6.2 answerPrompt() 路由优先级

1. `tierOfferPlan` → `recommendationBundleAnswer()`
2. 推荐包排除/替换 → `recommendationBundleExclusionAnswer()` / `recommendationBundleReplacementAnswer()`
3. `intent === "asin"` → `asinAnswer()`
4. 精确 merchant ID → `merchantOverview()`
5. 付款周期过滤 → `paymentCycleOfferAnswer()`
6. 追问（contextFollowup） → 快速 EPC/AOV/订单回答
7. `intent === "analysis"` → `analysisAnswer()`
8. 关键词搜索意图 → `keywordSearchAnswer()`
9. top metric 请求 → `topMetricOfferAnswer()`
10. `intent === "payment"` → `paymentAnswer()`
11. `intent === "recommendation"` → 排序/过滤/排名路径
12. `intent === "category"` → 品类路径
13. `intent === "tier"` → Tier 查看路径
14. 默认 → 商户名模糊搜索

---

## 7. 国际化 (chatbot_i18n.js)

### 7.1 全局对象

`window.CHATBOT_I18N` 暴露以下方法：

| 方法 | 用途 |
|------|------|
| `hasChinese(value)` | 检测是否包含中文字符 |
| `responseLanguage(prompt, currentLanguage)` | 根据 prompt 和当前语言决定回答语言 |
| `detectIntent(prompt)` | 前端正则意图检测（LLM 降级兜底） |
| `tierFromPrompt(prompt)` | 从文本提取 Tier（中英文） |
| `monthNameFromText(prompt)` | 中英文月份名 → 英文月份名 |
| `categoryForPrompt(prompt, knownCategories)` | 从文本提取品类（中英文别名） |
| `requestedRecommendationCount(prompt, fallback, max)` | 提取推荐数量 |
| `copy(language)` | 获取当前语言的 UI 文案 |
| `format(template, values)` | `{key}` 模板替换 |
| `label(text, language)` | 中文标签映射 |

### 7.2 翻译覆盖

- **UI 文案** (COPY): 推荐预览、支付概览、未找到、下载 Excel 等 30+ 条
- **字段标签** (LABELS_ZH): Merchant→商家, EPC→EPC, Payment cycle→付款周期 等 30+ 条
- **品类别名** (CATEGORY_ALIASES_ZH/EN): 美妆→beauty, skincare→beauty 等 10 个大类
- **月份映射** (MONTHS_ZH/EN): 四月→April, jan→January 等

---

## 8. 后端代码结构

### 8.1 llm_provider.py — Provider 抽象层

```
_provider()        → 读取 OI_LLM_PROVIDER (deepseek/claude)
_model_name()      → 读取对应模型名
_api_key()         → 读取对应 API Key
_default_timeout() → OI_LLM_TIMEOUT (默认 15s)
stream_timeout()   -> OI_LLM_STREAM_TIMEOUT (default 50s, max 50s)
call_llm()         → 统一调用入口 (OpenAI 兼容 / Anthropic SDK)
call_llm_tools()   → Agent 规划调用，归一化 DeepSeek/Claude 工具结果
```

`chat_agent_http.py` 负责 Agent 规划端点的请求大小、消息角色、工具名称和双语提示词校验；工具执行仍在浏览器 `public/app.js` 中完成。

`merchant_analysis` 的 `metrics` 是当前缓存商户汇总，`monthly` 是按最新月份在前排列的真实 DB 月度数据。月度数据由 `fetchMerchantMonthlyRows()` → `fetchMerchantMetrics()` → `/api/ui/db/merchant?months=12&minimal=1` 获取，并使用 `mergeMonthIntoOffer()` 保持与 Report Mode 月份概览相同的 EPC、AOV、CVR、Commission、Orders、Clicks、DPV 和 ATC 口径；月度接口不可用时 `monthly=[]`、`monthlyDataSource="unavailable"`，不伪造月度值。综合模型若只引用最新月份，`runChatAgent()` 会从已完成的工具结果中补回完整月度表。

`tier_analysis` 的 `merchantCount` 是整个 Tier 的商户总数；`merchants` 是按 Report Mode Tier 查询顺序返回的当前页，`merchantList` 的 `hasMore` 表示是否还有后续页。Agent 综合不能把有 `hasMore` 的当前页表述为完整 Tier 列表；Report Mode 仍保留完整 Deep Window/Excel 行快照。

### 8.2 llm_classify.py — 编排层

| 函数 | 用途 |
|------|------|
| `classify_intent(prompt, categories, timeout)` | **主入口**: 意图分类 + 参数提取 |
| `generate_analysis_text(summary, language, timeout)` | **分析入口**: 结构化摘要 → 自然语言 |
| `_build_system_prompt(categories)` | 组装单次调用 system prompt |
| `_build_router_prompt()` | 组装两阶段 Stage1 路由 prompt |
| `_build_skill_prompt(skill, categories)` | 组装两阶段 Stage2 参数提取 prompt |
| `_parse_response(text)` | 解析 LLM 返回的 JSON（含 schema 验证） |
| `_validate_param_value(key, value, param_def)` | 按 ParamDef 递归验证参数 |

### 8.3 server.py — 路由处理

Agent 规划请求继续使用 64KB 请求体上限；综合请求由本地和 Vercel 两个流入口显式传入共享的 128KB 读取上限。浏览器端 `runChatAgent()` 保留完整规划结果，按每批最多 4 个工具调用执行，达到总预算 6 个后将剩余目标标记为 `partial`，并通过 `omittedTargets` 暴露给综合模型和用户。具体数据问题只有在工具结果、结构化上下文或用户提供数值至少有一项可验证时才允许无工具直答；没有来源时返回补充商户、时间范围和指标的提示。商户和过滤条件在工具执行前按 `ambiguous`、`not_found`、`invalid_filter` 失败关闭，不会把歧义解析成第一项或把非法过滤扩大成全量查询。

Agent 规划入口使用 `v2` 请求协议，服务端从 `agent_tool_registry.py` 读取 `agent-tools-v1` 注册表定义；浏览器只发送 `question`、`language`、`enabledTools` 和受控 Trace。综合入口使用 `v2` 结构化请求，服务端验证 `agentRunId`、`planProofs`、`context` 和 `toolResults` 后才组装 Provider 消息。客户端提交 `messages`、工具 Schema、未知结果字段或篡改参数时拒绝请求；普通 Chat Mode 仍使用 `prompt/history`。

| 路由 | 方法 | Handler | 说明 |
|------|------|---------|------|
| `/api/chat/classify` | POST | `handle_llm_classify()` | body ≤2KB，调用 `classify_intent()` |
| `/api/chat/analyze` | POST | `handle_llm_analyze()` | body ≤8KB，调用 `generate_analysis_text()` |
| `/api/chat/agent` | POST | `handle_agent_request()` | v2 规划请求；服务端注册表、参数校验和 HMAC 计划证明 |
| `/api/chat/agui` | POST | `handle_agui_request()` | 仅 Runtime 内部 token；AG-UI 规划、工具 continuation 与 proof-bound synthesis |
| `/api/chat/stream` | POST | `handle_chat_stream()` | 普通 Chat 使用 `prompt/history`；Agent 综合使用 v2 结构化结果 |
| `/api/copilotkit/*` | GET/POST | Node `CopilotRuntime` | `oi_session` 鉴权；默认 Agent 连接 Python AG-UI，不接收 LLM 密钥 |

### 8.4 api/chat/ — Vercel Serverless

```
api/chat/actions.py   -> class handler: trusted route header -> classify/analyze/agent/agui
api/chat/stream.py    -> class handler: SSE stream (50s graceful deadline)
api/copilotkit/[...path].js -> Node CopilotKit multi-route handler
```

`api/chat/actions.py` 的 Agent 路由与本地 `/api/chat/agent` 共同调用 `chat_agent_http.handle_agent_request()`；两个综合入口共同调用 `agent_contract.validate_synthesis_request()`、`validate_bound_tool_results()` 和 `build_synthesis_messages()`。`llm_provider.stream_chat(messages=...)` 的 `messages` 参数仅接收服务端已经组装的内部消息。

---

## 9. 环境变量一览

### LLM 配置

| 环境变量 | 用途 | 默认值 |
|------|------|------|
| `OI_LLM_PROVIDER` | LLM 提供商 | `deepseek` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | — |
| `ANTHROPIC_API_KEY` | Claude API Key | — |
| `OI_LLM_MODEL_DEEPSEEK` | DeepSeek 模型 | `deepseek-chat` |
| `OI_LLM_MODEL_CLAUDE` | Claude 模型 | `claude-haiku-3-5-latest` |
| `OI_LLM_TIMEOUT` | API 超时（秒） | `15` |
| `OI_LLM_STREAM_TIMEOUT` | SSE streaming timeout in seconds (bounded to 5-50) | `50` |
| `OI_LLM_TWO_STAGE` | 启用两阶段分类 | 关闭 |

### 功能开关

| 环境变量 | 用途 |
|------|------|
| `OI_LLM_ENABLED` | `0` → 禁用 LLM，全正则 |
| `OI_AUTH_ENABLED` | `0` → 仅隔离本地开发跳过登录；生产环境必须启用 |
| `OI_AGENT_RUNTIME_MODE` | `copilotkit`（默认）；当前构建不提供 Legacy 回退 |
| `OI_COPILOT_INTERNAL_TOKEN` | Node Runtime 调用 Python AG-UI 的专用 token；未设置时沿用 `OI_SESSION_SECRET` |
| `OI_AGENT_AGUI_URL` | 可选的 Python AG-UI 内部 URL；默认同部署 `/api/chat/agui` |
| `OI_SESSION_SECRET` | Session Cookie 签名密钥 |
| `OFFER_DB_HOST` / `OFFER_DB_NAME` / `OFFER_DB_USER` / `OFFER_DB_PASSWORD` | `cnpscy_oi_user` 认证查询和 Offer DB 查询所需的数据库连接 |

认证说明：`cnpscy_oi_user` 是身份、独立 `password_hash`、`is_active` 和 `level` 的唯一来源；Session v2 只保存 `v`、`sub`、`exp`、`iat`，不保存密码哈希，也不使用 `role=admin` 授权。认证依赖缺失或不可用返回 503，未登录返回 401，已登录但无权访问 Agent 返回 403。`OI_AUTH_ENABLED=0` 仅限隔离本地开发。

---

## 10. 用户界面

### 10.1 HTML 结构 (index.html)

```
.app-shell
├── aside.sidebar (导航)
│   ├── .language-toggle (中英切换按钮)
│   └── nav.page-nav (Dashboard/Payments/Reports/Tier 1-4/Black Tier)
└── main.workspace
    └── section.main-grid.dashboard-page
        ├── section.insight-panel (右侧上下文面板)
        │   ├── #contextTitle / #contextSubtitle
        │   └── #recommendationBox (context panel 内容)
        └── section.chat-panel (左侧聊天区域)
            ├── #chatLog (消息列表)
            └── form#chatForm (输入框 + 发送按钮)
```

### 10.2 上下文面板

根据当前对话上下文展示不同类型的内容：

| 上下文类型 | 渲染函数 | 内容 |
|------|------|------|
| `merchant` | `renderMerchantStats()` | 商户统计卡片 + 指标详情 |
| `asin` | `renderASINStats()` | ASIN 所属商户 + 产品明细 |
| `payment` | `renderPaymentStats()` | 付款摘要 + 记录列表 |
| `category` | `renderCategoryStats()` | 品类聚合统计 |
| `keyword` | `renderKeywordStats()` | 关键词搜索结果汇总 |
| `tier` | `renderRecommendationStats()` | Tier 概览 + 优先候选 |
| `recommendation` | `renderRecommendationStats()` | 推荐包摘要 + Top 列表 |
| `default` | `renderRecommendationStats()` | 全局过滤视图 |

### 10.3 CSS 聊天样式 (styles.css)

| 行号范围 | 内容 |
|------|------|
| 629–709 | `.chat-input` 输入框样式 |
| 729–789 | `.chat-input button` 发送按钮 |
| 873–894 | `.chat-panel`, `.chat-log` 聊天区域 |
| 959–1021 | `.db-chat-card` DB 查询结果卡片 |
| 1065–1123 | `.analysis-section`, `.analysis-table`, `.analysis-narrative` 分析表格 |

---

## 11. 数据构建脚本

### 11.1 build_offer_chatbot_data.rb

**输入**（9 个数据源）:
1. `outputs/brand_epc_by_tier.csv` — 商户 EPC 指标
2. `outputs/tier_1_2_3_backend_epc.csv` — 后端 EPC
3. `outputs/levanta_unpaid_invoice_items_*.csv` — 未付款
4. `work/levanta_brand_categories_api.csv` — Levanta 品类
5. `work/backend_epc_sheet_blocks/` — Google Sheet 区块
6. `outputs/levanta_invoice_items_*.json` — 发票
7. `work/feishu_merchant_categories.csv` — 飞书品类
8. `data/product_name_keywords_t1_t3.csv` — 产品关键词
9. 各 Tier Sheet TSV 文件

**输出**: `protected_data/db_offers_cache.json` → `/api/ui/db/offers` → `window.CHATBOT_DATA`

**核心逻辑**:
- 品类优先级链: Google Sheet → mainCategory → Feishu main → Feishu sub → Levanta → "Uncategorized"
- 支付状态计算: 基于实际收入/佣金、付款周期、当前日期
- 数据压缩: `compact_hash()` 移除 null/空/false 值减小文件体积

### 11.2 自动化更新

`.github/workflows/sync-levanta-payments.yml` 每日 02:00 UTC:
1. 同步 Levanta 付款数据
2. 刷新 DB 缓存（`offer_db.py` 自动处理，或由 `refresh-db-caches` workflow 触发）
3. Auto-commit 回 repo

---

## 12. 测试文件

### 12.1 Chatbot 专项测试

| 文件 | 内容 |
|------|------|
| `scripts/test_chatbot_intent_flow.mjs` | 意图分类流测试（VM 沙箱执行 app.js） |
| `scripts/test_zh_chatbot.mjs` | 中文 chatbot 测试：语言检测、意图识别、月份映射、品类匹配 |

### 12.2 CI 中相关测试

`.github/workflows/ci.yml`:
```bash
node --check public/chatbot_i18n.js
node --check public/app.js
node scripts/test_chatbot_intent_flow.mjs
node scripts/test_zh_chatbot.mjs
node scripts/test_chat_agent.mjs
node scripts/test_agent_trace.mjs
node scripts/test_agent_memory_state.mjs
python -m py_compile llm_classify.py
python -m py_compile api/chat/actions.py
python -m py_compile api/chat/stream.py
```

---

## 13. 完整文件清单

### 前端（8 个文件）

```
public/
├── index.html                ← 聊天 UI 布局
├── app.js                    ← 主应用 (~8,900 行)：意图路由、回答生成、分析引擎
├── auth.js                   ← Session 管理、LLM 开关 (window.__OI_LLM_ENABLED)
├── chatbot_i18n.js           ← 中英双语：翻译、别名、正则意图检测
├── tier2_recommendation_rules.js ← Tier 2 推荐规则
├── agent_memory_state.js     ← Agent 结构化记忆状态、过期和安全文本投影
├── styles.css                ← 聊天样式 + 分析表格样式
└── protected_data/
    ├── db_offers_cache.json   ← 主数据缓存 (offers + sheets + paymentRecords)
    ├── db_keywords_cache.json  ← 产品关键词缓存
```

### 后端 Python（14 个文件）

```
llm_provider.py               ← LLM Provider 抽象（DeepSeek/Claude）
chat_agent_http.py            ← Chat Mode Agent 规划端点、工具白名单和双语提示词
agent_tool_registry.py        ← 七个 Agent 工具的唯一注册表、参数和结果白名单
agent_contract.py             ← Agent v2 请求校验、计划证明和服务端消息组装
llm_classify.py               ← 意图分类 + 分析文字生成编排层
server.py                     ← 本地服务器（/api/chat/* 路由）
auth.py                       ← 认证 + llmEnabled 状态
api/chat/
|-- actions.py                -> /api/chat/classify + /api/chat/analyze + /api/chat/agent + /api/chat/agui
`-- stream.py                 -> /api/chat/stream Vercel SSE handler
api/copilotkit/[...path].js   -> /api/copilotkit authenticated Node Runtime
skills/
├── __init__.py               ← Skill 自动注册
├── base.py                   ← IntentSkill / AnalysisSkill 基类 + SkillRegistry
├── asin.py                   ← ASIN 意图技能
├── merchant.py               ← 商户意图技能
├── payment.py                ← 支付意图技能
├── recommendation.py         ← 推荐意图技能
├── tier.py                   ← Tier 意图技能
├── category.py               ← 品类意图技能
├── analysis.py               ← 分析意图分类技能
└── analysis_text.py          ← 分析文字生成技能
```

### 数据构建（2 个文件）

```
scripts/build_offer_chatbot_data.rb   ← Ruby 主构建脚本 (~740 行)
scripts/build_db_static_snapshot.py   ← Python DB 快照（含 --chatbot-output）
```

### 测试（Agent 相关）

```
scripts/test_chatbot_intent_flow.mjs  ← 意图流测试
scripts/test_zh_chatbot.mjs           ← 中文 chatbot 测试
scripts/test_chat_agent.mjs           ← Agent 工具、规划、综合和降级测试
scripts/test_agent_http.py            ← Agent 请求校验与规划端点测试
scripts/test_agent_tool_registry.py    ← 服务端工具注册表、参数和结果白名单测试
scripts/test_agent_contract.py         ← v2 协议、HMAC 证明和消息组装测试
scripts/test_agent_planning_contract.py ← 本地/Vercel 规划入口同构测试
scripts/test_agent_synthesis_contract.py ← 本地/Vercel 综合入口边界测试
scripts/test_llm_agent.py              ← Provider 工具调用与消息透传测试
```

### 文档（4 个目录）

```
docs/chatbot-feature-report.md              ← Chatbot 功能报告
specs/001-llm-intent-classifier/            ← LLM 意图分类器 Spec
specs/002-chatbot-data-analysis/            ← Chatbot 数据分析 Spec
CLAUDE.md                                   ← app.js 聊天相关行号索引
```

### CI/CD（2 个文件）

```
.github/workflows/ci.yml                    ← CI 测试 chatbot 文件
.github/workflows/sync-levanta-payments.yml ← 每日同步付款到 cnpscy_oi_payment_records
```

---

## 14. app.js 聊天函数速查表

| 函数 | 行号 | 用途 |
|------|------|------|
| `classifyWithLLM()` | 3286 | POST /api/chat/classify |
| `findOfferByMerchantName()` | 3324 | 商户名 → offer 对象 |
| `offersInCategory()` | 3345 | 品类 → offer 列表 |
| `offersInTier()` | 3354 | Tier → offer 列表 |
| `globalAverages()` | 3359 | 全站指标均值 |
| `analyzeMerchant()` | 3374 | 商户分析摘要 |
| `analyzeCategory()` | 3465 | 品类分析摘要 |
| `analyzeTier()` | ~3500 | Tier 分析摘要 |
| `renderAnalysisTable()` | ~3600 | 分析表格 HTML |
| `fetchAnalysisText()` | ~3700 | POST /api/chat/analyze |
| `fallbackAnalysisText()` | ~3750 | 模板降级文字 |
| `analysisAnswer()` | 3864 | 分析入口 |
| `detectQueryIntent()` | 3965 | 意图检测（LLM → 正则） |
| `recommendationScore()` | 3993 | 推荐评分 |
| `compareRecommendationOffers()` | 4043 | 推荐排序 |
| `setContext()` | ~4100 | 设置上下文 |
| `renderRecommendationStats()` | ~4100 | 推荐统计渲染 |
| `renderMerchantStats()` | ~4200 | 商户统计渲染 |
| `renderContextPanel()` | 4405 | 上下文面板路由 |
| `merchantOverviewHtml()` | 4469 | 商户概览卡片 |
| `resultTable()` | 4485 | 通用结果表格 |
| `answerPrompt()` | 9441 | 主路由分发 |
| `addMessage()` | 9902 | 追加消息到聊天 |
| `applyPrompt()` | 11166 | 聊天主入口 |
| `_extractPanelMemory()` | 10954 | Report 面板 → 记忆报告快照 |
| `buildReportExportSnapshot()` | 12521 | 保存可复用的报告导出快照 |
| `filterReportWorkbookSnapshot()` | 12663 | 按 Merchant ID 过滤原报告工作簿 |
| `buildMemoryRecommendationResult()` | 12758 | 从单个记忆 Tier 生成结构化推荐结果 |
| `registerReportRecommendationDownload()` | 12926 | 注册 View 专属过滤下载项 |
| `renderMemoryRecommendationDownloadCard()` | 12938 | 渲染 View-only 下载卡片 |
| `createRecommendationWorkbook()` | 13336 | 生成推荐 XLSX |

---

## 15. 已知限制与后续方向

### 当前限制
- **趋势依赖 DB 月度数据**: 趋势分析需要数据库中至少 2 个月的月度时间序列；无 DB 时自动降级为基于汇总历史的估算（结果标记为估算）
- **LLM 依赖网络**: 文字分析需要 API 调用，超时 15s
- **数据有缓存 TTL**: `db_offers_cache.json` 使用 24h TTL + stale-while-revalidate
- **多轮记忆有限**: Report Mode 每次提问独立处理（支持对上一商户的基础追问，不跨会话持久）；独立 Agent 目前只持久化安全的结构化焦点，不恢复完整消息，也不支持会话列表、跨设备同步或分享

### 已实现（历史限制已落地）
- **时间序列趋势分析** — 支持 merchant / category / tier 三类实体的月度趋势、环比变化、指定指标与时间范围（如"近 3 个月"、"这个季度"）。对应 `renderTrendLoadingPlaceholder` 的三条取数路径（商户走 `fetchMerchantMetrics`，品类/Tier 走 `fetchAggregatedMonthlyMetrics` 聚合，无 DB 时 `estimateAggregatedTrend` 估算降级）+ 左栏趋势图表。
- **SVG 图表** — 趋势图（`trendTrendChartSvg`）、DB 状态趋势图、目标趋势图等均为内联 SVG，不依赖图表库。
- **支付维度分析** — 支付查询 / 状态 / 逾期 / 付款周期筛选（`paymentAnswer` 系列）。

### 建议后续方向
1. **自动洞察** — 定时推送异常检测报告（高价值商户流失预警、品类异动）
2. **更精细的趋势** — 日粒度趋势、同比对比、更长的历史窗口
3. **多轮对话记忆增强** — 跨提问持久上下文

## 16. 新手流程引导（Flow Onboarding）

主路径：**Report Mode 提问 → 报告浮窗点「加入对话」→ 自动切到 Chat Mode → 直接对话**。

- 报告生成完成后，Deep Window 头部出现「加入对话」按钮：点击后报告自动加入记忆栏、自动切换到 Chat Mode，并在聊天区顶部注入引导消息（含 2 个示例 chips）。同一报告重复点击会变为「已加入」并禁用。
- 欢迎屏（`chatbot_welcome.js`）维护流程状态机 `noReport → reportReady → memoryReady → chatActive`，以 3 步进度条展示「① 在 Report 提问 → ② 点「加入对话」→ ③ 在 Chat 对话」，并在关键时刻就地提示：报告完成提示点「加入对话」；最小化后提示切 Chat Mode 拖入记忆栏；Chat Mode 空记忆时提醒卡片提供「去生成报告」按钮。
- 首次新手引导（`onboarding_tour.js`）为 5 步：布局介绍 → Report 提问 → 等待报告 → 点「加入对话」→ Chat 提问。最小化 + 拖拽保留为高级用法（见 Chat Mode 使用说明）。

## 17. 提问日志与导出
- 本地可在 `.env` 中设置 `OI_CHATBOT_QUESTION_LOGGING=0`（也支持 `false`、`no`、`off`）关闭提问日志的 MySQL 写入；未设置时默认开启。关闭开关只影响提问日志 POST，回答流程继续执行，已有日志仍可只读导出。

- `applyPrompt()` 与独立 Agent 页的 `handleAgentPageSubmit()` 在用户提交时异步调用现有 `POST /api/chat/stream?operation=questions` 创建日志，回答结束后再异步更新为 `success` 或 `failed`；日志失败不阻断原有问答。Agent 的中止也会完成为 `failed`。
- 日志只保存提问及分析字段，不保存助手回答。字段包括匿名浏览器会话 ID、`report` / `chat` / `agent` 模式、语言、意图、状态与时间戳。
- MySQL 表为 `cnpscy_oi_chatbot_question_logs`，定义位于 `chatbot_question_logs.py`，建表入口位于 `scripts/ensure_oi_schema.py`。
- Chatbot 模式栏右侧的低调「日志 / Logs」菜单可通过带会话认证的 `GET /api/chat/stream?operation=questions&format=csv|jsonl` 导出全部记录，Agent 记录通过 `mode=agent` 区分。
- 不新增独立 API 端点：本地 `server.py` 与 Vercel 现有 `api/chat/stream.py` 根据 `operation=questions` 分流，共享日志 HTTP 处理位于 `chatbot_question_log_http.py`。

### Agent Trace 与运行指标（2026-08-26）

Agent 的一次提问沿用提问日志生成的 `questionEventId`，浏览器再创建 `runId`，通过现有 `POST /api/chat/stream?operation=agent_trace` 异步写入 `cnpscy_oi_agent_runs` 与 `cnpscy_oi_agent_steps`。Trace 不新增 Vercel 路由；本地 `server.py` 和 `api/chat/stream.py` 共享同一 operation、认证和白名单校验。

`runChatAgent()` 将 planning、tool、synthesis 三阶段写成摘要步骤。规划记录请求字节数、Provider、模型、usage 和受控错误码；工具记录名称、耗时、成功/失败、`dataSource`、`dataAsOf`、`estimated` 与内存中的重试次数；综合记录请求字节数、Provider、模型、真实 usage 或 `outputChunks`。Trace run 另外汇总 partial、fallback、停止原因和工具计数。

Provider usage 通过综合 SSE 的独立 `type=usage` 事件在 `[DONE]` 前发送。usage 不可用时，输入/输出/总 token 保持 NULL，`usageAvailable=false`，前端显示“响应片段数 / response chunks”，不会把 SSE 片段数称作 token。工具月度 DB 结果使用 `database` 或 `mixed`，缓存汇总使用 `cache`，无法确认时使用 `unknown`；没有快照时间时保持 NULL。

Trace 写入是异步、短超时和可丢弃的：网络或数据库写入失败只记录 `console.warn`，不阻断回答、问题日志或 fallback。Trace 白名单拒绝保存 `prompt`、`messages`、工具 `arguments`、`toolResult`、回答正文、原始 Provider JSON 和异常堆栈。用户中止记录为 `stopped/stopped_by_user`，Provider 超时和工具失败分别保留 `timeout` 或 `failed` 及受控错误码。

本次实现覆盖 Agent Trace 与运行指标路线（路线图 4.1）以及服务端工具注册表路线（路线图 4.2）；统一回合生命周期和主动式能力等后续路线不视为已完成。

### Agent 服务端工具注册表与 v2 协议（2026-08-27）

4.2 已完成。`agent_tool_registry.py` 是七个只读工具的唯一规范来源：`merchant_analysis`、`category_analysis`、`merchant_comparison`、`tier_analysis`、`category_comparison`、`payment_status` 和 `trend`。注册表同时维护双语描述、参数 Schema、参数范围、结果字段白名单、结果来源和大小限制；浏览器只能提交 `enabledTools` 名称集合，不能提交工具描述或 Schema。

规划请求 `POST /api/chat/agent` 使用 `contractVersion: "v2"`，只接收问题、语言、启用工具集合和受控 Trace 元数据。服务端返回规范化的 `agentRunId`、`r{round}c{index}` 调用 ID、`registryVersion: "agent-tools-v1"` 和一次性使用的 `planProof`。工具失败时，最多进行一轮结构化重规划；重规划只提交前一轮证明、失败调用 ID 和固定错误码，不传递浏览器原始错误文本或自由消息。

综合请求 `POST /api/chat/stream` 的 Agent 分支只接收 `question`、`language`、`context`、`toolResults`、`agentRunId`、`planProofs` 和受控 Trace。`context.history` 仅允许 `user`/`assistant`，服务端将其标记为不可信上下文；`toolResults` 必须通过调用 ID、工具名和参数哈希与 HMAC 计划证明绑定后，才由 `agent_contract.py` 组装 Provider 消息。本地 `server.py` 和 Vercel `api/chat/stream.py` 复用相同校验函数，普通 Chat Mode 的 `prompt/history` 请求仍走原路径。

计划证明使用 `OI_SESSION_SECRET` 的独立 HMAC purpose，有效期 600 秒，绑定运行 ID、问题哈希、注册表版本、调用 ID、工具名和参数哈希。固定错误码包括 `agent_contract_version_required`、`unsupported_tool`、`invalid_arguments`、`invalid_tool_result`、`run_binding_failed`、`agent_planning_unavailable` 和 `agent_synthesis_unavailable`。客户端提交旧 `messages`、未知字段、篡改参数或过期证明时不会进入 Provider。

边界必须明确：当前七个工具仍由浏览器执行，HMAC 只能证明运行和调用元数据未被替换，不能证明浏览器返回的数据值真实；数据值真实性需要未来的服务端工具执行方案。该实现不新增数据库表、字段或 Trace 持久化内容，也不把问题、完整消息、工具参数、工具结果、答案正文或异常堆栈写入 Trace。

### Agent 结构化对话记忆（2026-08-26）

独立 Agent 页的 `state.agentPage.memory` 由 `public/agent_memory_state.js` 管理，存储键为 `oi_agent_memory_v1`。状态包括以下安全字段：

- 当前焦点：商户 ID/标准名称、品类和 Tier；
- 查询范围：起止月份、月份数量和指标名称；
- 最近工具：工具名、受控摘要、数据来源、快照时间、是否估算和是否部分执行；
- 候选实体：`pending`、`confirmed`、`rejected`。

`runChatAgent()` 只从工具结果生成白名单事件。同一轮多个成功工具结果会合并到同一个状态；下一轮成功工具结果会替换上一轮的焦点，候选确认会转移到 `confirmed` 并将未选候选转为 `rejected`。工具结果中的数值、月度行、付款行、原始参数、原始问题、回答正文、Provider JSON 和异常堆栈不会进入事件或 `localStorage`。

状态为版本 1，默认有效期 7 天，并有字段、实体和序列化长度上限。读取到版本不匹配、过期、未来时间戳、超长或损坏数据时会清除并回到空状态；浏览器存储异常只会降级，不阻断回答。恢复的状态被投影成中英双语的受控上下文文本，仅用于消解指代和延续查询范围，当前数值仍必须重新调用数据工具。

Agent 欢迎区会提示“已恢复上下文”；点击“新对话”或退出登录时同时清除页面内存和 `localStorage`。这一阶段没有新增数据库字段、数据库表、后端 API 或 Trace 内容，Report Mode 的报告记忆快照也不受影响。

对应回归测试为 `scripts/test_agent_memory_state.mjs` 和 `scripts/test_chat_agent.mjs`，并已加入 `.github/workflows/ci.yml`。

### 17.1 不满意反馈

- 每条成功回答仅提供一个低调的“不满意”按钮；Chat Mode 位于该回答底部，Report Mode 位于对应 Deep Window 底部。成功提交后按钮变为“已反馈”并禁用。
- 反馈必须单选一个原因（回答不准确、没有回答问题、数据不完整、内容难以理解、其他），补充说明可选。提交失败时保留表单并允许重试。
- Chat Mode 保存该次回答的原始 Markdown；Report Mode 在点击按钮时保存对应报告窗口当前可见文本。回答上限为 256 KB UTF-8，超出时安全截断并记录 `answerTruncated`。
- 反馈表为 `cnpscy_oi_chatbot_answer_feedback`，通过 `questionEventId` 与提问日志一对一关联，并区分 `report` / `chat` / `agent` 模式；独立 Agent 的成功直答、流式综合和 fallback 回答都复用同一反馈入口。
- 不满意反馈使用现有 `POST /api/chat/stream?operation=feedback` 写入；「日志 / Logs」菜单内与提问记录分组展示，分别通过 `GET /api/chat/stream?operation=feedback&format=csv|jsonl` 独立导出。
- 共享领域与 HTTP 处理分别位于 `chatbot_answer_feedback.py`、`chatbot_answer_feedback_http.py`；没有新增 Vercel 路由文件。
- 两张表的 `mode` 字段本身是 `VARCHAR(16)`，因此本次只扩展业务值，不新增表或执行 schema 迁移。
