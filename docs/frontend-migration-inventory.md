# 前端框架迁移页面清单

> 盘点日期：2026-08-27  
> 最近更新：2026-09-04（M07 已完成：12 个页面只使用 standalone Vue Runtime；旧页面 DOM、`public/app.js`、`public/styles.css`、辅助脚本和 `frontend/src/legacy/` 已删除。Agent 默认通过 CopilotKit Runtime/AG-UI 接入 Python registry/proof。运行时 legacy 开关已移除，回滚单位改为上一份可部署构建。）
> 权威路由入口：`ModernAppApi.setPage(page)`
> 状态枚举：`legacy`、`dual`、`modern`、`removed`

## 使用规则

- 下方受控 JSON 区块是页面迁移状态的机器可读权威来源；说明文字用于补充跨页面依赖。
- `legacy` 表示完全由原生 JS 渲染；`dual` 表示新旧两套实现可切换；`modern` 表示默认使用 Vue 但旧代码仍在回滚窗口；`removed` 表示对应旧实现和桥接已删除。
- 状态变化必须附带目标测试、相关旧回归、构建、差异检查和浏览器验收证据。
- `tests` 只记录当前确实存在的测试。没有页面级覆盖时使用空数组，并在 `testGap` 中明确记录缺口。
- `apis`、`storage`、`exports` 或 `overlays` 可以为空数组，表示当前页面没有该类专属依赖，不表示跨页面启动链不存在。

## 机器可读清单

<!-- FRONTEND_MIGRATION_INVENTORY_START -->
```json
{
  "schemaVersion": 1,
  "pages": [
    {
      "pageKey": "agent",
      "label": "Chat Agent",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/runtime/modernApp.ts",
        "frontend/src/features/agent/CopilotKitAgentHost.vue",
        "frontend/src/features/agent/CopilotKitAgentRuntime.vue",
        "frontend/src/features/agent/AgentPage.vue",
        "frontend/src/features/agent/AgentTimeline.vue",
        "frontend/src/features/agent/agentSession.ts",
        "frontend/src/features/agent/agentViewState.ts",
        "frontend/src/features/agent/agentModel.ts",
        "copilotkit_runtime.mjs",
        "agent_agui.py"
      ],
      "state": [
        "state.page",
        "state.agentPage",
        "state.language",
        "state.agentEnabled"
      ],
      "apis": [
        "/api/copilotkit",
        "/api/chat/agui",
        "/api/chat/agent",
        "/api/chat/stream",
        "/api/chat/stream?operation=agent_trace",
        "/api/chat/stream?operation=questions",
        "/api/chat/stream?operation=feedback"
      ],
      "storage": [
        "oi_agent_memory_v1",
        "oiChatbotQuestionSessionId.v1",
        "offerLanguage"
      ],
      "exports": [
        "question log download",
        "answer feedback download",
        "agent trace download"
      ],
      "overlays": [
        "agent execution timeline",
        "#answerFeedbackDialog"
      ],
      "tests": [
        "frontend/src/features/agent/agentModel.test.ts",
        "frontend/src/features/agent/agentSession.test.ts",
        "frontend/src/features/agent/AgentTimeline.test.ts",
        "frontend/src/features/agent/AgentPage.test.ts",
        "scripts/test_m6_chatbot_agent_behavior_parity.mjs",
        "scripts/test_m6_modern_mount.mjs",
        "scripts/test_modern_page_cutover.mjs"
      ],
      "testGap": "生产账号下的真实 CopilotKit/AG-UI SSE 与密钥注入由 M8 部署验收覆盖；本地协议、鉴权、proof、停止和结果渲染已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。"
    },
    {
      "pageKey": "dashboard",
      "label": "Chatbot Report/Chat Mode",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/runtime/modernApp.ts",
        "frontend/src/features/chatbot/ChatbotPage.vue",
        "frontend/src/features/chatbot/ChatbotReportView.vue",
        "frontend/src/features/chatbot/ChatbotChatView.vue",
        "frontend/src/features/chatbot/ChatbotResultView.vue",
        "frontend/src/features/chatbot/DeepWindow.vue",
        "frontend/src/features/chatbot/chatbotSession.ts",
        "frontend/src/features/chatbot/deepWindowStore.ts",
        "frontend/src/features/chatbot/useChatbotReport.ts",
        "frontend/src/features/chatbot/useChatbotChat.ts",
        "frontend/src/shared/stream/sse.ts"
      ],
      "state": [
        "state.currentQuery",
        "state.currentContext",
        "state.deepMode",
        "state.deepReport",
        "state.deepHistory",
        "state.chatHistory",
        "state.reportMemory",
        "state.chatIntentOverride"
      ],
      "apis": [
        "/api/chat/classify",
        "/api/chat/analyze",
        "/api/chat/stream",
        "/api/ui/db/chatbot-offers",
        "/api/ui/db/merchant",
        "/api/ui/db/search",
        "/api/chat/stream?operation=questions",
        "/api/chat/stream?operation=feedback"
      ],
      "storage": [
        "offerLanguage",
        "oi_onboarding_done",
        "oi_welcome_collapsed",
        "oi_reminder_collapsed",
        "oi_starter_collapsed",
        "oiChatbotQuestionSessionId.v1"
      ],
      "exports": [
        "downloadRecommendationXlsx()",
        "question log download",
        "answer feedback download"
      ],
      "overlays": [
        "Deep Window stack",
        "#answerFeedbackDialog",
        "#userFlowImageLightbox"
      ],
      "tests": [
        "frontend/src/features/chatbot/chatbotModel.test.ts",
        "frontend/src/features/chatbot/chatbotReportModel.test.ts",
        "frontend/src/features/chatbot/chatbotSession.test.ts",
        "frontend/src/features/chatbot/deepWindowStore.test.ts",
        "frontend/src/features/chatbot/ChatbotResultView.test.ts",
        "frontend/src/features/chatbot/ChatbotPage.test.ts",
        "frontend/src/features/chatbot/ChatbotChatView.test.ts",
        "frontend/src/features/chatbot/DeepWindow.test.ts",
        "frontend/src/features/chatbot/FeedbackForm.test.ts",
        "frontend/src/shared/markdown/markdown.test.ts",
        "frontend/src/shared/stream/sse.test.ts",
        "scripts/test_m6_chatbot_agent_behavior_parity.mjs",
        "scripts/test_m6_modern_mount.mjs",
        "scripts/test_modern_page_cutover.mjs"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。"
    },
    {
      "pageKey": "payments",
      "label": "Payments",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "state": [
        "state.payments",
        "state.paymentSort",
        "state.paymentSource",
        "state.livePaymentsLoaded",
        "state.livePaymentsLoading"
      ],
      "apis": [
        "/api/levanta/payments"
      ],
      "storage": [
        "offerPaymentLastAutoSync"
      ],
      "exports": [
        "downloadPaymentsXlsx()"
      ],
      "overlays": [],
      "tests": [
        "scripts/test_payment_placeholders.py",
        "frontend/src/features/payments/paymentModel.test.ts",
        "frontend/src/features/payments/usePayments.test.ts",
        "frontend/src/features/payments/PaymentsPage.test.ts"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。",
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/payments/PaymentsPage.vue",
        "frontend/src/features/payments/paymentModel.ts",
        "frontend/src/features/payments/usePayments.ts"
      ]
    },
    {
      "pageKey": "publishers",
      "label": "Publishers",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/publishers/PublishersPage.vue",
        "frontend/src/features/publishers/publisherModel.ts",
        "frontend/src/features/publishers/usePublishers.ts"
      ],
      "state": [
        "state.publisherMarket",
        "state.publisherNetwork",
        "state.publisherLinkType",
        "state.publisherManagerSearch",
        "state.publisherPortfolioSearch",
        "state.publisherSort",
        "state.publisherTablePage",
        "state.publisherLayoutEditing",
        "state.publisherLayout"
      ],
      "apis": [
        "/api/ui/db/publishers"
      ],
      "storage": [
        "publisherLayoutOrder"
      ],
      "exports": [
        "downloadPublishersXlsx()"
      ],
      "overlays": [
        "publisher layout editing mode"
      ],
      "tests": [
        "scripts/test_publishers_portfolio.py",
        "frontend/src/features/publishers/publisherModel.test.ts",
        "frontend/src/features/publishers/usePublishers.test.ts",
        "frontend/src/features/publishers/PublishersPage.test.ts"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。"
    },
    {
      "pageKey": "brand-media",
      "label": "Brand Media",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "state": [
        "state.brandMedia",
        "useBrandMedia() 的 merchant/date/manager/lockedKeys 状态"
      ],
      "apis": [
        "/api/ui/db/publishers",
        "/api/ui/db/brand-media-trend"
      ],
      "storage": [],
      "exports": [],
      "overlays": [
        "expanded brand media chart",
        "merchant combobox dropdown"
      ],
      "tests": [
        "scripts/test_brand_media_trend.py",
        "scripts/test_modern_page_cutover.mjs",
        "frontend/src/features/brand-media/brandMediaModel.test.ts",
        "frontend/src/features/brand-media/useBrandMedia.test.ts",
        "frontend/src/features/brand-media/BrandMediaPage.test.ts"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。",
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/brand-media/BrandMediaPage.vue",
        "frontend/src/features/brand-media/brandMediaModel.ts",
        "frontend/src/features/brand-media/useBrandMedia.ts"
      ]
    },
    {
      "pageKey": "revenue-flow",
      "label": "Revenue Flow",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "state": [
        "state.revenueFlow",
        "useRevenueFlow() 的品牌选择/日期/请求/展开状态"
      ],
      "apis": [
        "/api/ui/db/publishers",
        "/api/ui/db/brand-media-sankey"
      ],
      "storage": [],
      "exports": [],
      "overlays": [
        "expanded revenue flow chart",
        "merchant multi-select dropdown"
      ],
      "tests": [
        "frontend/src/features/revenue-flow/revenueFlowModel.test.ts",
        "frontend/src/features/revenue-flow/useRevenueFlow.test.ts",
        "frontend/src/features/revenue-flow/RevenueFlowPage.test.ts",
        "scripts/test_modern_page_cutover.mjs"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。",
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/revenue-flow/RevenueFlowPage.vue",
        "frontend/src/features/revenue-flow/RevenueFlowSankey.vue",
        "frontend/src/features/revenue-flow/revenueFlowModel.ts",
        "frontend/src/features/revenue-flow/useRevenueFlow.ts"
      ]
    },
    {
      "pageKey": "google-ads",
      "label": "Google Ads Workbench",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/google-ads/GoogleAdsPage.vue",
        "frontend/src/features/google-ads/googleAdsModel.ts",
        "frontend/src/features/google-ads/useGoogleAds.ts"
      ],
      "state": [
        "state.googleAds",
        "useGoogleAds() 的日期/请求/加载状态"
      ],
      "apis": [
        "/api/ui/db/google-ads-workbench"
      ],
      "storage": [],
      "exports": [],
      "overlays": [],
      "tests": [
        "scripts/test_google_ads_workbench.py",
        "scripts/test_google_ads_mobile_frontend.mjs",
        "scripts/test_modern_page_cutover.mjs",
        "frontend/src/features/google-ads/googleAdsModel.test.ts",
        "frontend/src/features/google-ads/useGoogleAds.test.ts",
        "frontend/src/features/google-ads/GoogleAdsPage.test.ts"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。"
    },
    {
      "pageKey": "monthly-new-merchants",
      "label": "Monthly New Merchants",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/monthly-new-merchants/MonthlyNewMerchantsPage.vue",
        "frontend/src/features/monthly-new-merchants/monthlyNewMerchantsModel.ts",
        "frontend/src/features/monthly-new-merchants/useMonthlyNewMerchants.ts"
      ],
      "state": [
        "state.monthlyNewMerchants"
      ],
      "apis": [
        "/api/ui/db/monthly-new-merchants"
      ],
      "storage": [],
      "exports": [
        "downloadMonthlyNewMerchantTemplate()"
      ],
      "overlays": [
        "monthly merchant edit drawer",
        "monthly merchant import dialog",
        "month picker"
      ],
      "tests": [
        "scripts/test_monthly_new_merchants.py",
        "frontend/src/features/monthly-new-merchants/monthlyNewMerchantsModel.test.ts",
        "frontend/src/features/monthly-new-merchants/useMonthlyNewMerchants.test.ts",
        "frontend/src/features/monthly-new-merchants/MonthlyNewMerchantsPage.test.ts"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。"
    },
    {
      "pageKey": "offer-list-tracker",
      "label": "Offer List Tracker",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "state": [
        "state.offerListTracker"
      ],
      "apis": [
        "/api/ui/db/offers"
      ],
      "storage": [
        "offerListTrackerRulesV1",
        "offerListTrackerColumnsV1",
        "offerListTrackerSavedViewsV1"
      ],
      "exports": [
        "downloadOfferTrackerWorkbook()",
        "triggerWorkbookDownload()"
      ],
      "overlays": [
        "Offer Tracker export dialog",
        "column panel",
        "rules panel",
        "saved views menu"
      ],
      "tests": [
        "scripts/test_offer_tracker_date_range.py",
        "scripts/test_modern_page_cutover.mjs",
        "frontend/src/features/offer-tracker/offerTrackerModel.test.ts",
        "frontend/src/features/offer-tracker/OfferTrackerPage.test.ts",
        "frontend/src/shared/api/client.test.ts",
        "frontend/src/shared/i18n/index.test.ts"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。",
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/offer-tracker/OfferTrackerPage.vue",
        "frontend/src/features/offer-tracker/offerTrackerModel.ts",
        "frontend/src/features/offer-tracker/useOfferTracker.ts"
      ]
    },
    {
      "pageKey": "sheets",
      "label": "Targets",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/targets/TargetsPage.vue",
        "frontend/src/features/targets/targetModel.ts",
        "frontend/src/features/targets/useTargets.ts"
      ],
      "state": [
        "state.targetFilters",
        "state.targetMetric",
        "state.targetTrendView",
        "state.targetOverrides",
        "state.targetSort",
        "state.dbStatus",
        "state.dbTierSummary"
      ],
      "apis": [
        "/api/ui/db/status",
        "/api/ui/db/tier-summary"
      ],
      "storage": [
        "offerTargetTextOverrides.v1"
      ],
      "exports": [
        "downloadSheetTargetsXlsx()",
        "downloadTargets()",
        "downloadWorkbook()"
      ],
      "overlays": [
        "inline target edit form"
      ],
      "tests": [
        "scripts/test_m5_mobile_frontend.mjs",
        "scripts/test_modern_page_cutover.mjs",
        "frontend/src/features/targets/targetModel.test.ts",
        "frontend/src/features/targets/useTargets.test.ts",
        "frontend/src/features/targets/TargetsPage.test.ts"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。"
    },
    {
      "pageKey": "category",
      "label": "Category Report",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/category-report/CategoryReportPage.vue",
        "frontend/src/features/category-report/categoryReportModel.ts",
        "frontend/src/features/category-report/useCategoryReport.ts",
        "frontend/src/shared/export/xlsx.ts"
      ],
      "state": [
        "state.categoryReportTiers",
        "state.categoryReportSearch",
        "state.categoryReportSelection",
        "state.categoryReportSort",
        "state.categoryReportDirection",
        "state.categoryReportFocusKey",
        "state.expandedCategoryKey",
        "state.tierReport"
      ],
      "apis": [
        "/api/ui/db/tier_sheet"
      ],
      "storage": [],
      "exports": [
        "downloadFocusedCategoryRows()",
        "downloadCategory()",
        "downloadWorkbook()"
      ],
      "overlays": [
        "category pie spotlight",
        "category focused detail"
      ],
      "tests": [
        "scripts/test_sheet_categories.mjs",
        "scripts/test_modern_page_cutover.mjs",
        "frontend/src/features/category-report/categoryReportModel.test.ts",
        "frontend/src/features/category-report/useCategoryReport.test.ts",
        "frontend/src/features/category-report/CategoryReportPage.test.ts"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。"
    },
    {
      "pageKey": "tier",
      "label": "Tier Sheet",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/tier-sheet/TierSheetPage.vue",
        "frontend/src/features/tier-sheet/tierSheetModel.ts",
        "frontend/src/features/tier-sheet/useTierSheet.ts",
        "frontend/src/shared/export/xlsx.ts"
      ],
      "state": [
        "state.selectedTierPage",
        "state.expandedTierSheet",
        "state.selectedTierRowKeys",
        "state.visibleTierRowKeys",
        "state.tierTablePages",
        "state.manualTierMoves",
        "state.tier1Management",
        "state.tierSheetFilters",
        "state.tierReport",
        "state.tierVisibleColumns",
        "state.trendVisibleColumns"
      ],
      "apis": [
        "/api/ui/db/tier_sheet",
        "/api/ui/db/tier-summary",
        "/api/ui/db/tier1-merchants",
        "/api/tier_moves"
      ],
      "storage": [
        "offerTierOverrides",
        "offerTierVisibleColumns.v4",
        "offerTrendVisibleColumns.v1",
        "offerTierSheetManualMoves.v1",
        "offerTierMoveAdminToken"
      ],
      "exports": [
        "downloadTierSheetXlsx()",
        "downloadTier()",
        "downloadWorkbook()"
      ],
      "overlays": [
        "Tier Sheet overlay",
        "Tier Move dialog",
        "Tier 1 additions overlay",
        "Tier 1 merchant dialog",
        "Tier column panel"
      ],
      "tests": [
        "scripts/test_tier_visual_status_rules.py",
        "scripts/test_tier1_merchant_frontend.mjs",
        "scripts/test_manual_tier_automation.py",
        "scripts/test_tier_moves_api.py",
        "scripts/test_m5_mobile_frontend.mjs",
        "scripts/test_shared_xlsx_frontend.mjs",
        "scripts/test_modern_page_cutover.mjs",
        "frontend/src/features/tier-sheet/tierSheetModel.test.ts",
        "frontend/src/features/tier-sheet/useTierSheet.test.ts",
        "frontend/src/features/tier-sheet/TierSheetPage.test.ts",
        "frontend/src/shared/export/xlsx.test.ts"
      ],
      "testGap": "生产认证、真实数据和部署环境的浏览器冒烟由 M8 负责；页面模型、交互与构建契约已自动化覆盖。",
      "notes": "页面仅由 standalone Vue Runtime 挂载；旧 DOM、旧渲染器、旧 bridge 与旧静态资源已删除。回滚使用上一份可部署构建，不再使用运行时 legacy 开关。"
    },
    {
      "pageKey": "offer-performance",
      "label": "Offer promotion tracking",
      "status": "removed",
      "roots": [
        "#modernAppRoot",
        "[data-modern-page-host]"
      ],
      "legacyEntry": [],
      "modernEntry": [
        "frontend/src/entry.ts",
        "frontend/src/features/offer-performance/OfferPerformancePage.vue",
        "frontend/src/features/offer-performance/performanceModel.ts",
        "offer_performance.py"
      ],
      "state": [
        "batchId",
        "launch",
        "start",
        "end",
        "selectedId",
        "metric"
      ],
      "apis": [
        "/api/ui/db/offer-performance"
      ],
      "storage": [
        "oi-promotion-batches-v1"
      ],
      "exports": [
        "offer-promotion-comparison.xlsx"
      ],
      "overlays": [
        "DatePicker"
      ],
      "tests": [
        "frontend/src/features/offer-performance/performanceModel.test.ts",
        "frontend/src/features/offer-performance/OfferPerformancePage.test.ts",
        "frontend/src/features/offer-performance/PromotionRelations.test.ts",
        "frontend/src/features/offer-performance/PromotionImport.test.ts",
        "frontend/src/features/offer-performance/promotionAppearance.test.ts",
        "scripts/test_offer_performance.py"
      ],
      "testGap": "Real database validation was intentionally not performed.",
      "notes": "Native modern page; no legacy implementation. See docs/offer-promotion-tracking.md."
    }
  ]
}
```
<!-- FRONTEND_MIGRATION_INVENTORY_END -->

## 跨页面启动与共享依赖

| 依赖 | 当前入口 | 迁移要求 |
| --- | --- | --- |
| 认证与数据预载 | `public/auth.js`、`public/auth.css` | 保持会话、登录和 `/api/ui/db/offers` 语义；认证成功后只加载 standalone modern bundle，启动失败显示 `#modernAppError` |
| 全局导航 | `frontend/src/runtime/modernApp.ts`、`frontend/src/shell/AppShell.vue` | `ModernAppApi.setPage()` 是唯一页面切换入口，页面只挂载到 `[data-modern-page-host]` |
| 语言 | `offerLanguage`、`frontend/src/shared/i18n/` | `ModernAppApi.setLanguage()` 统一同步 Shell 和页面；迁移文案必须中文/英文成对维护 |
| 共享 API、错误与契约 | `frontend/src/shared/api/`、`frontend/src/shared/contracts/` | M3 的 modern 页面使用统一 JSON/错误/超时边界；契约只保留跨页面稳定字段，不复制完整数据库响应 |
| 导出 | `frontend/src/shared/export/xlsx.ts` | 页面通过 shared exporter 生成 XLSX；字段、格式、worksheet XML、styles XML 和 package parts 由 fixture 测试保护 |
| Deep Window | `frontend/src/features/chatbot/deepWindowStore.ts`、`DeepWindow.vue` | Vue store/component 负责最小化、恢复、拖动、关闭、请求中止和加入对话 |
| 数据启动对象 | `AppBootstrapData` | 只在 `frontend/src/runtime/contracts.ts` 的受控边界读取；feature 不直接读取任意全局对象 |
| 主题与移动导航 | `frontend/src/shell/AppShell.vue`、`frontend/src/shell/theme.ts`、`frontend/src/shell/shell.css` | AppShell 负责主题、页面标题、桌面/移动导航、焦点和 reduced-motion |

## 当前测试缺口优先级

1. P1：M8 在真实部署环境验证认证、12 个页面路由、API 非 2xx、CopilotKit/AG-UI SSE、停止和重试。
2. P1：执行构建级回滚演练；回滚到上一份可部署构建，不恢复已经删除的运行时开关或旧源码。
3. P2：记录 modern bundle 与按需 Agent bundle 的体积、启动错误率和关键交互耗时。

## 状态更新记录

| 日期 | 页面 | 旧状态 | 新状态 | 证据 |
| --- | --- | --- | --- | --- |
| 2026-08-27 | 全部页面 | 无清单 | `legacy` | M0 首次盘点；尚未开始框架运行时代码 |
| 2026-08-27 | Offer List Tracker | `legacy` | `dual` | Vue 核心筛选/排序/选择/分页/导出入口、legacy fallback、Vitest/构建契约和应用内浏览器验收通过；高级面板仍由 legacy 提供 |
| 2026-08-27 | 共享前端模块 | 未建立 | 已建立 | M3 新增 shared API/error、Tier/Payment 契约和 i18n；Offer Tracker 已接入，Vitest、类型检查、构建和旧回归通过；其他页面仍待后续迁移 |
| 2026-08-27 | Payments | `legacy` | `modern` | Vue model/composable/组件、live API 错误保留 saved rows、月份/状态/搜索/排序、零金额排除、窄 XLSX bridge、legacy fallback、全量 Vitest/类型检查/构建和应用内 Edge 浏览器验收通过；browser-act 无已配置浏览器，8766 隔离服务的 API 仍因缺少 `LEVANTA_API_KEY` 返回 503，受控错误路径已验证 |
| 2026-08-28 | Publishers | `legacy` | `modern` | Vue model/composable/组件覆盖筛选、排序、分页、列设置、布局编辑、Publisher profile/portfolio 和导出；选中媒体后的 profile KPI、零活动商家保留与 AOV N/A 边界已补回归；14 个 Vitest 文件/75 项测试、typecheck、build、页面契约和持久化 Sites 视觉对比通过；legacy fallback 仍保留 |
| 2026-08-28 | Brand Media | `legacy` | `dual` | Vue model/composable/组件、趋势请求取消与过期响应保护、订单/点击图、Manager/媒体锁定、展开/Escape、错误/空状态、legacy fallback、全量 Vitest/类型检查/构建和 Brand Media 契约通过；BrowserAct 已验证桌面新旧几何对齐及 populated fixture 的 hover/锁定/Manager/展开交互，390px 已由用户验收通过，真实趋势接口在本地返回 503，populated 数据验收仍待补 |
| 2026-08-28 | Revenue Flow | `legacy` | `dual` | 新增 Vue model/composable、Canvas Sankey、品牌多选/日期范围/展开与卸载清理、模块级缓存/进行中请求复用、Brand Media 初始状态继承和连线 Flow tooltip；stash 冲突已保留当前分支完整公共壳层并补入 Revenue Flow modern root；15 项 Revenue Flow Vitest、排除 Publishers 后前端 Vitest 14 个文件/77 项、全量 typecheck、build、build contract、Revenue Flow 前端契约、node --check public/app.js、Brand Media 后端回归和 git diff --check 通过；真实数据与 BrowserAct 验收待补 |
| 2026-08-31 | Targets/Category/Tier 与共享导出 | `Targets/Category dual，Tier legacy` | `Targets/Category/Tier dual` | Tier Vue model/composable/page 已接入 `#tierModernRoot`，保留 legacy fallback；Targets/Category/Tier 导出接入 shared `xlsx.ts`；shared fixture 对比 legacy/new 的列格式、worksheet XML、styles XML 和 ZIP package parts；旧版 CSS/HTML 与 Vue class/层级代码级对照完成，并修正 Tier/Category root 内边距与 Tier 弹层 z-index；30 个 Vitest 文件/137 项、typecheck/build、页面契约、旧版/Python 回归和 diff check 通过；真实浏览器截图和实际下载验收待可访问预览 URL |
| 2026-09-01 | M5 Targets/Category/Tier 移动端续验 | `Targets/Category/Tier dual` | `Targets/Category/Tier dual` | 新增移动端 CSS 契约并按 TDD 完成 RED → GREEN；Targets 窄屏筛选/KPI 单列、Tier 390px tabs 采用 4+1 布局；同步 Tier 侧栏简化并修复本地重复/未闭合 nav button；Sites version 7 公开部署成功，完成 1363×936 compare、390×844 focused 截图和 Category/Targets/Tier 页面加载验收；真实生产 API/auth、Move webhook/持久化和完整移动交互仍待补 |
| 2026-09-01 | M5 Targets/Category/Tier 交互入口续验 | `Targets/Category/Tier dual` | `Targets/Category/Tier dual` | 按 TDD 为三页补齐稳定 data-* hooks；公开 Sites version 8（source `f99c2a48b6b419063d7e0449f73c8effb0dbd59b`）完成 1363×936 compare、390×844 legacy/Vue screenshots，并在公开 Browser 验证 Targets metric/day、Category focus/reset/expand、Tier tab/select/Move dialog/Display/Expand-Close；真实生产 API/auth、Move 确认持久化和完整移动交互仍待补 |
| 2026-09-01 | Google Ads 390px 与视觉边界 | `dual` | `dual` | 修复 Vue 标题与 legacy `h2` 样式不一致；新增 `googleAds.css` 和 `test_google_ads_mobile_frontend.mjs`，补齐 modern mount 的窄屏宽度、局部 chart/table 横向滚动、长文案换行和稳定 Refresh hook；Google Ads feature 8 项 Vitest、typecheck/build、旧版/Python 回归与公开 Sites version 9 通过；Firecrawl 390×844 legacy/Vue 截图及 Browser 1363×936 compare、标题 computed-style（两侧 35.438px）和 30D/Refresh smoke 已验证；真实 API/auth、生产账号和共享 Shell 仍待 |
| 2026-09-01 | M4/M5 页面验收与共享 Shell | `M4/M5 dual` | `M4/M5 dual` | 用户明确确认 M4 与 M5 验收任务全部完成；本次实现补齐 `AppShell`、统一导航模型、单一 Tier 入口、主题持久化和页面标题同步；可见桌面/移动侧边栏继续沿用 legacy 样式，页面迁移状态不因验收记录被误改，继续按实际 `dual`/`modern` 保留 legacy fallback |
| 2026-09-01 | Monthly New Merchants modern 放行 | `Monthly New Merchants dual` | `Monthly New Merchants modern` | M4 验收已由用户确认完成；modern root、Vue factory、modern-first `switchPage()` 顺序、卸载清理、legacy fallback 和 `.is-modern` 页面边界均通过放行契约；不修改月度商家 API、数据字段、认证或侧边栏视觉 |
| 2026-09-01 | M4 Brand Media/Revenue Flow/Google Ads modern 放行 | `M4 dual` | `M4 modern` | M4 验收已由用户确认完成；三页 modern root、factory、modern-first `switchPage()`、卸载清理、legacy fallback 和 `.is-modern` 页面边界均通过统一放行契约；不修改 API、数据口径、认证或侧边栏视觉 |
| 2026-09-01 | M5 Targets/Category/Tier modern 放行 | `M5 dual` | `M5 modern` | M5 验收已由用户确认完成；三页 modern root、factory、modern-first `switchPage()`、卸载清理、legacy fallback、shared XLSX、Tier Move 和分类/目标报表边界均通过既有页面契约与统一放行契约 |
| 2026-09-01 | Offer List Tracker modern 放行 | `Offer List Tracker dual` | `Offer List Tracker modern` | 核心路径的筛选、排序、选择、分页和导出已由 Vue 接管；modern-first mount、卸载清理、legacy fallback 和 CSS boundary 通过统一放行契约，高级面板继续保留 legacy 回滚范围 |
| 2026-09-02 | M6 Chatbot/Agent 现代页面首个垂直切片 | `Chatbot/Agent legacy` | `Chatbot/Agent dual` | 新增 Chatbot Report/Chat/Deep Window 与 Agent Vue 页面、modern roots 和 factory；行为 parity 完成前由 `modernChatbotAgentParityEnabled()` 保持 Legacy-first，避免改变用户使用方式。共享 Markdown/SSE、Agent 时间线/停止/结构化记忆、问题日志/Trace bridge 和组件回归已接入；行为等价、完整 Report 路径、反馈/日志、视觉和真实浏览器验收仍未完成。`test_chatbot_intent_flow.mjs` 仍历史性超时未通过。 |
| 2026-09-02 | M6 Chatbot/Agent 行为等价实现 | `Chatbot/Agent dual` | `Chatbot/Agent dual` | Chatbot Report/Chat/Deep Window 与独立 Agent 均通过受控 Legacy session bridge 复用既有 applyPrompt/runChatAgent/SSE/Trace/日志链路；补齐来源刷新、完整路由委托、Memory recommendation、反馈/日志/onboarding、Deep Window 图表控制/clone/overlay/导出/加入对话、Agent 可见流式时间线、卸载中止和 Memory 字段白名单。Vitest 51 个文件/229 项、typecheck、build、M6 parity/mount/cutover、Legacy Node/Python 回归均通过；`test_chatbot_intent_flow.mjs` 仍历史性超时未通过，真实浏览器验收待用户确认，因此继续保持 `dual`。 |
| 2026-09-02 | M6 Chatbot/Agent modern 放行 | `Chatbot/Agent dual` | `Chatbot/Agent modern` | 用户已确认完成 Chatbot Report/Chat Mode、Deep Window 与 Agent 的真实浏览器、数据、视觉和 SSE 验收；`test_m6_chatbot_agent_behavior_parity.mjs`、`test_m6_modern_mount.mjs`、`test_modern_page_cutover.mjs` 与既有 Agent/Chatbot 自动化回归用于放行确认。`modernChatbotAgentParityEnabled()` 默认启用 Modern，factory/bridge 失败时回退 Legacy，显式 `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ = false` 保留回滚；`test_chatbot_intent_flow.mjs` 历史性超时仍单独记录，legacy 删除延后至 M7。 |
| 2026-09-02 | Chatbot/Agent 原版对齐与放行撤回 | `Chatbot/Agent modern` | `Chatbot/Agent dual` | 用户反馈 Modern 与原版视觉和交互差异较大，因此恢复 Legacy-first；只有显式 `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ = true` 才挂载 Modern 对照页。Modern Chatbot/Agent 改为复用原版双栏、消息、输入、模式切换、Agent 工作区和时间线结构类；代码级回归通过，最终视觉与真实接口验收待用户完成。 |
| 2026-09-03 | Chatbot/Agent Legacy-first 浏览器验收 | `Chatbot/Agent dual` | `Chatbot/Agent dual` | 用户已完成 Chatbot Report/Chat、Deep Window 与 Agent 的 Legacy-first 浏览器视觉、交互、真实数据和 SSE 验收；PR #186 补齐 Chat/Report 输入区白色文字、发送按钮视觉和 Chat Mode 独立“转为 View”控件收敛。Modern 继续仅作显式对照，legacy 删除不启动。 |
| 2026-09-04 | M6 Modern-first Runtime 与回退完整性 | `Chatbot/Agent dual` | `Chatbot/Agent modern` | Modern Chatbot/Agent 默认由独立 session 渲染；Agent 默认使用按需 CopilotKit bundle、同源 `/api/copilotkit` 与 Python `/api/chat/agui`。显式 `window.__OI_MODERN_CHATBOT_AGENT_PARITY__ = false` 或 `OI_AGENT_RUNTIME_MODE=legacy` 可回退 Legacy；补齐本地 AG-UI 路由、Legacy Agent session 适配、Chat answer ID/反馈/Open as View、Deep Window 趋势控件和关键词候选预筛回归。 |
| 2026-09-04 | M7/01–02 standalone modern 入口与认证资源收敛 | `M7 未开始` | `M7 进行中` | `public/auth.js` 默认加载并挂载 standalone modern app；旧 `public/app.js` 仅由 `?legacy=1` 显式加载；modern 启动失败显示 `#modernAppError`；新增 `public/auth.css`，legacy CSS 与五个辅助脚本仅由回滚加载器动态载入；`ModernAppApi.mountApplication()`、modern Shell CSS、本地 Agent 趋势 SVG、M7/M4 入口契约和全量前端/Node/Python 回归通过。legacy 页面 DOM、bridge、旧导出设置对话框和旧行为测试仍有真实引用，未满足删除门槛。 |
| 2026-09-04 | M7 legacy 运行时移除 | `M7 进行中` | `M7 完成` | 12 个页面的清单状态更新为 `removed`；启动数据与应用 API 类型迁入 `frontend/src/runtime/`；删除旧页面 DOM、`public/app.js`、`public/styles.css`、五个辅助脚本、`frontend/src/legacy/` 和只断言旧源码字符串的测试。认证入口只加载 standalone modern bundle；CI、清单、构建、M4/M6/M7 契约与 Vue 行为测试改为验证当前实现。运行时回滚开关确认移除，后续仅使用上一份可部署构建回滚。 |
| 2026-09-01 | M5 Tier Move 生产边界与移动交互 | `Targets/Category/Tier dual` | `Targets/Category/Tier dual` | 按 TDD 新增 `scripts/test_tier_moves_api.py`，先以 RED 锁定非对象 JSON、超大请求体和非对象 webhook 响应缺口，再由 `api/tier_moves.py` 加入 256 KiB/1000 条记录/JSON object/`moves` list 校验及 502 响应归一化；Vue 新增 `moveSyncing`、重复 Move/Reset 防护、按钮 disabled/`aria-busy` 和 modern 560px Move dialog 边界，前端全量 33 个 Vitest 文件/160 项、typecheck/build、Tier/M5/Google Ads 契约、旧版/Python 回归与 diff check 通过；公开 Sites version 10（QA commit `97f93d99ab833fdaf64932c9bd8a216007245393`）完成 Firecrawl 390×844 legacy/Vue 截图、Browser 1363×936 compare 及 Tier 2/选行/Move dialog/目标切换 smoke；按当时 M5 验收结论保持 `dual`，随后按回滚安全规则完成逐页 `dual → modern` 放行 |
| 2026-09-01 | M5 Tier Move 生产边界、移动交互与 Tier 1 预加载一致性 | `Targets/Category/Tier dual` | `Targets/Category/Tier dual` | 按 TDD 新增 `scripts/test_tier_moves_api.py`，先以 RED 锁定非对象 JSON、超大请求体和非对象 webhook 响应缺口，再由 `api/tier_moves.py` 加入 256 KiB/1000 条记录/JSON object/`moves` list 校验及 502 响应归一化；Vue 新增 `moveSyncing`、重复 Move/Reset 防护、按钮 disabled/`aria-busy`、modern 560px Move dialog 边界和 Tier 1 additions 挂载预加载/空响应缓存，前端全量 33 个 Vitest 文件/162 项、typecheck/build、Tier/M5/Google Ads 契约、旧版/Python 回归与 diff check 通过；公开 Sites version 14（QA commit `fcb53dcff5873db4341ce6ae86375f854f07e092`）完成 Firecrawl 390×844 legacy/Vue 截图、Browser 1363×936 compare 及 Tier 2/选行/Move dialog/目标切换 smoke；两侧 Added merchants 均为 1，按既有 M5 验收结论保持 `dual`，后续按回滚安全规则逐页放行 |
| 2026-09-01 | M4 Brand Media/Revenue Flow/Google Ads modern 放行 | `M4 dual` | `M4 modern` | M4 验收已由用户确认完成；三页 modern root、factory、modern-first `switchPage()`、卸载清理、legacy fallback 和 `.is-modern` 页面边界均通过统一放行契约；不修改 API、数据口径、认证或侧边栏视觉 |
| 2026-09-01 | M5 Targets/Category/Tier modern 放行 | `M5 dual` | `M5 modern` | M5 验收已由用户确认完成；三页 modern root、factory、modern-first `switchPage()`、卸载清理、legacy fallback、shared XLSX、Tier Move 和分类/目标报表边界均通过既有页面契约与统一放行契约 |
| 2026-09-01 | Offer List Tracker modern 放行 | `Offer List Tracker dual` | `Offer List Tracker modern` | 核心路径的筛选、排序、选择、分页和导出已由 Vue 接管；modern-first mount、卸载清理、legacy fallback 和 CSS boundary 通过统一放行契约，高级面板继续保留 legacy 回滚范围 |
