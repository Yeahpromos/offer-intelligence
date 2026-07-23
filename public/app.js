(function () {
  const data = window.CHATBOT_DATA || { summary: {}, offers: [] };
  const sheetReport = window.SHEET_REPORT_DATA || { sheets: [], tierSheets: [] };
  const productKeywordData = window.PRODUCT_KEYWORDS || { merchants: [] };
  const offers = mergeProductKeywordsIntoOffers(data.offers || [], productKeywordData);
  const chatbotI18n = window.CHATBOT_I18N || {};
  const tier2Rules = window.TIER2_RECOMMENDATION_RULES || {};
  const TIER_MOVE_OPTIONS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"];
  const TIER_VISUAL_STATUS_COLOR_KEYS = ["visualStatusColor", "visual_status_color", "Visual Status Color", "Visual Status", "Color"];
  const TIER_VISUAL_STATUS_CODE_KEYS = ["visualStatusCode", "visual_status_code", "Visual Status Code", "Reason Code"];
  const TIER_VISUAL_STATUS_REASON_KEYS = ["visualStatusReason", "visual_status_reason", "Visual Status Reason", "Reason Text"];
  const TIER_VISUAL_STATUS_SOURCE_KEYS = ["visualStatusSource", "visual_status_source", "Visual Status Source", "Source"];
  const TIER_OVERRIDE_KEY = "offerTierOverrides";
  const TIER_COLUMN_KEY = "offerTierVisibleColumns.v4";
  const offersByMerchantId = new Map();
  const offerGroupsByMerchantId = new Map();
  const originalOfferTiers = [];
  let tierOverrides = loadTierOverrides();
  const sheetPaymentCycles = buildSheetPaymentCycleIndex();
  offers.forEach((offer, index) => {
    originalOfferTiers[index] = offer.tier || "";
    const merchantId = String(offer.merchantId || "").trim();
    if (merchantId) {
      if (!offersByMerchantId.has(merchantId)) offersByMerchantId.set(merchantId, offer);
      if (!offerGroupsByMerchantId.has(merchantId)) offerGroupsByMerchantId.set(merchantId, []);
      offerGroupsByMerchantId.get(merchantId).push(offer);
    }
    offer.originalTier = offer.originalTier || offer.tier || "Unknown";
    applyTierOverrideToOffer(offer);
    // 字段名兼容：DB payload 用 affiliatePayout，前端代码期望 affCommission
    if (offer.affCommission === undefined && offer.affiliatePayout !== undefined) {
      offer.affCommission = offer.affiliatePayout;
    }
    offer.paymentCycle = resolveOfferPaymentCycle(offer);
    offer.region = normalizeRegion(offer.region || offer.country || inferRegionFromText(offer.brand));
  });
  const PAYMENT_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const ACTIVE_PAYMENT_MONTHS = ["February", "March", "April", "May", "June"];
  const MAX_RECOMMENDATION_EXPORT = 1000;
  const AUTO_PAYMENT_SYNC_KEY = "offerPaymentLastAutoSync";
  const AUTO_PAYMENT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
  const STANDARD_CATEGORY_REPORT_TIERS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4"];
  const REMOVED_TIER_REVENUE_HEADERS = new Set(["May", "June"].map((month) => `${month} Revenue`));
  const LIVE_TIER_METRIC_HEADERS = new Set([
    "Order count", "Revenue", "Backend EPC", "AOV", "Conversion", "Conversion Rate",
    "Clicks", "DPV", "ATC", "Payout", "Affiliate Payout"
  ]);
  const DEFAULT_TIER_VISIBLE_COLUMNS = [
    "Merchant ID",
    "Merchant Name",
    "Brand",
    "Network",
    "Commission Rate",
    "Category",
    "Clicks",
    "DPV",
    "ATC",
    "AOV",
    "Conversion Rate",
    "Revenue"
  ];
  const DEFAULT_TIER_COLUMN_ALIASES = {
    "Network": ["Network", "Agency"],
    "Conversion Rate": ["Conversion Rate", "Conversion", "CVR"]
  };
  const TIER_TABLE_PAGE_SIZE = 500;
  const CATEGORY_REPORT_TIER_OPTIONS = [...STANDARD_CATEGORY_REPORT_TIERS, "BLACK TIER"];
  const TIER_SHEET_EXPANDABLE_TIERS = new Set(STANDARD_CATEGORY_REPORT_TIERS);
  const TIER_SHEET_MOVE_TARGETS = CATEGORY_REPORT_TIER_OPTIONS.slice();
  const TIER_SHEET_MOVE_STORAGE_KEY = "offerTierSheetManualMoves.v1";
  const TIER_SHARED_MOVES_API = "/api/tier_moves";
  const TIER_MOVE_ADMIN_TOKEN_KEY = "offerTierMoveAdminToken";
  const CATEGORY_REPORT_ADDITIVE_SORTS = new Set(["merchantCount", "revenue", "orders", "clicks"]);
  const TARGET_OVERRIDES_KEY = "offerTargetTextOverrides.v1";
  const TARGET_TIER_ORDER = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "Black Tier", "BLACK TIER"];
  const TARGET_METRICS = [
    { key: "revenue", label: "Revenue" },
    { key: "orders", label: "Orders" },
    { key: "clicks", label: "Clicks" },
    { key: "conversion", label: "Avg Conversion" },
    { key: "brands", label: "Active Brands" }
  ];
  const TARGET_TREND_VIEWS = [
    { key: "month", label: "Monthly report" },
    { key: "day", label: "Daily report" }
  ];
  const DB_STATUS_UI_API = "/api/ui/db/status";
  const DB_MERCHANT_UI_API = "/api/ui/db/merchant";
  const DB_SEARCH_UI_API = "/api/ui/db/search";
  const DB_TIER_SUMMARY_API = "/api/ui/db/tier-summary";
  const DB_TIER_SHEET_UI_API = "/api/ui/db/tier_sheet";
  const DB_STATUS_AUTO_REFRESH_MS = 5 * 60 * 1000;
  const PAYMENT_TODAY = new Date(`${localDateKey(new Date())}T00:00:00`);
  const DEFAULT_TIER_REPORT_END_DATE = localDateKey(new Date());
  const DEFAULT_TIER_REPORT_START_DATE = `${DEFAULT_TIER_REPORT_END_DATE.slice(0, 7)}-01`;
  const originalTierSheetRows = new Map();
  const originalTierSheetRowIndex = new Map();
  const dbMerchantCache = new Map();
  const dbMerchantLoading = new Set();
  const dbSearchCache = new Map();
  const dbSearchLoading = new Set();
  let paymentRecords = visiblePaymentRecords(withPendingPaymentPlaceholders((data.paymentRecords || []).map(normalizePaymentRecord)));
  const paymentRecordsByMerchant = new Map();
  rebuildPaymentIndex();

  const state = {
    page: "dashboard",
    tier: "all",
    network: "all",
    category: "all",
    minEpc: "",
    minAov: "",
    minCvr: "",
    notPaidOnly: false,
    sort: "epc",
    descending: true,
    categoryReportTiers: STANDARD_CATEGORY_REPORT_TIERS.slice(),
    categoryReportSearch: "",
    categoryReportSort: "revenue",
    categoryReportDirection: "desc",
    categoryReportFocusKey: "",
    expandedCategoryKey: null,
    lastOffer: null,
    lastRows: [],
    currentQuery: "",
    llmClassifyResult: null,
    llmParams: null,
    currentContext: { type: "default", items: [], summary: {}, filters: {} },
    payments: {
      month: "all",
      network: "all",
      region: "all",
      tier: "all",
      status: "all",
      search: ""
    },
    paymentSort: {
      key: "",
      direction: "asc"
    },
    selectedTierPage: "Tier 1",
    expandedTierSheet: false,
    selectedTierRowKeys: new Set(),
    visibleTierRowKeys: [],
    tierTablePages: { "Tier 4": 1 },
    manualTierMoves: loadManualTierMoves(),
    sharedTierMovesConfigured: false,
    sharedTierMovesLoading: false,
    tierMoveTarget: "",
    tierMoveStatus: "",
    tierSheetFilters: {
      search: "",
      network: "all",
      country: "all",
      minEpc: "",
      minRevenue: ""
    },
    tierReport: {
      startDate: DEFAULT_TIER_REPORT_START_DATE,
      endDate: DEFAULT_TIER_REPORT_END_DATE,
      payloads: new Map(),
      activeKeys: new Map(),
      loadingKeys: new Set(),
      errors: new Map()
    },
    tierColumnPanelOpen: false,
    tierVisibleColumns: loadTierVisibleColumns(),
    targetFilters: {
      month: "",
      compareMonth: "",
      tier: "all"
    },
    targetMetric: "revenue",
    targetTrendView: "month",
    publisherMarket: "all",
    publisherNetwork: "all",
    publisherLinkType: "all",
    publisherMerchantSearch: "",
    publisherProductSearch: "",
    publisherManagerSearch: "",
    publisherSiteSearch: "",
    publisherTrackSearch: "",
    publisherChartMetric: "clicks",
    publisherStartDate: "",
    publisherEndDate: "",
    publisherSort: { key: "", direction: "desc" },
    targetOverrides: loadTargetOverrides(),
    targetEditingKey: "",
    targetSort: {
      key: "Tier",
      direction: "asc"
    },
    dbStatus: {
      data: null,
      loading: false,
      error: "",
      monthKey: ""
    },
    dbTierSummary: {
      data: null,
      loading: false,
      monthKey: ""
    },
    tierSheetSort: {
      key: "",
      direction: "asc"
    },
    paymentSource: "saved invoice file",
    livePaymentsLoaded: false,
    livePaymentsLoading: false,
    activeRecommendationBundle: null,
    excludedRecommendationKeys: new Set(),
    recommendationDownloads: {},
    downloadSequence: 0,
    reportsOpen: true,
    language: localStorage.getItem("offerLanguage") === "zh" ? "zh" : "en",
    deepMode: false,
    deepReport: null,
    deepHistory: []
  };

  const llmClassifyCache = new Map();

  const els = {
    dashboardNav: document.getElementById("dashboardNav"),
    paymentsNav: document.getElementById("paymentsNav"),
    sheetsNav: document.getElementById("sheetsNav"),
    targetNav: document.getElementById("targetNav"),
    reportsSubnav: document.getElementById("reportsSubnav"),
    categoryNav: document.getElementById("categoryNav"),
    tier: document.getElementById("tierFilter"),
    network: document.getElementById("networkFilter"),
    category: document.getElementById("categoryFilter"),
    minEpc: document.getElementById("minEpc"),
    minAov: document.getElementById("minAov"),
    minCvr: document.getElementById("minCvr"),
    notPaidOnly: document.getElementById("notPaidOnly"),
    reset: document.getElementById("resetFilters"),
    metrics: document.getElementById("metrics"),
    dashboardCategoryTierPicker: document.getElementById("dashboardCategoryTierPicker"),
    dashboardCategoryReportSubtitle: document.getElementById("dashboardCategoryReportSubtitle"),
    dashboardCategoryReportBody: document.getElementById("dashboardCategoryReportBody"),
    dashboardCategorySearch: document.getElementById("dashboardCategorySearch"),
    table: document.getElementById("offerRows"),
    tableCount: document.getElementById("tableCount"),
    chatLog: document.getElementById("chatLog"),
    chatForm: document.getElementById("chatForm"),
    chatInput: document.getElementById("chatInput"),
    quickActions: document.getElementById("quickActions"),
    recBox: document.getElementById("recommendationBox"),
    stamp: document.getElementById("datasetStamp"),
    download: document.getElementById("downloadCsv"),
    paymentDownload: document.getElementById("downloadPaymentsXlsx"),
    paymentHead: document.getElementById("paymentTableHead"),
    sheetDownload: document.getElementById("downloadSheetXlsx"),
    tierDownload: document.getElementById("downloadTierXlsx"),
    contextTitle: document.getElementById("contextTitle"),
    contextSubtitle: document.getElementById("contextSubtitle"),
    paymentsPage: document.getElementById("paymentsPage"),
    publishersNav: document.getElementById("publishersNav"),
    publishersPage: document.getElementById("publishersPage"),
    publisherStartDate: document.getElementById("publisherStartDate"),
    publisherEndDate: document.getElementById("publisherEndDate"),
    publisherMarketFilter: document.getElementById("publisherMarketFilter"),
    publisherNetworkFilter: document.getElementById("publisherNetworkFilter"),
    publisherLinkTypeFilter: document.getElementById("publisherLinkTypeFilter"),
    publisherMerchantSearch: document.getElementById("publisherMerchantSearch"),
    publisherProductSearch: document.getElementById("publisherProductSearch"),
    publisherManagerSearch: document.getElementById("publisherManagerSearch"),
    publisherSiteSearch: document.getElementById("publisherSiteSearch"),
    publisherTrackSearch: document.getElementById("publisherTrackSearch"),
    publisherSearchBtn: document.getElementById("publisherSearchBtn"),
    publisherResetBtn: document.getElementById("publisherResetBtn"),
    publisherExportBtn: document.getElementById("publisherExportBtn"),
    publishersKpiRow: document.getElementById("publishersKpiRow"),
    publishersChart: document.getElementById("publishersChart"),
    publishersChartTitle: document.getElementById("publishersChartTitle"),
    publishersTableHead: document.getElementById("publishersTableHead"),
    publishersTableRows: document.getElementById("publishersTableRows"),
    publishersTableCount: document.getElementById("publishersTableCount"),
    sheetPage: document.getElementById("sheetPage"),
    categoryPage: document.getElementById("categoryPage"),
    sheetPageTitle: document.getElementById("sheetPageTitle"),
    sheetPageSubtitle: document.getElementById("sheetPageSubtitle"),
    sheetPageSummary: document.getElementById("sheetPageSummary"),
    sheetPageNotes: document.getElementById("sheetPageNotes"),
    targetMonthSelect: document.getElementById("targetMonthSelect"),
    targetCompareMonthSelect: document.getElementById("targetCompareMonthSelect"),
    targetTierFilter: document.getElementById("targetTierFilter"),
    sheetTableTitle: document.getElementById("sheetTableTitle"),
    sheetTableCount: document.getElementById("sheetTableCount"),
    sheetGridHead: document.getElementById("sheetGridHead"),
    sheetGridRows: document.getElementById("sheetGridRows"),
    tierPage: document.getElementById("tierPage"),
    tierPageTitle: document.getElementById("tierPageTitle"),
    tierPageSubtitle: document.getElementById("tierPageSubtitle"),
    tierPageSummary: document.getElementById("tierPageSummary"),
    tierPageNotes: document.getElementById("tierPageNotes"),
    tierCategorySummary: document.getElementById("tierCategorySummary"),
    tierTableTitle: document.getElementById("tierTableTitle"),
    tierTableCount: document.getElementById("tierTableCount"),
    tierPagination: document.getElementById("tierPagination"),
    tierPagePrev: document.getElementById("tierPagePrev"),
    tierPageIndicator: document.getElementById("tierPageIndicator"),
    tierPageNext: document.getElementById("tierPageNext"),
    tierTablePanel: document.getElementById("tierTablePanel"),
    tierExpand: document.getElementById("expandTierSheet"),
    tierOverlayClose: document.getElementById("closeTierSheetOverlay"),
    tierMoveSelected: document.getElementById("moveTierRows"),
    tierResetMoves: document.getElementById("resetTierMoves"),
    tierMoveDialog: document.getElementById("tierMoveDialog"),
    tierMoveSummary: document.getElementById("tierMoveSummary"),
    tierMoveTargets: document.getElementById("tierMoveTargets"),
    tierMoveConfirm: document.getElementById("confirmTierMove"),
    tierMoveCancel: document.getElementById("cancelTierMove"),
    tierMoveClose: document.getElementById("closeTierMoveDialog"),
    tierMoveStatus: document.getElementById("tierMoveStatus"),
    tierMoveInlineStatus: document.getElementById("tierMoveInlineStatus"),
    sheetExpandedBackdrop: document.getElementById("sheetExpandedBackdrop"),
    tierSheetHead: document.getElementById("tierSheetHead"),
    tierSheetRows: document.getElementById("tierSheetRows"),
    tierSheetSearch: document.getElementById("tierSheetSearch"),
    tierStartDate: document.getElementById("tierStartDate"),
    tierEndDate: document.getElementById("tierEndDate"),
    tierDateApply: document.getElementById("tierDateApply"),
    tierDateStatus: document.getElementById("tierDateStatus"),
    tierSheetNetwork: document.getElementById("tierSheetNetwork"),
    tierSheetCountry: document.getElementById("tierSheetCountry"),
    tierSheetMinEpc: document.getElementById("tierSheetMinEpc"),
    tierSheetMinRevenue: document.getElementById("tierSheetMinRevenue"),
    tierColumnToggle: document.getElementById("tierColumnToggle"),
    tierColumnPanel: document.getElementById("tierColumnPanel"),
    tierColumnList: document.getElementById("tierColumnList"),
    tierColumnCore: document.getElementById("tierColumnCore"),
    tierColumnAll: document.getElementById("tierColumnAll"),
    tierNavButtons: Array.from(document.querySelectorAll(".tier-nav-button")),
    paymentSummary: document.getElementById("paymentSummary"),
    paymentRows: document.getElementById("paymentRows"),
    paymentTableCount: document.getElementById("paymentTableCount"),
    paymentStamp: document.getElementById("paymentStamp"),
    paymentSync: document.getElementById("paymentSync"),
    paymentMonth: document.getElementById("paymentMonthFilter"),
    paymentNetwork: document.getElementById("paymentNetworkFilter"),
    paymentRegion: document.getElementById("paymentRegionFilter"),
    paymentTier: document.getElementById("paymentTierFilter"),
    paymentStatus: document.getElementById("paymentStatusFilter"),
    paymentSort: document.getElementById("paymentSortFilter"),
    paymentSearch: document.getElementById("paymentSearch"),
    languageToggle: document.getElementById("languageToggle"),
    deepAnalysisFab: null,
    chatModeToggle: null,
    modeFastBtn: null,
    modeDeepBtn: null
  };

  var _deepPanelIdCounter = 0;
  var _deepPanels = [];
  var _deepMaxZIndex = 1000;
  var _deepCardKeyCounter = 0;
  var _deepReportCache = {};

  const quickPrompts = [
    { key: "quick.aiper", prompt: "Aiper" },
    { key: "quick.beauty", prompt: "Recommend 5 beauty offers" },
    { key: "quick.tier2", prompt: "Tier 2" },
    { key: "quick.unpaid", prompt: "Which offers are unpaid?" },
    { key: "quick.april", prompt: "April unpaid payments" },
    { key: "quick.asin", prompt: "Find ASIN B0D2HKCMBP" }
  ];

  const categoryAliases = {
    beauty: ["beauty", "personal care", "skin", "skin care", "skincare", "facial", "face", "hair", "makeup", "nail", "wrinkle", "anti aging", "anti-aging", "serum", "moisturizer", "sunscreen", "eyelash", "美妆", "美容", "护肤", "个护", "皮肤", "面部", "头发", "彩妆", "指甲", "抗老", "精华", "面霜", "防晒", "睫毛"],
    home: ["home", "kitchen", "furniture", "bedding", "mattress", "office", "chair", "desk", "cookware", "vacuum", "fireplace", "家居", "家用", "厨房", "家具", "床品", "床垫", "办公", "椅子", "桌子", "厨具", "吸尘器", "扫地机器人", "壁炉"],
    pet: ["pet", "dog", "cat", "pet supplies", "宠物", "狗", "猫", "宠物用品"],
    electronics: ["electronics", "tech", "camera", "audio", "robot", "headphone", "earbud", "projector", "smartwatch", "smart watch", "wifi", "usb", "电子", "科技", "数码", "相机", "摄像头", "音频", "耳机", "投影仪", "智能手表", "智能戒指", "路由器", "无线网", "蓝牙"],
    supplement: ["supplement", "health", "vitamin", "nutrition", "wellness", "probiotic", "magnesium", "creatine", "protein", "保健品", "健康", "维生素", "营养", "益生菌", "镁", "肌酸", "蛋白"],
    baby: ["baby", "kid", "kids", "stroller", "母婴", "婴儿", "宝宝", "儿童", "童车", "推车"],
    outdoors: ["sports", "outdoor", "outdoors", "patio", "lawn", "garden", "pool", "camping", "hiking", "fishing", "运动", "户外", "庭院", "草坪", "花园", "泳池", "游泳池", "泳池清洁", "露营", "徒步", "钓鱼"],
    automotive: ["automotive", "car", "vehicle", "汽车", "车载", "车辆"],
    tools: ["tools", "home improvement", "工具", "家装", "五金", "维修"],
    shoes: ["shoes", "sneakers", "loafers", "slippers", "boots", "insoles", "鞋", "鞋子", "运动鞋", "乐福鞋", "拖鞋", "靴", "鞋垫"],
    fashion: ["clothing", "jewelry", "apparel", "fashion", "shirt", "jeans", "dress", "necklace", "服装", "衣服", "珠宝", "饰品", "牛仔裤", "裙子", "项链"],
    pool: ["pool cleaner", "pool cleaners", "robotic pool", "robotic pool cleaner", "泳池机器人", "泳池清洁机器人", "泳池清洁器"]
  };

  const keywordSynonymMap = {
    headphones: ["headphone", "earbuds", "earbud", "earphones", "earphone", "headset", "headsets", "audio", "wireless earbuds", "bluetooth earbuds", "bluetooth headphones", "wireless headphones", "gaming headset", "open-ear headphones", "open ear headphones", "bone conduction"],
    skincare: ["skin care", "skin-care", "skin care products", "skincare products", "facial care", "serum", "toner", "moisturizer", "moisturiser", "sunscreen", "acne", "cleanser", "face wash", "cleansing oil", "cleansing foam", "anti aging", "anti-aging", "face cream", "face moisturizer", "sheet mask", "face mask"],
    "pool cleaner": ["pool cleaners", "pool robot", "pool robots", "robotic pool cleaner", "robotic pool cleaners", "pool vacuum", "pool vacuums", "pool maintenance", "pool cleaning", "泳池机器人", "泳池清洁机器人", "泳池清洁器"],
    vacuum: ["vacuums", "robot vacuum", "robot vacuums", "stick vacuum", "stick vacuums", "cordless vacuum", "cordless vacuums", "cleaning appliance", "cleaning appliances", "vacuum cleaner", "vacuum cleaners"],
    chair: ["chairs", "office chair", "office chairs", "ergonomic chair", "ergonomic chairs", "gaming chair", "gaming chairs", "furniture"],
    supplements: ["supplement", "nutrition", "vitamins", "vitamin", "protein", "probiotic", "probiotics", "health supplement", "health supplements", "creatine", "magnesium"],
    shoes: ["shoe", "footwear", "sneakers", "sneaker", "running shoes", "running shoe", "sandals", "sandal", "boots", "boot", "slippers", "slipper", "insoles", "insole"],
    pet: ["pets", "dog", "dogs", "cat", "cats", "pet food", "dog food", "cat food", "pet supplement", "pet supplements", "pet supplies", "pet products"],
    baby: ["babies", "stroller", "strollers", "baby monitor", "baby monitors", "diaper", "diapers", "nursery", "baby product", "baby products", "kids", "kid"],
    speaker: ["speakers", "audio", "bluetooth speaker", "bluetooth speakers", "soundbar", "sound bar", "soundbars", "karaoke", "microphone", "microphones"]
  };

  const translations = {
    zh: {
      "brand.subtitle": "亚马逊分层分析",
      "nav.dashboard": "仪表盘",
      "nav.payments": "付款",
      "nav.publishers": "媒体",
      "nav.reports": "报表",
      "nav.targets": "目标",
      "nav.category": "品类",
      "sidebar.status": "数据状态",
      "source.backendEpc": "后台 EPC",
      "source.payments": "2-6月付款",
      "source.sheets": "分层逻辑已加载",
      "dashboard.title": "推荐聊天机器人",
      "filters.dashboard": "仪表盘筛选",
      "filter.minEpc": "最低 EPC",
      "filter.minAov": "最低 AOV",
      "filter.minConversion": "最低转化率",
      "filter.minRevenue": "最低收入",
      "filter.unpaidOnly": "仅未付款",
      "filter.pendingOnly": "仅待处理",
      "label.Sort by": "排序字段",
      "label.Direction": "排序方向",
      "action.reset": "重置",
      "action.send": "发送",
      "action.move": "移动",
      "action.select": "选择",
      "action.download": "下载",
      "chat.placeholder": "询问 EPC、分层、AOV、转化率、未付款 offer...",
      "table.offers": "Offer 列表",
      "payments.title": "付款",
      "payments.sync": "同步 Levanta",
      "payments.syncing": "同步中...",
      "payments.records": "付款记录",
      "payments.search": "商家搜索",
      "payments.searchPlaceholder": "商家名称或 ID",
      "publishers.title": "媒体概览",
      "publishers.subtitle": "按市场聚合的媒介表现数据",
      "publishers.network": "所属联盟",
      "publishers.linkType": "链接类型",
      "publishers.merchant": "商家",
      "publishers.merchantPlaceholder": "商家名称或 ID",
      "publishers.product": "商品",
      "publishers.productPlaceholder": "商品 ASIN 或名称",
      "publishers.manager": "媒介经理",
      "publishers.managerPlaceholder": "经理名称",
      "publishers.chartTitle": "按点击量排名",
      "publishers.tableTitle": "媒介数据",
      "publishers.startMonth": "起始日期",
      "publishers.endMonth": "截止日期",
      "publishers.site": "站点",
      "publishers.track": "Track",
      "publishers.empty": "暂无数据",
      "label.All markets": "全市场",
      "label.All": "全部",
      "action.search": "搜索",
      "action.export": "导出",
      "tier.searchPlaceholder": "商家、ID、原因、推荐",
      "tier.networkAgency": "网络 / Agency",
      "label.Brand": "品牌",
      "label.Merchant": "商家",
      "label.Merchant ID": "商家 ID",
      "label.Tier": "分层",
      "label.Network": "网络",
      "label.Region": "地区",
      "label.Category": "品类",
      "label.Month": "月份",
      "label.Status": "状态",
      "label.Search": "搜索",
      "label.Country": "国家",
      "label.Orders": "订单",
      "label.Payment": "付款",
      "label.Move": "移动",
      "label.Highlight": "重点",
      "label.Publisher Count": "Publisher 数量",
      "label.Success Rate": "成功率",
      "label.Tier 2 Optimization Idea": "Tier 2 优化建议",
      "label.Revenue": "收入",
      "label.Commission": "佣金",
      "label.Action": "动作",
      "label.Cycle": "周期",
      "label.Available": "预计收款日期",
      "label.Expected Payment Date": "预计收款日期",
      "label.Payment Made": "付款日期",
      "label.Notes": "备注",
      "label.Records": "记录",
      "label.Merchants": "商家数",
      "label.Columns": "列数",
      "label.Offers": "Offer 数",
      "label.Commission EPC": "佣金 EPC",
      "label.AOV": "AOV",
      "label.CVR": "CVR",
      "label.Revenue made": "产生收入",
      "label.Commission made": "产生佣金",
      "label.Last checked": "上次检查",
      "label.Payment rate": "付款率",
      "label.Paid": "已付款",
      "label.Pending": "待处理",
      "label.Unpaid": "未付款",
      "label.Overdue": "逾期",
      "label.Unpaid risk": "付款风险",
      "label.Unpaid merchants": "未付款商家",
      "label.Pending merchants": "待处理商家",
      "label.Overdue rows": "到期/逾期记录",
      "label.Offers in category": "该品类 Offer",
      "label.Average AOV": "平均 AOV",
      "label.Blended EPC": "综合 EPC",
      "label.Average CVR": "平均 CVR",
      "label.Best by EPC": "EPC 最佳",
      "label.Best by CVR": "CVR 最佳",
      "label.Best by revenue": "收入最佳",
      "label.Best by commission": "佣金最佳",
      "label.Payment risk": "付款风险",
      "label.Caution watch": "注意观察",
      "label.Rows": "行数",
      "label.Brand Count": "品牌数",
      "label.Total Clicks": "总点击",
      "label.Order Count": "订单数",
      "label.New Tier Entries": "新进分层",
      "label.Tier Exits": "退出分层",
      "label.Target": "目标",
      "option.All tiers": "全部分层",
      "option.All networks": "全部网络",
      "option.All regions": "全部地区",
      "option.All categories": "全部品类",
      "option.All months": "全部月份",
      "option.All status": "全部状态",
      "option.All countries": "全部国家",
      "option.US": "美国",
      "option.Canada": "加拿大",
      "option.UK": "英国",
      "option.FR": "法国",
      "option.DE": "德国",
      "option.Paid": "已付款",
      "option.Unpaid": "未付款",
      "option.Pending": "待处理",
      "option.Overdue": "逾期",
      "option.Partial": "部分付款",
      "option.Unknown": "未知",
      "option.Default priority": "默认优先级",
      "option.Ascending": "升序",
      "option.Descending": "降序",
      "move.original": "原始",
      "move.movedFrom": "从原层级移动",
      "option.February": "二月",
      "option.March": "三月",
      "option.April": "四月",
      "option.May": "五月",
      "option.June": "六月",
      "quick.aiper": "Aiper",
      "quick.beauty": "推荐 5 个美妆 offer",
      "quick.tier2": "Tier 2",
      "quick.unpaid": "哪些 offer 未付款？",
      "quick.april": "四月未付款",
      "quick.asin": "查找 ASIN B0D2HKCMBP",
      "context.defaultTitle": "上下文概览",
      "context.defaultSubtitle": "整体 offer 快照",
      "context.recommendationTitle": "推荐概览",
      "context.merchantTitle": "商家数据",
      "context.asinTitle": "ASIN 数据",
      "context.categoryTitle": "品类概览",
      "context.tierTitle": "分层概览",
      "context.paymentTitle": "付款概览",
      "context.generalFiltered": "当前筛选视图",
      "context.basedOn": "基于：",
      "context.noMatches": "没有找到匹配记录。",
      "payment.followup": "需要跟进的商家",
      "payment.none": "无",
      "payment.checkable": "可检查",
      "payment.pending": "未到检查时间",
      "payment.summary": "付款概览",
      "payment.recordsAcross": "条记录，覆盖",
      "payment.merchants": "个商家",
      "payment.unpaid": "未付款",
      "payment.pendingCount": "待处理",
      "payment.overdue": "到期/逾期",
      "payment.cycle": "付款周期",
      "payment.notAvailable": "当前数据不可用",
      "payment.tableCount": "条付款记录匹配",
      "table.offerCount": "个 offer 匹配",
      "dataset.loaded": "个 offers 已加载 / 生成于",
      "payments.stampSaved": "条已保存 Levanta 付款记录 / 可按周期检查 / 检查日期",
      "payments.stampLive": "条 Levanta 实时付款记录 / 检查日期",
      "payments.stampUnavailable": "条已保存 Levanta 付款记录 / 实时 API 不可用 / 检查日期",
      "sheet.targets": "月度目标",
      "sheet.noTargets": "当前表格导出中没有目标行",
      "sheet.noTargetMatch": "当前筛选没有匹配的目标数据。",
      "sheet.targetSummary": "目标和表现汇总",
      "sheet.noTargetNotes": "当前选择没有文字目标备注。",
      "sheet.targetRecords": "月度目标记录",
      "sheet.targetRows": "条目标记录",
      "tier.imported": "从 Google Sheets 导入",
      "tier.notFound": "未找到 Google Sheet 标签页",
      "tier.noMatch": "当前导出中没有找到匹配的 Sheet 标签页。",
      "tier.columnsButton": "显示",
      "tier.columnsTitle": "显示字段",
      "tier.columnsHint": "选择要显示的字段",
      "tier.coreColumns": "默认",
      "tier.allColumns": "全部",
      "language.button.zh": "中文简体",
      "language.button.en": "English",
      "deep.title": "深度分析",
      "deep.export": "导出",
      "deep.close": "关闭",
      "deep.skeleton.step1": "正在理解你的问题…",
      "deep.skeleton.step2": "正在查询数据…",
      "deep.skeleton.step3": "正在生成分析报告…",
      "deep.error": "分析失败，请稍后重试。",
      "deep.mode.fast": "快速模式",
      "deep.mode.deep": "深度推理",
      "deep.placeholder": "输入复杂分析问题（支持对比、趋势、多维分析…）",
      "deep.fast.placeholder": "询问 EPC、分层、AOV、转化率、未付款 offer…",
      "deep.report.defaultTitle": "分析报告",
      "deep.chat.summaryPrefix": "📊 深度分析：",
      "deep.chat.errorPrefix": "📊 深度分析失败：",
      "deep.error.http": "分析请求失败（{status}），请稍后重试。",
      "deep.error.return": "分析返回异常，请稍后重试。",
      "deep.error.network": "网络请求失败，请检查连接后重试。",
      "deep.stop": "停止",
      "deep.stopAborted": "分析已取消。",
      "deep.fab": "🔬"
    }
  };

  function t(key, fallback = key) {
    if (state.language !== "zh") return fallback;
    return translations.zh[key] || fallback;
  }

  function labelText(label) {
    return t(`label.${label}`, label);
  }

  function optionText(value) {
    return t(`option.${value}`, value);
  }

  function statusText(value) {
    return t(`option.${value}`, value || "Unknown");
  }

  function responseLanguageFor(prompt = state.currentQuery) {
    if (chatbotI18n.responseLanguage) return chatbotI18n.responseLanguage(prompt, state.language);
    return state.language === "zh" ? "zh" : "en";
  }

  function chatCopy(language) {
    return chatbotI18n.copy ? chatbotI18n.copy(language) : {};
  }

  function chatFormat(template, values) {
    if (chatbotI18n.format) return chatbotI18n.format(template, values);
    return String(template || "").replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
  }

  function chatLabelText(label, language) {
    if (chatbotI18n.label) return chatbotI18n.label(label, language);
    return language === "zh" ? label : labelText(label);
  }

  function promptHasPaymentTerms(text) {
    return /payment|paid|unpaid|late|issue|cycle|付款|未付款|没付款|已付款|逾期|到期|周期|佣金|欠款|待处理|部分付款/.test(String(text || "").toLowerCase());
  }

  function applyStaticLanguage() {
    document.documentElement.lang = state.language === "zh" ? "zh-Hans" : "en";
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      if (!el.dataset.i18nFallback) el.dataset.i18nFallback = el.textContent;
      el.textContent = t(el.dataset.i18n, el.dataset.i18nFallback);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      if (!el.dataset.i18nPlaceholderFallback) el.dataset.i18nPlaceholderFallback = el.getAttribute("placeholder") || "";
      el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder, el.dataset.i18nPlaceholderFallback));
    });
    if (els.languageToggle) {
      els.languageToggle.textContent = state.language === "zh"
        ? t("language.button.en", "English")
        : t("language.button.zh", "中文简体");
    }
  }

  function syncDashboardOptionLabels() {
    const defaults = [
      [els.tier, "All tiers"],
      [els.network, "All networks"],
      [els.category, "All categories"]
    ];
    defaults.forEach(([select, label]) => {
      const option = select && select.querySelector('option[value="all"]');
      if (option) option.textContent = optionText(label);
    });
  }

  function updateQuickPromptLabels() {
    Array.from(els.quickActions.querySelectorAll("[data-prompt-key]")).forEach((button) => {
      button.textContent = t(button.dataset.promptKey, button.dataset.prompt);
    });
  }

  function setDatasetStamp() {
    els.stamp.textContent = `${offers.length.toLocaleString()} ${t("dataset.loaded", "offers loaded / generated")} ${data.summary.generatedAt || ""}`;
  }

  function setPaymentStamp(mode = "saved", checkedAt = isoDate(PAYMENT_TODAY)) {
    const count = paymentRecords.length.toLocaleString();
    if (mode === "live") {
      els.paymentStamp.textContent = `${count} ${t("payments.stampLive", "live Levanta payment records / checked")} ${checkedAt}`;
      return;
    }
    if (mode === "unavailable") {
      els.paymentStamp.textContent = `${count} ${t("payments.stampUnavailable", "saved Levanta payment records / live API unavailable / checked")} ${checkedAt}`;
      return;
    }
    els.paymentStamp.textContent = `${count} ${t("payments.stampSaved", "saved Levanta payment records / cycle-aware availability / checked")} ${checkedAt}`;
  }

  function rerenderForLanguage() {
    applyStaticLanguage();
    syncDashboardOptionLabels();
    updateQuickPromptLabels();
    refreshPaymentFilterOptions();
    refreshTargetFilters();
    syncControls();
    syncPaymentControls();
    setDatasetStamp();
    setPaymentStamp(state.livePaymentsLoaded ? "live" : "saved");
    if (state.page === "payments") {
      renderPaymentsPage();
    } else if (state.page === "sheets") {
      renderSheetPage();
    } else if (state.page === "tier") {
      renderTierPage(state.selectedTierPage);
    } else {
      renderAll();
      if (state.currentContext.type !== "default") renderContextPanel(state.currentContext);
    }
  }

  function toggleLanguage() {
    state.language = state.language === "zh" ? "en" : "zh";
    localStorage.setItem("offerLanguage", state.language);
    rerenderForLanguage();
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function isAvailable(value) {
    if (value === null || value === undefined) return false;
    if (Array.isArray(value)) return value.length > 0;
    return String(value).trim() !== "";
  }

  function textValue(value) {
    return isAvailable(value) ? String(value) : "not available in current data";
  }

  function money(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return "$" + Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function shortMoney(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return "$" + Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function moneyWithSymbol(value, symbol = "$") {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return `${symbol}${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  function paymentCurrencySymbol(record = {}) {
    const region = normalizeRegion(record.region || record.marketplace || record.country || record.countryCode);
    const currency = String(record.currency || "").trim().toUpperCase();
    if (region === "UK" || currency === "GBP") return "£";
    if (region === "DE" || region === "FR" || currency === "EUR") return "€";
    return "$";
  }

  function paymentMoney(record, value) {
    return moneyWithSymbol(value, paymentCurrencySymbol(record));
  }

  function paymentSummaryMoney(rows, value, regionFilter = "") {
    if (String(regionFilter || "").trim().toLowerCase() === "all") return moneyWithSymbol(value, "$");
    const symbols = new Set(rows.map(paymentCurrencySymbol).filter(Boolean));
    const symbol = symbols.size === 1 ? symbols.values().next().value : "$";
    return moneyWithSymbol(value, symbol || "$");
  }

  function paymentCycleText(offer, fallback = "not available in current data") {
    return offer && offer.paymentCycle ? `${offer.paymentCycle} days` : fallback;
  }

  function pct(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return (Number(value) * 100).toFixed(2) + "%";
  }

  function shortPct(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return (Number(value) * 100).toFixed(2) + "%";
  }

  function shortEpc(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "-";
    return "$" + Number(value).toFixed(3);
  }

  function epc(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return "$" + Number(value).toFixed(3);
  }

  function countValue(value) {
    if (!isAvailable(value) || !Number.isFinite(Number(value))) return "not available in current data";
    return Number(value).toLocaleString();
  }

  function normalize(value) {
    return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  }

  function productKeywordBrandKey(value) {
    return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
  }

  function arrayFromKeywordValue(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value.flatMap(arrayFromKeywordValue);
    return String(value)
      .split(/\s*\|\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function mergeUniqueValues(...groups) {
    const seen = new Set();
    const output = [];
    groups.flatMap(arrayFromKeywordValue).forEach((value) => {
      const key = String(value).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      output.push(value);
    });
    return output;
  }

  function mergeProductKeywordsIntoOffers(baseOffers, keywordData = {}) {
    const rows = Array.isArray(keywordData.merchants) ? keywordData.merchants : [];
    if (!rows.length) return baseOffers;
    const byId = new Map();
    const byBrand = new Map();
    rows.forEach((row) => {
      const merchantId = String(row.merchantId || "").trim();
      const brandKey = row.brandKey || productKeywordBrandKey(row.merchantName);
      if (merchantId && !byId.has(merchantId)) byId.set(merchantId, row);
      if (brandKey && !byBrand.has(brandKey)) byBrand.set(brandKey, row);
    });
    return baseOffers.map((offer) => {
      const merchantId = String(offer.merchantId || "").trim();
      const keywordRow = byId.get(merchantId) || byBrand.get(productKeywordBrandKey(offer.brand || offer.merchantName));
      if (!keywordRow) return offer;
      offer.productAsins = mergeUniqueValues(offer.productAsins, keywordRow.productAsins);
      offer.productTitles = mergeUniqueValues(offer.productTitles, keywordRow.productTitles);
      offer.productKeywords = mergeUniqueValues(offer.productKeywords, keywordRow.productKeywords);
      offer.productNameCount = Number(keywordRow.productNameCount) || offer.productNameCount;
      offer.productAsinCount = Number(keywordRow.productAsinCount) || offer.productAsinCount;
      offer.productKeywordSource = keywordData.summary && keywordData.summary.source ? keywordData.summary.source : "product keyword workbook";
      return offer;
    });
  }

  function canonicalTierName(value) {
    const text = String(value || "").trim().toLowerCase();
    if (text === "black tier" || text === "black") return "BLACK TIER";
    const match = text.match(/tier\s*([1-4])/);
    return match ? `Tier ${match[1]}` : String(value || "").trim();
  }

  function offerKey(offer) {
    return String(offer && (offer.id || `${offer.merchantId || ""}::${normalize(offer.brand)}`));
  }

  function loadTierOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TIER_OVERRIDE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveTierOverrides() {
    localStorage.setItem(TIER_OVERRIDE_KEY, JSON.stringify(tierOverrides));
  }

  function loadTargetOverrides() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TARGET_OVERRIDES_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveTargetOverrides() {
    localStorage.setItem(TARGET_OVERRIDES_KEY, JSON.stringify(state.targetOverrides || {}));
  }

  function loadTierVisibleColumns() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TIER_COLUMN_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveTierVisibleColumns() {
    localStorage.setItem(TIER_COLUMN_KEY, JSON.stringify(state.tierVisibleColumns));
  }

  function applyTierOverrideToOffer(offer) {
    const targetTier = canonicalTierName(tierOverrides[offerKey(offer)]);
    if (TIER_MOVE_OPTIONS.includes(targetTier)) {
      offer.tier = targetTier;
      offer.tierOverride = true;
    } else {
      offer.tier = offer.originalTier || offer.tier || "Unknown";
      offer.tierOverride = false;
    }
    return offer;
  }

  function tierMoveOptionsHtml(currentTier) {
    const current = canonicalTierName(currentTier);
    return TIER_MOVE_OPTIONS.map((tier) => (
      `<option value="${escapeHtml(tier)}"${tier === current ? " selected" : ""}>${escapeHtml(optionText(tier))}</option>`
    )).join("");
  }

  function tierMoveControlHtml(offer) {
    if (!offer) return "";
    const key = offerKey(offer);
    return `<div class="tier-move-control" data-offer-key="${escapeHtml(key)}">
      <select class="tier-move-select" aria-label="Move ${escapeHtml(offer.brand || "brand")} to tier">
        ${tierMoveOptionsHtml(offer.tier)}
      </select>
      <button class="tier-move-button" type="button" data-offer-key="${escapeHtml(key)}">${escapeHtml(t("action.move", "Move"))}</button>
    </div>`;
  }

  function updatePaymentRowsForTierMove() {
    paymentRecords = visiblePaymentRecords(withPendingPaymentPlaceholders(paymentRecords.map(normalizePaymentRecord)));
    rebuildPaymentIndex();
  }

  function setManualTierMoveFromOffer(offer, targetTier) {
    const sourceTier = canonicalTierName(offer && offer.originalTier);
    const tier = canonicalTierName(targetTier);
    const merchantId = String(offer && offer.merchantId || "").trim();
    const key = originalMoveKeyForRecord({ merchantId, sourceTier });
    if (!key || !isTierMoveTarget(sourceTier) || !isTierMoveTarget(tier)) return false;
    if (tier === sourceTier) {
      delete state.manualTierMoves[key];
      return true;
    }
    const original = originalTierSheetRowIndex.get(key);
    state.manualTierMoves[key] = {
      sourceTier,
      targetTier: tier,
      merchantId,
      merchantName: String((offer && offer.brand) || (original && tierRowMerchantName(original.row)) || "").trim(),
      movedAt: localDateKey(new Date())
    };
    return true;
  }

  async function moveOfferToTier(key, targetTier) {
    const offer = offers.find((item) => offerKey(item) === key);
    const tier = canonicalTierName(targetTier);
    if (!offer || !TIER_MOVE_OPTIONS.includes(tier)) return;
    if (tier === canonicalTierName(offer.originalTier)) {
      delete tierOverrides[key];
    } else {
      tierOverrides[key] = tier;
    }
    const syncedCandidate = setManualTierMoveFromOffer(offer, tier);
    saveTierOverrides();
    applyTierOverrideToOffer(offer);
    if (syncedCandidate) {
      persistManualTierMoves();
      applyManualTierMoves();
    }
    updatePaymentRowsForTierMove();
    refreshPaymentFilterOptions();
    setPaymentStamp(state.livePaymentsLoaded ? "live" : "saved");
    if (state.page === "payments") {
      renderPaymentsPage();
    } else if (state.page === "tier") {
      renderTierPage(state.selectedTierPage);
    } else {
      renderAll();
    }
    if (syncedCandidate) {
      setTierMoveStatus(`Moved ${offer.brand || offer.merchantId || "merchant"}; syncing shared data...`);
      const result = await saveSharedTierMoves("replace");
      setTierMoveStatus(result.ok ? `Moved ${offer.brand || offer.merchantId || "merchant"}; synced for everyone` : `Moved ${offer.brand || offer.merchantId || "merchant"} locally only (${result.error})`);
    }
  }

  function handleTierMoveClick(event) {
    const button = event.target.closest(".tier-move-button");
    if (!button) return;
    const wrapper = button.closest(".tier-move-control");
    const select = wrapper && wrapper.querySelector(".tier-move-select");
    moveOfferToTier(button.dataset.offerKey, select ? select.value : "");
  }

  function words(value) {
    return String(value || "").toLowerCase().replace(/&/g, "and").match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  }

  function singularToken(token) {
    const text = String(token || "").toLowerCase();
    if (text.length > 5 && text.endsWith("ies")) return `${text.slice(0, -3)}y`;
    if (text.length > 4 && text.endsWith("s")) return text.slice(0, -1);
    return text;
  }

  const categoryStopWords = new Set([
    "a", "an", "and", "are", "based", "best", "brand", "brands", "category", "for", "from",
    "give", "has", "have", "in", "list", "match", "me", "of", "offer", "offers", "or",
    "please", "pull", "recommend", "recommendation", "recommendations", "show", "that",
    "the", "tier", "to", "top", "want", "with", "推荐", "品牌", "商家", "品类", "类别", "类目",
    "给我", "显示", "列出", "拉取", "下载", "导出", "最好", "最佳", "前", "个", "款", "条"
  ]);

  const keywordStopWords = new Set([
    ...categoryStopWords,
    "about", "all", "around", "candidate", "candidates", "find", "keyword", "keywords",
    "product", "products", "related", "search", "similar", "using", "包含", "相关", "关键词",
    "产品", "商品", "相似", "搜索", "查找"
  ]);

  const skincareProductSignals = [
    "skin care", "skincare", "serum", "toner", "moisturizer", "moisturiser", "sunscreen",
    "cleanser", "face wash", "cleansing oil", "cleansing foam", "face cream", "face moisturizer",
    "lotion", "essence", "ampoule", "exfoliating", "retinol", "hyaluronic acid", "niacinamide",
    "ceramide", "collagen", "pdrn", "snail mucin", "acne", "blackhead", "pimple", "dark spot",
    "redness relief", "skin barrier", "pore care", "toner pad", "face mist", "sheet mask", "face mask",
    "korean skincare", "korean skin care"
  ];

  const nonSkincareDeviceSignals = [
    "hair removal", "laser hair", "ipl", "intense pulsed light", "hair reduction", "permanent hair",
    "permanent hair reduction", "epilator", "depilator", "armpit", "ushr", "sapphire air",
    "ice cooling", "ice-cooling", "body hair", "light hair removal", "laser hair removal", "hair removal device"
  ];

  function meaningfulTokens(value) {
    return words(value)
      .map(singularToken)
      .filter((token) => token.length > 1 && !categoryStopWords.has(token));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function textIncludesAlias(haystack, alias) {
    const term = String(alias || "").toLowerCase().trim();
    if (!term) return false;
    if (/[^\x00-\x7f]/.test(term)) return haystack.includes(term);
    if (term.length <= 3) return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(haystack);
    return haystack.includes(term);
  }

  function cleanCategoryValue(value) {
    const text = String(value || "").trim();
    return text && text !== "Uncategorized" ? text : "";
  }

  function sheetMainCategory(item) {
    if (!item) return "Uncategorized";
    const sheetCategory = cleanCategoryValue(item.sheetCategory);
    if (sheetCategory) return sheetCategory;
    const mainCategory = cleanCategoryValue(item.mainCategory);
    if (mainCategory) return mainCategory;
    const feishuMainCategory = cleanCategoryValue(item.feishuMainCategory);
    if (feishuMainCategory) return feishuMainCategory;
    const category = cleanCategoryValue(item.category);
    if (category && item.categorySource !== "Feishu") return category;
    if (category) return category;
    return cleanCategoryValue(item.levantaCategory) || "Uncategorized";
  }

  function categoryParts(item) {
    return [
      sheetMainCategory(item),
      item && item.sheetCategory,
      item && item.feishuMainCategory,
      item && item.feishuSubCategory,
      item && item.mainCategory,
      item && item.subCategory,
      item && item.mainCategoryCn,
      item && item.subCategoryCn,
      item && item.categoryPath,
      item && item.category,
      item && item.levantaCategory
    ].filter((value) => String(value || "").trim() && String(value).trim() !== "Uncategorized");
  }

  function displayCategory(item) {
    return sheetMainCategory(item);
  }

  function categorySearchText(item) {
    return categoryParts(item).concat(item && item.brand, item && item.merchantName).filter(Boolean).join(" ").toLowerCase();
  }

  let mainCategoryNormsCache = null;

  function uniqueCategoryValues() {
    const values = new Set();
    offers.forEach((offer) => {
      const category = sheetMainCategory(offer);
      if (category !== "Uncategorized") values.add(category);
    });
    return Array.from(values).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  }

  let allCategoryValuesCache = null;

  function allCategoryValues() {
    if (!allCategoryValuesCache) {
      const values = new Set();
      offers.forEach((offer) => {
        categoryParts(offer).forEach((value) => values.add(String(value).trim()));
      });
      allCategoryValuesCache = Array.from(values).sort((a, b) => String(b).length - String(a).length);
    }
    return allCategoryValuesCache;
  }

  function hasMainCategoryValue(category) {
    if (!mainCategoryNormsCache) {
      mainCategoryNormsCache = new Set(uniqueCategoryValues().map((value) => normalize(value)));
    }
    return mainCategoryNormsCache.has(normalize(category));
  }

  function flattenSearchValues(value) {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap(flattenSearchValues);
    if (typeof value === "object") return Object.values(value).flatMap(flattenSearchValues);
    const text = String(value).trim();
    return text ? [text] : [];
  }

  function keywordFieldGroups(offer) {
    return {
      merchant: flattenSearchValues([offer.brand, offer.merchantName, offer.merchantId, offer.id]),
      category: flattenSearchValues(categoryParts(offer)),
      product: flattenSearchValues([
        offer.productType,
        offer.product_type,
        offer.productTitle,
        offer.product_title,
        offer.productName,
        offer.product_name,
        offer.productTitles,
        offer.product_titles,
        offer.title,
        offer.asinTitle,
        offer.asin_title,
        offer.asinTitles,
        offer.productKeywords,
        offer.product_keywords,
        offer.keywords,
        offer.dealInfo,
        offer.discountInfo
      ]),
      asin: flattenSearchValues([offer.topAsins, offer.productAsins, offer.asinsText, offer.feishuCategoryAsin]),
      notes: flattenSearchValues([offer.notes, offer.recommendation, offer.recommendationNotes, offer.reason])
    };
  }

  function valuesMatchingAliases(values, aliases) {
    return (values || []).filter((value) => aliases.some((alias) => searchValueMatches(value, alias)));
  }

  function productTitleValues(offer) {
    return flattenSearchValues([
      offer.productTitle,
      offer.product_title,
      offer.productName,
      offer.product_name,
      offer.productTitles,
      offer.product_titles,
      offer.title,
      offer.asinTitle,
      offer.asin_title,
      offer.asinTitles
    ]);
  }

  function qualifiesAsSkincareBrand(offer) {
    const groups = keywordFieldGroups(offer);
    const productValues = groups.product || [];
    const skincareSignals = valuesMatchingAliases(productValues, skincareProductSignals);
    if (!skincareSignals.length) return false;

    const nonSkincareDeviceSignalsFound = valuesMatchingAliases(productValues, nonSkincareDeviceSignals);
    if (!nonSkincareDeviceSignalsFound.length) return true;

    const titles = productTitleValues(offer);
    const skincareTitleCount = valuesMatchingAliases(titles, skincareProductSignals).length;
    const deviceTitleCount = valuesMatchingAliases(titles, nonSkincareDeviceSignals).length;
    return skincareTitleCount > deviceTitleCount;
  }

  function searchValueMatches(value, alias) {
    const haystack = String(value || "").toLowerCase();
    const term = String(alias || "").toLowerCase().trim();
    const termNorm = normalize(term);
    if (!haystack || !term || !termNorm) return false;
    return textIncludesAlias(haystack, term) || normalize(haystack).includes(termNorm);
  }

  function searchValueExactMatches(value, alias) {
    const text = String(value || "").trim();
    const term = String(alias || "").trim();
    if (!text || !term) return false;
    if (normalize(text) === normalize(term)) return true;
    return searchValueMatches(text, term);
  }

  function keywordAliasEntries() {
    const entries = [];
    Object.entries(keywordSynonymMap).forEach(([canonical, synonyms]) => {
      [canonical, ...synonyms].forEach((alias) => {
        entries.push({ canonical, alias });
      });
    });
    return entries.sort((a, b) => String(b.alias).length - String(a.alias).length);
  }

  function addKeywordAlias(aliases, value) {
    const text = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!text || keywordStopWords.has(text)) return;
    aliases.set(normalize(text), text);
    const tokenList = words(text).map(singularToken).filter((token) => token.length > 1 && !keywordStopWords.has(token));
    if (tokenList.length > 1) aliases.set(normalize(tokenList.join(" ")), tokenList.join(" "));
    if (tokenList.length === 1) aliases.set(normalize(tokenList[0]), tokenList[0]);
  }

  function cleanedKeywordPhrase(text) {
    return cleanedCategoryPhrase(text)
      .replace(/\b(?:find|search|keyword|keywords|product|products|related|similar|about|around|all|matching|match)\b/gi, " ")
      .replace(/搜索|查找|关键词|产品|商品|相关|相似|匹配|全部|所有/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function specificKeywordAliasAllowed(alias, phraseTokens, phrase) {
    const aliasTokens = meaningfulTokens(alias).filter((token) => !keywordStopWords.has(token));
    if (!aliasTokens.length || !phraseTokens.length) return false;
    const phraseNorm = normalize(phrase);
    const aliasNorm = normalize(alias);
    if (aliasNorm.includes(phraseNorm) || phraseNorm.includes(aliasNorm)) return true;
    const overlap = aliasTokens.filter((token) => phraseTokens.includes(token));
    if (overlap.length >= Math.min(2, phraseTokens.length)) return true;
    const lastPhraseToken = phraseTokens[phraseTokens.length - 1];
    return lastPhraseToken && lastPhraseToken.length > 3 && aliasTokens.includes(lastPhraseToken);
  }

  function keywordSearchRequest(prompt) {
    const phrase = cleanedKeywordPhrase(prompt);
    const lower = String(prompt || "").toLowerCase();
    const phraseLower = phrase.toLowerCase();
    const aliases = new Map();
    let canonical = "";
    let matchedAlias = "";
    const phraseTokens = meaningfulTokens(phrase).filter((token) => !keywordStopWords.has(token));
    let restrictToSpecificAlias = false;

    keywordAliasEntries().some((entry) => {
      if (searchValueMatches(phraseLower, entry.alias) || searchValueMatches(lower, entry.alias)) {
        canonical = entry.canonical;
        matchedAlias = entry.alias;
        return true;
      }
      return false;
    });

    if (phrase) addKeywordAlias(aliases, phrase);
    if (canonical) {
      addKeywordAlias(aliases, matchedAlias);
      restrictToSpecificAlias = ["baby", "pet"].includes(canonical) &&
        phraseTokens.length > 1 &&
        normalize(phrase) !== normalize(canonical);
      if (!restrictToSpecificAlias) addKeywordAlias(aliases, canonical);
      (keywordSynonymMap[canonical] || [])
        .filter((alias) => !restrictToSpecificAlias || specificKeywordAliasAllowed(alias, phraseTokens, phrase))
        .forEach((alias) => addKeywordAlias(aliases, alias));
    }

    phraseTokens
      .filter(() => !(canonical && phraseTokens.length > 1))
      .forEach((token) => addKeywordAlias(aliases, token));

    const aliasList = Array.from(aliases.values()).sort((a, b) => b.length - a.length);
    const tokens = meaningfulTokens(aliasList.concat(phrase).join(" ")).filter((token) => !keywordStopWords.has(token));
    const keyword = phrase || canonical || matchedAlias;
    if (!keyword || (!aliasList.length && !tokens.length)) return null;
    return {
      keyword,
      canonical: canonical || "",
      matchedAlias,
      aliases: aliasList,
      primaryAliases: [keyword, canonical, matchedAlias].filter(Boolean),
      synonymAliases: canonical ? (keywordSynonymMap[canonical] || []) : [],
      tokens: Array.from(new Set(tokens)),
      knownKeyword: Boolean(canonical),
      specificKeyword: restrictToSpecificAlias
    };
  }

  function keywordTokenFuzzyScore(groups, request) {
    const tokens = request.tokens || [];
    if (!tokens.length) return 0;
    const haystackTokens = words(Object.values(groups).flat().join(" ")).map(singularToken);
    const matched = tokens.filter((queryToken) => (
      haystackTokens.some((token) => {
        if (token === queryToken) return true;
        if (token.length <= 3 || queryToken.length <= 3) return false;
        if (token.includes(queryToken)) return true;
        if (queryToken.includes(token)) return token.length >= Math.ceil(queryToken.length * 0.75);
        return false;
      })
    ));
    if (matched.length < (tokens.length <= 1 ? 1 : Math.min(2, tokens.length))) return 0;
    return matched.length ? (matched.length / tokens.length) * 260 : 0;
  }

  function keywordAliasIsPrimary(alias, request) {
    const aliasNorm = normalize(alias);
    const primaryNorms = new Set((request.primaryAliases || []).map((value) => normalize(value)).filter(Boolean));
    if (primaryNorms.has(aliasNorm)) return true;
    const primaryTokens = meaningfulTokens((request.primaryAliases || []).join(" ")).filter((token) => !keywordStopWords.has(token));
    const aliasTokens = meaningfulTokens(alias).filter((token) => !keywordStopWords.has(token));
    if (!primaryTokens.length || !aliasTokens.length) return false;
    const overlap = aliasTokens.filter((token) => primaryTokens.includes(token)).length;
    return overlap >= Math.min(primaryTokens.length, primaryTokens.length <= 1 ? 1 : 2);
  }

  function keywordOfferMatch(offer, request) {
    if (!offer || !request) return null;
    if (request.canonical === "skincare" && !qualifiesAsSkincareBrand(offer)) return null;
    const groups = keywordFieldGroups(offer);
    const groupValues = Object.values(groups).flat();
    const categoryValues = groups.category || [];
    const productValues = (groups.product || []).concat(groups.asin || []);
    const primaryAliases = new Set((request.primaryAliases || []).map((alias) => normalize(alias)).filter(Boolean));
    const allAliases = request.aliases || [];
    let best = { score: 0, priority: 99, matchType: "", matchedTerms: [], matchedFields: [] };

    const recordMatch = (priority, baseScore, matchType, alias, field) => {
      const aliasWeight = Math.min(String(alias || "").length, 40);
      const score = baseScore + aliasWeight;
      if (score > best.score || priority < best.priority) {
        best = {
          score,
          priority,
          matchType,
          matchedTerms: [alias],
          matchedFields: [field]
        };
      } else if (score === best.score) {
        best.matchedTerms.push(alias);
        best.matchedFields.push(field);
      }
    };

    allAliases.forEach((alias) => {
      const productExact = productValues.some((value) => searchValueExactMatches(value, alias));
      const categoryExact = categoryValues.some((value) => searchValueExactMatches(value, alias));
      if (productExact || categoryExact || groupValues.some((value) => searchValueExactMatches(value, alias))) {
        const primary = keywordAliasIsPrimary(alias, request);
        recordMatch(primary ? 1 : 3, primary ? 1000 : 660, primary ? "Exact match" : "Synonym match", alias, productExact ? "product" : categoryExact ? "category" : "offer data");
      }
    });

    allAliases.forEach((alias) => {
      if (categoryValues.some((value) => searchValueMatches(value, alias))) {
        const primary = keywordAliasIsPrimary(alias, request);
        recordMatch(primary ? 2 : 3, primary ? 820 : 660, primary ? "Category match" : "Synonym match", alias, "category");
      }
    });

    allAliases.forEach((alias) => {
      const isPrimary = primaryAliases.has(normalize(alias));
      if (!isPrimary && groupValues.some((value) => searchValueMatches(value, alias))) {
        recordMatch(3, 660, "Synonym match", alias, "synonym");
      }
    });

    allAliases.forEach((alias) => {
      if (productValues.some((value) => searchValueMatches(value, alias))) {
        recordMatch(4, 520, "Product/ASIN match", alias, "product");
      }
    });

    const fuzzy = keywordTokenFuzzyScore(groups, request);
    if (!request.specificKeyword && fuzzy >= 120) {
      recordMatch(5, fuzzy, "Fuzzy match", request.tokens.join(", "), "offer text");
    }

    if (!best.score) return null;
    return {
      offer,
      score: best.score,
      priority: best.priority,
      matchType: best.matchType,
      matchedTerms: Array.from(new Set(best.matchedTerms.filter(Boolean))).slice(0, 8),
      matchedFields: Array.from(new Set(best.matchedFields.filter(Boolean))).slice(0, 4)
    };
  }

  function keywordTierPriority(offer, includeTier4 = false, includeBlack = false) {
    if (offer.tier === "Tier 1") return 1;
    if (offer.tier === "Tier 2") return 2;
    if (offer.tier === "Tier 3") return 3;
    if (offer.tier === "Tier 4") return includeTier4 ? 4 : 99;
    if (offer.tier === "BLACK TIER") return includeBlack ? 5 : 100;
    return 50;
  }

  function compareKeywordMatches(a, b, context = {}) {
    const includeTier4 = context.includeTier4 || false;
    const includeBlack = context.includeBlack || false;
    if (context.topMetricRequest) {
      const metricDelta = compareTopMetricRows(a.offer, b.offer, context.topMetricRequest);
      if (metricDelta) return metricDelta;
    }
    return (
      keywordTierPriority(a.offer, includeTier4, includeBlack) - keywordTierPriority(b.offer, includeTier4, includeBlack) ||
      a.priority - b.priority ||
      number(b.score) - number(a.score) ||
      number(b.offer.salesAmount) - number(a.offer.salesAmount) ||
      number(b.offer.orders) - number(a.offer.orders) ||
      number(b.offer.conversionRate) - number(a.offer.conversionRate) ||
      number(b.offer.aov) - number(a.offer.aov) ||
      number(b.offer.epc) - number(a.offer.epc) ||
      String(a.offer.brand || "").localeCompare(String(b.offer.brand || ""), undefined, { numeric: true, sensitivity: "base" })
    );
  }

  function keywordSearchMatches(prompt, options = {}) {
    const request = options.request || keywordSearchRequest(prompt);
    if (!request) return [];
    const includeTier4 = options.includeTier4 || /tier\s*4|retest|第四层|第四级|四层|四级|重测|重新测试/i.test(prompt);
    const includeBlack = options.includeBlack || /black|blocked|黑名单|黑色|屏蔽|暂停/i.test(prompt);
    const tier = options.tier || tierFromPrompt(prompt);
    const metricFilters = options.metricFilters || extractMetricFilters(prompt);
    const topMetricRequest = options.topMetricRequest || null;
    const seen = new Set();
    return offers
      .map((offer) => keywordOfferMatch(offer, request))
      .filter(Boolean)
      .filter((match) => !tier || match.offer.tier === tier)
      .filter((match) => includeTier4 || match.offer.tier !== "Tier 4")
      .filter((match) => includeBlack || match.offer.tier !== "BLACK TIER")
      .filter((match) => !metricFilters.length || applyMetricFilters([match.offer], metricFilters).length)
      .filter((match) => {
        const key = offerIdentityKey(match.offer);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => compareKeywordMatches(a, b, { includeTier4, includeBlack, topMetricRequest }));
  }

  function hasDirectMerchantKeywordLookup(prompt) {
    const lookup = merchantLookupForPrompt(prompt);
    const first = lookup.matches[0];
    if (!first) return false;
    const cleanedNorm = normalize(lookup.cleaned);
    const brandNorm = normalize(first.offer.brand);
    const id = String(first.offer.merchantId || "").trim();
    if (!cleanedNorm || !brandNorm) return false;
    return (id && cleanedNorm === normalize(id)) ||
      brandNorm === cleanedNorm ||
      brandNorm.startsWith(cleanedNorm) ||
      brandNorm.includes(cleanedNorm) ||
      cleanedNorm.includes(brandNorm);
  }

  function hasKeywordSearchIntent(prompt, request, context = {}) {
    if (!request) return false;
    if (findByAsin(prompt) || findByMerchantId(prompt) || extractPaymentCycleFilter(prompt) || promptHasPaymentTerms(prompt)) return false;
    if (request.knownKeyword) return true;
    if (hasDirectMerchantKeywordLookup(prompt)) return false;
    if (context.category && hasMainCategoryValue(context.category) && normalize(context.category) === normalize(request.keyword)) return false;
    if (keywordSearchMatches(prompt).some((match) => (match.matchedFields || []).includes("product"))) return true;
    return wantsRecommendationList(prompt) ||
      /\b(?:find|search|keyword|keywords|related|similar|matching)\b/i.test(prompt) ||
      /搜索|查找|找|关键词|相关|相似|匹配/.test(prompt);
  }

  function dateOnly(value) {
    if (!value) return null;
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function localDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function isoDate(date) {
    return localDateKey(date);
  }

  function monthNameFromText(value) {
    const zhMonth = chatbotI18n.monthNameFromText && chatbotI18n.monthNameFromText(value);
    if (zhMonth) return zhMonth;
    const text = String(value || "").toLowerCase();
    const direct = PAYMENT_MONTHS.find((month) => textIncludesAlias(text, month.toLowerCase()));
    if (direct) return direct;
    const zhMonths = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];
    const zhDirect = zhMonths.findIndex((month) => text.includes(month));
    if (zhDirect >= 0) return PAYMENT_MONTHS[zhDirect];
    const numericMonth = text.match(/(?:^|[^0-9])([1-9]|1[0-2])\s*(?:月|月份)/);
    if (numericMonth) return PAYMENT_MONTHS[Number(numericMonth[1]) - 1];
    const key = text.match(/\b2026-(0[1-9]|1[0-2])\b/);
    if (key) return PAYMENT_MONTHS[Number(key[1]) - 1];
    return null;
  }

  function monthKey(record) {
    if (record.reportMonthKey) return record.reportMonthKey;
    const month = monthNameFromText(record.reportMonth);
    const index = PAYMENT_MONTHS.indexOf(month);
    const year = Number(record.reportYear || 2026);
    return index >= 0 ? `${year}-${String(index + 1).padStart(2, "0")}` : "";
  }

  function addDaysIso(date, days) {
    const copy = new Date(date.getTime());
    copy.setUTCDate(copy.getUTCDate() + Number(days || 0));
    return copy.toISOString().slice(0, 10);
  }

  function calculatePaymentAvailabilityDate(recordOrMonth, year = 2026) {
    const month = typeof recordOrMonth === "string" ? monthNameFromText(recordOrMonth) : monthNameFromText(recordOrMonth.reportMonth || recordOrMonth.reportMonthKey);
    const reportYear = typeof recordOrMonth === "object" ? Number(recordOrMonth.reportYear || year) : Number(year);
    const index = PAYMENT_MONTHS.indexOf(month);
    if (index < 0) return "";
    const cycle = typeof recordOrMonth === "object" ? number(recordOrMonth.paymentCycle) : 0;
    if (cycle > 0) {
      return addDaysIso(new Date(Date.UTC(reportYear, index, 2)), cycle);
    }
    const date = new Date(Date.UTC(reportYear, index + 2, 3));
    return date.toISOString().slice(0, 10);
  }

  function normalizePaymentCycle(value, network) {
    if (String(network || "").trim().toLowerCase() === "wayward") return 105;
    const cycle = number(value);
    return cycle > 0 ? Math.round(cycle) : 60;
  }

  function paymentCycleKeys(merchantId, merchantName) {
    const keys = [];
    const id = String(merchantId || "").trim();
    const name = normalize(merchantName);
    if (id) keys.push(`id:${id}`);
    if (name) keys.push(`name:${name}`);
    return keys;
  }

  function buildSheetPaymentCycleIndex() {
    const cycles = new Map();
    (sheetReport.sheets || []).forEach((sheet) => {
      (sheet.rows || []).forEach((row) => {
        const cycle = number(row["Payment Cycle"]);
        if (cycle <= 0) return;
        paymentCycleKeys(row["Merchant ID"] || row["Merchant Id"] || row.merchantId, row["Merchant Name"] || row.Brand || row.brand)
          .forEach((key) => cycles.set(key, Math.round(cycle)));
      });
    });
    return cycles;
  }

  function sheetPaymentCycleFor(merchantId, merchantName) {
    for (const key of paymentCycleKeys(merchantId, merchantName)) {
      const cycle = sheetPaymentCycles.get(key);
      if (cycle > 0) return cycle;
    }
    return 0;
  }

  function explicitPaymentCycleFrom(source) {
    if (!source) return 0;
    const keys = [
      "paymentCycle",
      "payment_cycle",
      "paymentCycleDays",
      "payment_cycle_days",
      "paymentTermDays",
      "payment_terms_days",
      "paymentTermsDays",
      "paymentDelayDays",
      "payoutDelayDays",
      "netDays",
      "net_days"
    ];
    for (const key of keys) {
      const cycle = number(source[key]);
      if (cycle > 0) return Math.round(cycle);
    }
    return 0;
  }

  function resolveOfferPaymentCycle(offer) {
    const sheetCycle = sheetPaymentCycleFor(offer && offer.merchantId, offer && offer.brand);
    if (sheetCycle > 0) return normalizePaymentCycle(sheetCycle, offer && offer.network);
    return normalizePaymentCycle(null, offer && offer.network);
  }

  function inferRegionFromText(value) {
    const text = String(value || "");
    const match = text.match(/(?:^|[\s()[\]-])(US|USA|UK|GB|DE|FR|CA|AU)(?:$|[\s()[\]-])/i);
    if (!match) return "";
    return match[1];
  }

  function normalizeRegion(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const marketplace = raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split(/[/?#]/)[0]
      .toLowerCase();
    const compact = marketplace.replace(/[^a-z0-9.]+/g, "");
    const aliases = {
      "amazon.com": "US",
      com: "US",
      us: "US",
      usa: "US",
      unitedstates: "US",
      "amazon.ca": "Canada",
      ca: "Canada",
      can: "Canada",
      canada: "Canada",
      "amazon.co.uk": "UK",
      "amazon.uk": "UK",
      "co.uk": "UK",
      uk: "UK",
      gb: "UK",
      gbr: "UK",
      unitedkingdom: "UK",
      "amazon.fr": "FR",
      fr: "FR",
      fra: "FR",
      france: "FR",
      "amazon.de": "DE",
      de: "DE",
      deu: "DE",
      germany: "DE",
      deutschland: "DE"
    };
    return aliases[compact] || raw.toUpperCase();
  }

  function paymentRegionFor(record, matchedOffer = {}) {
    return normalizeRegion(
      record.region ||
      record.marketplace ||
      record.marketPlace ||
      record.market ||
      record.country ||
      record.countryCode ||
      matchedOffer.region ||
      matchedOffer.country ||
      inferRegionFromText(record.merchantName || record.brand || matchedOffer.brand)
    );
  }

  function bestPaymentOffer(candidates) {
    return candidates
      .filter(Boolean)
      .sort((a, b) => (
        tierPriority(a, true, true) - tierPriority(b, true, true) ||
        number(b.salesAmount) - number(a.salesAmount) ||
        String(a.brand || "").localeCompare(String(b.brand || ""))
      ))[0] || null;
  }

  function isSafeBrandMatch(offerBrand, merchantName) {
    if (!offerBrand || !merchantName) return false;
    if (offerBrand === merchantName) return true;
    const shorter = Math.min(offerBrand.length, merchantName.length);
    const longer = Math.max(offerBrand.length, merchantName.length);
    return shorter >= 5 && shorter / longer >= 0.65 && (offerBrand.includes(merchantName) || merchantName.includes(offerBrand));
  }

  function resolvePaymentCycle(record, matchedOffer, network) {
    const sheetCycle = sheetPaymentCycleFor(
      (record && record.merchantId) || (matchedOffer && matchedOffer.merchantId),
      (record && (record.merchantName || record.brand)) || (matchedOffer && matchedOffer.brand)
    );
    if (sheetCycle > 0) return normalizePaymentCycle(sheetCycle, (matchedOffer && matchedOffer.network) || network);
    const apiCycle = explicitPaymentCycleFrom(record);
    if (apiCycle > 0) return normalizePaymentCycle(apiCycle, network || (matchedOffer && matchedOffer.network));
    return normalizePaymentCycle(null, network || (matchedOffer && matchedOffer.network));
  }

  function offerForMerchant(merchantId, merchantName) {
    const cleanId = String(merchantId || "").trim();
    if (cleanId) {
      const byId = bestPaymentOffer(offers.filter((offer) => String(offer.merchantId || "").trim() === cleanId));
      if (byId) return byId;
    }
    const cleanName = normalize(merchantName);
    if (!cleanName) return null;
    const exact = bestPaymentOffer(offers.filter((offer) => normalize(offer.brand) === cleanName));
    if (exact) return exact;
    return bestPaymentOffer(offers.filter((offer) => isSafeBrandMatch(normalize(offer.brand), cleanName)));
  }

  function paymentDueDate(record, cycleOverride) {
    const cycle = cycleOverride === undefined
      ? Math.max(60, normalizePaymentCycle(record.paymentCycle, record.network))
      : Number(cycleOverride);
    const computed = calculatePaymentAvailabilityDate({ ...record, paymentCycle: cycle });
    return dateOnly(computed || record.expectedPaymentDate || record.paymentAvailabilityDate);
  }

  function calculatePaymentStatus(record) {
    const raw = String(record.rawStatus || record.paymentStatus || "").toLowerCase();
    const expected = number(record.expectedPaymentAmount ?? record.commissionMade);
    const paid = number(record.paidAmount);
    const remaining = Math.max(0, number(record.remainingAmount ?? (expected - paid)));
    const baselineDate = paymentDueDate(record, 60);
    const cycleDate = paymentDueDate(record);
    const pastBaseline = baselineDate ? PAYMENT_TODAY > baselineDate : false;
    const pastCycle = cycleDate ? PAYMENT_TODAY > cycleDate : false;

    if (raw === "paid" || (expected > 0 && paid >= expected - 0.01 && !raw.includes("late") && !raw.includes("unpaid"))) return "Paid";
    if (expected <= 0 && paid <= 0) {
      if (raw.includes("pending")) return "Pending";
      return "Unknown";
    }
    if (!pastBaseline) return "Pending";
    if (pastCycle && remaining > 0.01) return "Overdue";
    if (paid > 0 && remaining > 0.01) return "Partial";
    if (raw.includes("pending") || raw.includes("late") || raw.includes("unpaid") || remaining > 0.01) return "Unpaid";
    return "Unknown";
  }

  function firstRecordNumber(record, keys) {
    for (const key of keys) {
      if (record[key] === undefined || record[key] === null || record[key] === "") continue;
      return number(record[key]);
    }
    return null;
  }

  function normalizePaymentRecord(record) {
    const revenueMade = firstRecordNumber(record, ["revenueMade", "sales", "revenue", "salesAmount", "totalSales"]) ?? 0;
    const directCommissionMade = firstRecordNumber(record, ["commissionMade", "totalCommission", "commissionOwed", "expectedPaymentAmount"]);
    const rawCommission = firstRecordNumber(record, ["commission"]);
    const cpcCommission = firstRecordNumber(record, ["cpcCommission", "cpc_commission"]) ?? 0;
    const commissionMade = directCommissionMade ?? ((rawCommission ?? 0) + cpcCommission);
    const expected = number(record.expectedPaymentAmount ?? commissionMade);
    const paid = number(record.paidAmount);
    const remaining = Math.max(0, number(record.remainingAmount ?? (expected - paid)));
    const sourceMerchantId = String(record.merchantId || "").trim();
    const matchedOffer = offerForPaymentMerchant(record) || {};
    const network = record.network || matchedOffer.network || "Levanta";
    const matchedMerchantId = String(matchedOffer.merchantId || "").trim();
    const useMatchedLevantaId = normalize(network) === "levanta" && matchedMerchantId;
    // 不同站点的 merchantId 本来就是不同的，不要用 offer 的 merchantId 覆盖源数据
    const merchantId = sourceMerchantId || matchedMerchantId;
    const region = paymentRegionFor(record, matchedOffer);
    const levantaBrandId = record.levantaBrandId || "";
    const normalized = {
      ...record,
      merchantId,
      levantaBrandId,
      merchantName: String(record.merchantName || record.brand || "").trim(),
      network,
      region,
      tier: paymentMetadataValue(record.tier, matchedOffer.tier, "Unknown"),
      category: paymentMetadataValue(record.category, matchedOffer.category || matchedOffer.levantaCategory, "Uncategorized"),
      categoryPath: paymentMetadataValue(record.categoryPath, matchedOffer.categoryPath, ""),
      mainCategory: paymentMetadataValue(record.mainCategory, matchedOffer.mainCategory, ""),
      subCategory: paymentMetadataValue(record.subCategory, matchedOffer.subCategory, ""),
      mainCategoryCn: paymentMetadataValue(record.mainCategoryCn, matchedOffer.mainCategoryCn, ""),
      subCategoryCn: paymentMetadataValue(record.subCategoryCn, matchedOffer.subCategoryCn, ""),
      reportMonth: record.reportMonth || monthNameFromText(record.reportMonthKey) || "Unknown",
      reportYear: Number(record.reportYear || 2026),
      reportMonthKey: record.reportMonthKey || monthKey(record),
      revenueMade,
      commissionMade,
      expectedPaymentAmount: expected,
      paidAmount: paid,
      remainingAmount: remaining,
      paymentCycle: resolvePaymentCycle(record, matchedOffer, network),
      lastCheckedDate: record.lastCheckedDate || data.summary.generatedAt || "",
      paymentMadeDate: String(record.paymentMadeDate || "").slice(0, 10),
      notes: record.notes || ""
    };
    normalized.paymentAvailabilityDate = calculatePaymentAvailabilityDate(normalized) || record.paymentAvailabilityDate || "";
    normalized.expectedPaymentDate = normalized.paymentAvailabilityDate;
    normalized.paymentStatus = calculatePaymentStatus(normalized);
    if (normalized.paymentStatus === "Paid" && !normalized.paymentMadeDate) {
      normalized.paymentMadeDate = String(record.lastCheckedDate || data.summary?.paymentLastCheckedAt || data.summary?.generatedAt || "").slice(0, 10);
    }
    return normalized;
  }

  function paymentMetadataValue(recordValue, matchedValue, fallback) {
    const text = String(recordValue || "").trim();
    const generic = ["unknown", "uncategorized"].includes(normalize(text));
    if (text && !generic) return recordValue;
    return matchedValue || recordValue || fallback;
  }

  function offerForPaymentMerchant(record) {
    const merchantId = String(record.merchantId || "").trim();
    if (merchantId) {
      const byId = offers.find((offer) => String(offer.merchantId || "").trim() === merchantId);
      if (byId && (normalize(record.network) !== "levanta" || normalize(byId.network) === "levanta")) return byId;
    }
    const merchantName = normalize(record.merchantName || record.brand);
    if (!merchantName) return null;
    const exactMatches = offers.filter((offer) => normalize(offer.brand) === merchantName);
    if (normalize(record.network) === "levanta") {
      const levantaMatch = exactMatches.find((offer) => normalize(offer.network) === "levanta");
      if (levantaMatch) return levantaMatch;
    }
    if (exactMatches.length) return exactMatches[0];
    const fuzzyMatches = offers.filter((offer) => {
      const brand = normalize(offer.brand);
      return brand && (brand === merchantName || brand.includes(merchantName) || merchantName.includes(brand));
    });
    if (normalize(record.network) === "levanta") {
      const levantaFuzzyMatch = fuzzyMatches.find((offer) => normalize(offer.network) === "levanta");
      if (levantaFuzzyMatch) return levantaFuzzyMatch;
    }
    return fuzzyMatches[0] || null;
  }

  function paymentMerchantKey(record) {
    return String(record.merchantId || normalize(record.merchantName || record.brand)).trim();
  }

  function paymentRecordKey(record) {
    return [
      paymentMerchantKey(record) || String(record.levantaBrandId || "").trim(),
      record.reportMonthKey || monthKey(record),
      normalizeRegion(record.region || record.marketplace || "")
    ].join("::");
  }

  function mergePaymentMadeDates(records, previousRecords, checkedAt) {
    const previousByKey = new Map((previousRecords || []).map((record) => [paymentRecordKey(record), record]));
    const detectedDate = String(checkedAt || isoDate(PAYMENT_TODAY)).slice(0, 10);
    return (records || []).map((record) => {
      const previous = previousByKey.get(paymentRecordKey(record));
      const previousDate = String((previous && previous.paymentMadeDate) || "").slice(0, 10);
      if (record.paymentStatus === "Paid") {
        const firstKnownDate = previous && previous.paymentStatus === "Paid"
          ? previousDate || String(previous.lastCheckedDate || "").slice(0, 10)
          : previousDate;
        return { ...record, paymentMadeDate: firstKnownDate || record.paymentMadeDate || detectedDate };
      }
      return previousDate ? { ...record, paymentMadeDate: previousDate } : record;
    });
  }

  function paymentMadeDateText(record) {
    if (!record || record.paymentStatus !== "Paid") return "-";
    return String(record.paymentMadeDate || "").slice(0, 10) || "-";
  }

  function createPendingPaymentRecord(source, month) {
    const monthIndex = PAYMENT_MONTHS.indexOf(month);
    const reportYear = Number(source.reportYear || 2026);
    const offer = offerForPaymentMerchant(source) || {};
    const merchantId = String(source.merchantId || offer.merchantId || "").trim();
    const merchantName = String(source.merchantName || source.brand || offer.brand || merchantId || "Unknown merchant").trim();
    const network = source.network || offer.network || "Levanta";
    const paymentCycle = resolvePaymentCycle(source, offer, network);
    const record = {
      id: `${merchantId || normalize(merchantName)}::${reportYear}-${String(monthIndex + 1).padStart(2, "0")}::pending-placeholder`,
      merchantId,
      merchantName,
      network,
      region: paymentRegionFor(source, offer),
      tier: source.tier || offer.tier || "Unknown",
      category: source.category || offer.category || offer.levantaCategory || "Uncategorized",
      categoryPath: source.categoryPath || offer.categoryPath || "",
      mainCategory: source.mainCategory || offer.mainCategory || "",
      subCategory: source.subCategory || offer.subCategory || "",
      mainCategoryCn: source.mainCategoryCn || offer.mainCategoryCn || "",
      subCategoryCn: source.subCategoryCn || offer.subCategoryCn || "",
      reportMonth: month,
      reportYear,
      reportMonthKey: `${reportYear}-${String(monthIndex + 1).padStart(2, "0")}`,
      revenueMade: 0,
      commissionMade: 0,
      expectedPaymentAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
      paymentCycle,
      rawStatus: "pending",
      lastCheckedDate: isoDate(PAYMENT_TODAY),
      currency: source.currency || "USD",
      isPlaceholder: true,
      notes: "No Levanta invoice row found yet; marked pending until the month becomes payable or Levanta returns a final status."
    };
    record.paymentAvailabilityDate = calculatePaymentAvailabilityDate(record);
    record.expectedPaymentDate = record.paymentAvailabilityDate;
    record.paymentStatus = "Pending";
    return normalizePaymentRecord(record);
  }

  function withPendingPaymentPlaceholders(records) {
    const normalized = records.map(normalizePaymentRecord);
    const existingKeys = new Set(normalized.map((record) => `${paymentMerchantKey(record)}::${record.reportMonthKey}`));
    const merchants = Array.from(new Map(normalized
      .filter((record) => paymentMerchantKey(record))
      .map((record) => [paymentMerchantKey(record), record])).values());
    const additions = [];

    merchants.forEach((merchant) => {
      ACTIVE_PAYMENT_MONTHS.forEach((month) => {
        const monthIndex = PAYMENT_MONTHS.indexOf(month);
        if (monthIndex < 0) return;
        const key = `${paymentMerchantKey(merchant)}::2026-${String(monthIndex + 1).padStart(2, "0")}`;
        if (existingKeys.has(key)) return;
        additions.push(createPendingPaymentRecord(merchant, month));
        existingKeys.add(key);
      });
    });

    return normalized.concat(additions);
  }

  function rebuildPaymentIndex() {
    paymentRecordsByMerchant.clear();
    paymentRecords.forEach((record) => {
      const key = String(record.merchantId || record.merchantName || "").trim();
      if (!key) return;
      if (!paymentRecordsByMerchant.has(key)) paymentRecordsByMerchant.set(key, []);
      paymentRecordsByMerchant.get(key).push(record);
    });
  }

  function getPaymentRecords() {
    return paymentRecords
      .map((record) => ({ ...record, paymentStatus: calculatePaymentStatus(record) }))
      .filter(isTrackablePaymentRecord);
  }

  function hasPaymentRevenueOrCommission(record) {
    return number(record.revenueMade) > 0 || number(record.commissionMade) > 0;
  }

  function visiblePaymentRecords(records) {
    return (records || []).map(normalizePaymentRecord).filter(isTrackablePaymentRecord);
  }

  function hasPayablePaymentAmount(record) {
    return (
      number(record.commissionMade) > 0 ||
      number(record.expectedPaymentAmount) > 0 ||
      number(record.paidAmount) > 0 ||
      number(record.remainingAmount) > 0
    );
  }

  function isTrackablePaymentRecord(record) {
    return hasPaymentRevenueOrCommission(record);
  }

  function getPaymentByMerchant(merchant) {
    const key = normalize(merchant);
    return getPaymentRecords().filter((record) => (
      normalize(record.merchantId) === key ||
      normalize(record.merchantName) === key ||
      normalize(record.merchantName).includes(key) ||
      normalize(record.merchantId).includes(key)
    ));
  }

  function getPaymentByMonth(reportMonth) {
    const month = monthNameFromText(reportMonth);
    const key = String(reportMonth || "");
    return getPaymentRecords().filter((record) => (
      (month && record.reportMonth === month) ||
      record.reportMonthKey === key
    ));
  }

  function getPaymentByStatus(status) {
    const wanted = String(status || "").toLowerCase();
    return getPaymentRecords().filter((record) => record.paymentStatus.toLowerCase() === wanted);
  }

  function getUnpaidPayments() {
    return getPaymentByStatus("Unpaid");
  }

  function getPendingPayments() {
    return getPaymentByStatus("Pending");
  }

  function isPaymentOverdue(record) {
    const dueDate = paymentDueDate(record);
    return Boolean(dueDate && PAYMENT_TODAY > dueDate && number(record.remainingAmount) > 0 && record.paymentStatus !== "Paid");
  }

  function getOverduePayments() {
    return getPaymentRecords().filter(isPaymentOverdue);
  }

  function updatePaymentSummary(rows = getPaymentRecords()) {
    const merchantIds = new Set(rows.map((record) => record.merchantId || record.merchantName).filter(Boolean));
    const unpaidMerchants = new Set(rows.filter((record) => record.paymentStatus === "Unpaid").map((record) => record.merchantId || record.merchantName));
    const pendingMerchants = new Set(rows.filter((record) => record.paymentStatus === "Pending").map((record) => record.merchantId || record.merchantName));
    const paidMerchants = new Set(rows.filter((record) => record.paymentStatus === "Paid").map((record) => record.merchantId || record.merchantName));
    const overdueRows = rows.filter(isPaymentOverdue);
    const overdueMerchants = new Set(overdueRows.map((record) => record.merchantId || record.merchantName).filter(Boolean));
    return {
      recordCount: rows.length,
      merchantCount: merchantIds.size,
      totalRevenueMade: rows.reduce((sum, record) => sum + number(record.revenueMade), 0),
      totalCommissionMade: rows.reduce((sum, record) => sum + number(record.commissionMade), 0),
      totalExpectedPayment: rows.reduce((sum, record) => sum + number(record.expectedPaymentAmount), 0),
      totalPaidAmount: rows.reduce((sum, record) => sum + number(record.paidAmount), 0),
      totalRemainingAmount: rows.reduce((sum, record) => sum + number(record.remainingAmount), 0),
      totalUnpaidAmount: rows.filter((record) => record.paymentStatus === "Unpaid").reduce((sum, record) => sum + number(record.remainingAmount), 0),
      totalPendingAmount: rows.filter((record) => record.paymentStatus === "Pending").reduce((sum, record) => sum + number(record.remainingAmount), 0),
      totalPartialAmount: rows.filter((record) => record.paymentStatus === "Partial").reduce((sum, record) => sum + number(record.remainingAmount), 0),
      unpaidMerchantCount: unpaidMerchants.size,
      pendingMerchantCount: pendingMerchants.size,
      paidMerchantCount: paidMerchants.size,
      paymentRate: merchantIds.size ? paidMerchants.size / merchantIds.size : 0,
      overdueMerchantCount: overdueMerchants.size,
      overdueCount: overdueRows.length
    };
  }

  function syncLevantaPayments() {
    const summary = updatePaymentSummary(getPaymentRecords());
    return {
      status: "file-based",
      checkedAt: isoDate(PAYMENT_TODAY),
      summary
    };
  }

  async function refreshLevantaPayments(options = {}) {
    if (state.livePaymentsLoading) return;
    state.livePaymentsLoading = true;
    if (els.paymentSync) {
      els.paymentSync.disabled = true;
      els.paymentSync.textContent = t("payments.syncing", "Syncing...");
    }
    try {
      const response = await fetch("/api/levanta/payments", { cache: "no-store" });
      if (!response.ok) throw new Error(`Levanta API sync returned ${response.status}`);
      const payload = await response.json();
      if (!payload.records || !payload.records.length) throw new Error("Levanta API returned no payment records");
      const checkedAt = String(payload.checkedAt || "").slice(0, 10) || isoDate(PAYMENT_TODAY);
      const incomingRecords = visiblePaymentRecords(withPendingPaymentPlaceholders(payload.records.map(normalizePaymentRecord)));
      paymentRecords = mergePaymentMadeDates(incomingRecords, paymentRecords, checkedAt);
      rebuildPaymentIndex();
      state.paymentSource = "Levanta API";
      state.livePaymentsLoaded = true;
      if (options.auto) localStorage.setItem(AUTO_PAYMENT_SYNC_KEY, String(Date.now()));
      refreshPaymentFilterOptions();
      syncPaymentControls();
      setPaymentStamp("live", checkedAt);
      renderPaymentsPage();
      if (state.currentContext.type === "payment") {
        setContext(buildPaymentContext(getFilteredPayments().slice(0, 60), state.currentQuery || "Payment sync"));
      }
    } catch (error) {
      state.paymentSource = "saved invoice file";
      setPaymentStamp("unavailable", isoDate(PAYMENT_TODAY));
      if (!options.silent) {
        addMessage("assistant", `I could not reach the live Levanta API from this server, so I kept the saved invoice data loaded. The server needs <strong>LEVANTA_API_KEY</strong> configured for live sync.`);
      }
      renderPaymentsPage();
    } finally {
      if (els.paymentSync) {
        els.paymentSync.disabled = false;
        els.paymentSync.textContent = t("payments.sync", "Sync Levanta");
      }
      state.livePaymentsLoading = false;
    }
  }

  function maybeAutoSyncLevantaPayments() {
    const lastSync = Number(localStorage.getItem(AUTO_PAYMENT_SYNC_KEY) || 0);
    if (state.livePaymentsLoading) return;
    if (state.livePaymentsLoaded && Number.isFinite(lastSync) && Date.now() - lastSync < AUTO_PAYMENT_SYNC_INTERVAL_MS) return;
    refreshLevantaPayments({ silent: true, auto: true });
  }

  function paymentRecordsForOffer(offer) {
    const byId = paymentRecordsByMerchant.get(String(offer.merchantId || "").trim()) || [];
    if (byId.length) return byId;
    const brandKey = normalize(offer.brand);
    if (!brandKey) return [];
    return paymentRecords.filter((record) => normalize(record.merchantName) === brandKey);
  }

  function hasOfferOverduePayment(offer) {
    return paymentRecordsForOffer(offer).some(isPaymentOverdue);
  }

  function paymentRiskTextForOffer(offer) {
    const overdue = paymentRecordsForOffer(offer).filter(isPaymentOverdue);
    if (overdue.length) {
      const total = overdue.reduce((sum, record) => sum + number(record.remainingAmount), 0);
      const months = Array.from(new Set(overdue.map((record) => record.reportMonth))).join(", ");
      return `${months} overdue payment (${shortMoney(total)} remaining)`;
    }
    return offer.paymentStatus || "payment risk";
  }

  function hasPaymentRisk(offer) {
    return Boolean(offer.paymentRisk || offer.paymentState === "unpaid" || hasOfferOverduePayment(offer));
  }

  function hasPaidSignal(offer) {
    return offer.paymentState === "paid" || paymentRecordsForOffer(offer).some((record) => record.paymentStatus === "Paid");
  }

  function tierGroup(offer) {
    const tier = offer.tier || "";
    const reason = `${offer.reason || ""} ${offer.recommendation || ""}`.toLowerCase();
    if (tier === "BLACK TIER") return "Black Tier";
    if (tier === "Tier 1") return "Tier 1";
    if (tier === "Tier 2" && /manual keep|monitor|underperformance|declined|watch|careful/.test(reason)) return "Tier 2 Watch";
    if (tier === "Tier 2") return "Core Tier 2";
    if (tier === "Tier 3") return "Tier 3";
    if (tier === "Tier 4") return "Tier 4";
    return tier || "Unknown";
  }

  function tierPriority(offer, includeTier4 = false, includeBlack = false) {
    const group = tierGroup(offer);
    if (group === "Tier 1") return 1;
    if (group === "Core Tier 2") return 2;
    if (group === "Tier 2 Watch") return 3;
    if (group === "Tier 3") return 4;
    if (group === "Tier 4") return includeTier4 ? 5 : 99;
    if (group === "Black Tier") return includeBlack ? 6 : 100;
    return 50;
  }

  function highlightStatus(offer) {
    const group = tierGroup(offer);
    const phase = String(offer.phase || "").toLowerCase();
    if (group === "Tier 1") return "Strategic push";
    if (group === "Tier 2 Watch") return "Red caution test";
    if (group === "Core Tier 2" && phase.includes("growing")) return "Green active opportunity";
    if (group === "Core Tier 2") return "Yellow publisher expansion";
    if (group === "Tier 3") return "Development push";
    if (group === "Tier 4") return "Retest only";
    if (group === "Black Tier") return "No push";
    return "Optimization only";
  }

  function tier2PublisherStrategy(offer, language = state.language) {
    if (!tier2Rules.strategyForOffer || offer.tier !== "Tier 2") return null;
    return tier2Rules.strategyForOffer(offer, {
      language,
      tierGroup: tierGroup(offer),
      highlightStatus: highlightStatus(offer)
    });
  }

  function tier2PublisherCountText(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return "";
    return strategy.publisherCountText || "";
  }

  function tier2PublisherSuccessText(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return "";
    return strategy.successRateText || "";
  }

  function tier2OptimizationIdea(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    return strategy ? strategy.idea : "";
  }

  function tier2RecommendationDetailsHtml(offer, language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return "";
    const copy = chatCopy(language);
    const publisherLabel = language === "zh" ? chatLabelText("Publisher Count", language) : "Publisher count";
    const successLabel = language === "zh" ? chatLabelText("Success Rate", language) : "Success rate";
    const ideaLabel = language === "zh" ? (copy.tier2OptimizationIdea || chatLabelText("Tier 2 Optimization Idea", language)) : "Tier 2 optimization idea";
    return [
      `<li><strong>${escapeHtml(publisherLabel)}:</strong> ${escapeHtml(strategy.publisherCountText || (language === "zh" ? copy.notAvailable : "not available"))}</li>`,
      `<li><strong>${escapeHtml(successLabel)}:</strong> ${escapeHtml(strategy.successRateText || (language === "zh" ? copy.notAvailable : "not available"))}</li>`,
      `<li><strong>${escapeHtml(ideaLabel)}:</strong> ${escapeHtml(strategy.idea)}</li>`
    ].join("");
  }

  function tier2FieldRows(offer, language = state.language) {
    const strategy = tier2PublisherStrategy(offer, language);
    if (!strategy) return [];
    const notAvailable = language === "zh" ? chatCopy(language).notAvailable : "not available in current data";
    return [
      ["Publisher Count", strategy.publisherCountText || notAvailable],
      ["Success Rate", strategy.successRateText || notAvailable],
      ["Tier 2 Optimization Idea", strategy.idea]
    ];
  }

  function recommendedAction(offer, language = state.language) {
    const group = tierGroup(offer);
    const publisherStrategy = tier2PublisherStrategy(offer, language);
    if (language === "zh") {
      if (hasPaymentRisk(offer)) return "放量前先跟进付款风险";
      if (group === "Tier 1") return "战略性推进";
      if (publisherStrategy) return publisherStrategy.action;
      if (group === "Core Tier 2") {
        const map = {
          "Green active opportunity": "绿色主动机会",
          "Yellow publisher expansion": "黄色 publisher 扩展机会",
          "Optimization only": "仅优化"
        };
        return map[highlightStatus(offer)] || highlightStatus(offer);
      }
      if (group === "Tier 2 Watch") return "仅做精选 publisher 测试";
      if (group === "Tier 3") return "控制节奏做发展测试";
      if (group === "Tier 4") return "仅复测";
      if (group === "Black Tier") return "不要推进";
      return "仅优化";
    }
    if (hasPaymentRisk(offer)) return "Follow up payment before scaling";
    if (group === "Tier 1") return "Push strategically";
    if (publisherStrategy) return publisherStrategy.action;
    if (group === "Core Tier 2") return highlightStatus(offer);
    if (group === "Tier 2 Watch") return "Selected publisher test only";
    if (group === "Tier 3") return "Controlled development push";
    if (group === "Tier 4") return "Retest only";
    if (group === "Black Tier") return "Do not push";
    return "Optimize only";
  }

  function caution(offer, language = state.language) {
    const group = tierGroup(offer);
    const publisherStrategy = tier2PublisherStrategy(offer, language);
    if (language === "zh") {
      if (group === "Black Tier") return "Black Tier，不建议推进。";
      if (hasPaymentRisk(offer)) return `付款风险：${paymentRiskTextForOffer(offer)}。`;
      if (publisherStrategy) return publisherStrategy.caution;
      if (group === "Tier 4") return "仅在角度明确时复测。";
      if (group === "Tier 2 Watch") return "放量前需要继续观察。";
      if (number(offer.conversionRate) < 0.01) return "CVR 低于 1%，建议使用高意图流量。";
      return "持续观察 EPC、CVR 和付款状态。";
    }
    if (group === "Black Tier") return "Black tier; do not push.";
    if (hasPaymentRisk(offer)) return `Payment risk: ${paymentRiskTextForOffer(offer)}.`;
    if (publisherStrategy) return publisherStrategy.caution;
    if (group === "Tier 4") return "Retest only with a clear angle.";
    if (group === "Tier 2 Watch") return "Needs monitoring before broader scale.";
    if (number(offer.conversionRate) < 0.01) return "CVR is below 1%; use high-intent traffic.";
    return "Monitor EPC, CVR, and payment status.";
  }

  function bestAngle(offer, context = {}) {
    const category = displayCategory(offer) !== "Uncategorized" ? displayCategory(offer) : "category";
    const link = offer.recommendedLink ? `${offer.recommendedLink.toLowerCase()} traffic` : "selected publisher traffic";
    const language = context.language || responseLanguageFor(context.prompt || state.currentQuery);
    if (language === "zh") {
      const categoryText = category === "category" ? "该品类" : category;
      const linkText = offer.recommendedLink ? `${offer.recommendedLink} 流量` : "精选 publisher 流量";
      if (context.google) {
        if (number(offer.orders) >= 50 && number(offer.conversionRate) >= 0.01) return `${categoryText} 关键词、测评、对比和高意图搜索流量。`;
        return `${categoryText} 关键词测试，先收紧意图；CVR 改善前不要大规模放量。`;
      }
      if (offer.hasDiscount) return `${categoryText} deal、coupon、对比和测评流量。`;
      if (offer.hasAsin) return `${categoryText} ASIN 测评、对比和购买指南流量。`;
      return `${categoryText} ${linkText}、对比内容和控制测试流量。`;
    }
    if (context.google) {
      if (number(offer.orders) >= 50 && number(offer.conversionRate) >= 0.01) return `${category} keyword, review, comparison, and high-intent search traffic.`;
      return `${category} keyword tests with tighter intent; avoid broad scaling until CVR improves.`;
    }
    if (offer.hasDiscount) return `${category} deal, coupon, comparison, and review traffic.`;
    if (offer.hasAsin) return `${category} ASIN review, comparison, and buying-guide traffic.`;
    return `${category} ${link}, comparison, and controlled test traffic.`;
  }

  function aggregateRows(rows) {
    const totalRevenue = rows.reduce((sum, offer) => sum + number(offer.salesAmount), 0);
    const totalCommission = rows.reduce((sum, offer) => sum + number(offer.affCommission), 0);
    const totalClicks = rows.reduce((sum, offer) => sum + number(offer.clicks), 0);
    const totalDpv = rows.reduce((sum, offer) => sum + number(offer.dpv), 0);
    const totalAtc = rows.reduce((sum, offer) => sum + number(offer.atc), 0);
    const totalOrders = rows.reduce((sum, offer) => sum + number(offer.orders), 0);
    const tierBreakdown = rows.reduce((acc, offer) => {
      const tier = tierGroup(offer);
      acc[tier] = (acc[tier] || 0) + 1;
      return acc;
    }, {});
    const tier2Breakdown = rows.filter((offer) => offer.tier === "Tier 2").reduce((acc, offer) => {
      const status = highlightStatus(offer);
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    return {
      totalOffers: rows.length,
      totalRevenue,
      totalCommission,
      totalClicks,
      totalDpv,
      totalAtc,
      totalOrders,
      avgAov: totalOrders ? totalRevenue / totalOrders : null,
      blendedEpc: totalClicks ? totalCommission / totalClicks : null,
      avgCvr: totalClicks ? totalOrders / totalClicks : null,
      paymentRiskCount: rows.filter(hasPaymentRisk).length,
      tierBreakdown,
      tier2Breakdown
    };
  }

  function bestBy(rows, metric) {
    return rows.reduce((best, offer) => number(offer[metric]) > number(best && best[metric]) ? offer : best, null);
  }

  function uniqueValues(key) {
    return Array.from(new Set(offers.map((offer) => offer[key]).filter(Boolean))).sort((a, b) => {
      if (String(a).startsWith("Tier") && String(b).startsWith("Tier")) return String(a).localeCompare(String(b), undefined, { numeric: true });
      return String(a).localeCompare(String(b));
    });
  }

  function fillSelect(select, values) {
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = optionText(value);
      select.appendChild(option);
    });
  }

  function replaceSelectOptions(select, firstLabel, values, selectedValue) {
    select.innerHTML = "";
    const first = document.createElement("option");
    first.value = "all";
    first.textContent = optionText(firstLabel);
    select.appendChild(first);
    fillSelect(select, values);
    select.value = values.includes(selectedValue) ? selectedValue : "all";
  }

  function replaceSelectWithOptions(select, options, selectedValue) {
    select.innerHTML = "";
    options.forEach((option) => {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = optionText(option.label);
      select.appendChild(el);
    });
    if (options.some((option) => option.value === selectedValue)) {
      select.value = selectedValue;
    } else if (options[0]) {
      select.value = options[0].value;
    }
  }

  function parseSheetNumber(value) {
    const text = String(value ?? "").trim();
    if (!text) return 0;
    const cleaned = text.replace(/[$,%]/g, "").replace(/,/g, "");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }

  function isRateColumn(header) {
    const lower = String(header || "").toLowerCase();
    return /(commission rate|success rate|conversion rate|completion rate|avg conversion|\bconversion\b|\bcvr\b)/.test(lower) && !/count/.test(lower);
  }

  function percentageNumberForHeader(header, value) {
    if (!isRateColumn(header)) return null;
    const text = String(value ?? "").trim();
    if (!text) return null;
    const cleaned = text.replace(/%$/, "").replace(/,/g, "").trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const raw = Number(cleaned);
    if (!Number.isFinite(raw)) return null;
    if (text.includes("%")) return raw;
    return Math.abs(raw) <= 1 ? raw * 100 : raw;
  }

  function formatPercentNumber(value, minimumFractionDigits = 0) {
    return `${Number(value).toLocaleString(undefined, { minimumFractionDigits, maximumFractionDigits: 2 })}%`;
  }

  function formatSheetCell(header, value) {
    const text = String(value ?? "");
    if (text.includes("%")) return text;
    const percentage = percentageNumberForHeader(header, text);
    const minimumFractionDigits = /commission rate/i.test(String(header || "")) ? 2 : 0;
    return percentage === null ? text : formatPercentNumber(percentage, minimumFractionDigits);
  }

  function sortableReportValue(header, value) {
    const text = String(value ?? "").trim();
    if (!text) return { type: "empty", value: "" };
    const percentage = percentageNumberForHeader(header, text);
    if (percentage !== null) return { type: "number", value: percentage };
    const fraction = text.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (fraction && Number(fraction[2]) !== 0) return { type: "number", value: Number(fraction[1]) / Number(fraction[2]) };
    const dateValue = /^\d{4}-\d{2}-\d{2}/.test(text) ? Date.parse(text.slice(0, 10)) : NaN;
    if (Number.isFinite(dateValue)) return { type: "number", value: dateValue };
    const cleaned = text.replace(/[$,%]/g, "").replace(/,/g, "").trim();
    if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) return { type: "number", value: Number(cleaned) };
    return { type: "text", value: text.toLowerCase() };
  }

  function compareReportValues(header, left, right) {
    const a = sortableReportValue(header, left);
    const b = sortableReportValue(header, right);
    if (a.type === "empty" || b.type === "empty") {
      if (a.type === b.type) return 0;
      return a.type === "empty" ? 1 : -1;
    }
    if (a.type === "number" && b.type === "number") return a.value - b.value;
    return String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" });
  }

  function defaultReportSortDirection(header) {
    return /(rank|id|merchant|brand|network|agency|tier|phase|country|reason|recommendation|link|asin|target|objective|status)/i.test(String(header || "")) ? "asc" : "desc";
  }

  function sortReportRows(rows, sortState, getter) {
    if (!sortState || !sortState.key) return rows.slice();
    const multiplier = sortState.direction === "desc" ? -1 : 1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const left = getter(a.row, sortState.key);
        const right = getter(b.row, sortState.key);
        const leftEmpty = String(left ?? "").trim() === "";
        const rightEmpty = String(right ?? "").trim() === "";
        if (leftEmpty || rightEmpty) {
          if (leftEmpty === rightEmpty) return a.index - b.index;
          return leftEmpty ? 1 : -1;
        }
        const result = compareReportValues(sortState.key, left, right);
        return result ? result * multiplier : a.index - b.index;
      })
      .map((item) => item.row);
  }

  function sortableHeaderHtml(header, sortState, scope) {
    const active = sortState && sortState.key === header;
    const direction = active ? sortState.direction : "";
    const indicator = active ? (direction === "asc" ? "▲" : "▼") : "↕";
    return `<th><button class="table-sort-button${active ? " active" : ""}" type="button" data-report-sort-scope="${escapeHtml(scope)}" data-report-sort-key="${escapeHtml(header)}" aria-label="Sort by ${escapeHtml(labelText(header))}">
      <span>${escapeHtml(labelText(header))}</span>
      <span class="sort-indicator" aria-hidden="true">${escapeHtml(indicator)}</span>
    </button></th>`;
  }

  function updateReportSort(sortState, key) {
    if (sortState.key === key) {
      sortState.direction = sortState.direction === "asc" ? "desc" : "asc";
      return;
    }
    sortState.key = key;
    sortState.direction = defaultReportSortDirection(key);
  }

  function updateTargetMatrixSort(key) {
    if (state.targetSort.key === key) {
      state.targetSort.direction = state.targetSort.direction === "asc" ? "desc" : "asc";
      return;
    }
    state.targetSort.key = key;
    state.targetSort.direction = key === "Tier" ? "asc" : "desc";
  }

  function handleReportSortClick(event) {
    const button = event.target.closest("[data-report-sort-key]");
    if (!button) return;
    const key = button.dataset.reportSortKey || "";
    if (!key) return;
    if (button.dataset.reportSortScope === "target") {
      updateTargetMatrixSort(key);
      renderSheetPage();
      return;
    }
    if (button.dataset.reportSortScope === "payment") {
      updateReportSort(state.paymentSort, key);
      renderPaymentsPage();
      return;
    }
    if (button.dataset.reportSortScope === "publisher") {
      updateReportSort(state.publisherSort, key);
      renderPublishersPage();
      return;
    }
    updateReportSort(state.tierSheetSort, key);
    state.tierTablePages[state.selectedTierPage] = 1;
    renderTierPage(state.selectedTierPage);
  }

  function rowValue(row, keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
    }
    return "";
  }

  function getFiltered() {
    const minEpc = Number(state.minEpc || 0);
    const minAov = Number(state.minAov || 0);
    const minCvr = Number(state.minCvr || 0) / 100;
    return offers
      .filter((offer) => state.tier === "all" || offer.tier === state.tier)
      .filter((offer) => state.network === "all" || offer.network === state.network)
      .filter((offer) => state.category === "all" || categoryMatches(offer, state.category))
      .filter((offer) => number(offer.epc) >= minEpc)
      .filter((offer) => number(offer.aov) >= minAov)
      .filter((offer) => number(offer.conversionRate) >= minCvr)
      .filter((offer) => !state.notPaidOnly || hasPaymentRisk(offer))
      .sort((a, b) => (number(b[state.sort]) - number(a[state.sort])) * (state.descending ? 1 : -1));
  }

  function compareDashboardCategoryGroups(a, b) {
    if (a.category === "Uncategorized" && b.category !== "Uncategorized") return 1;
    if (b.category === "Uncategorized" && a.category !== "Uncategorized") return -1;
    return number(b.summary.totalRevenue) - number(a.summary.totalRevenue) ||
      number(b.summary.totalOrders) - number(a.summary.totalOrders) ||
      number(b.summary.totalOffers) - number(a.summary.totalOffers) ||
      String(a.category || "").localeCompare(String(b.category || ""), undefined, { numeric: true, sensitivity: "base" });
  }

  function dashboardCategoryGroups(rows) {
    const groups = new Map();
    rows.forEach((offer) => {
      const category = displayCategory(offer) || "Uncategorized";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(offer);
    });
    return Array.from(groups.entries())
      .map(([category, groupRows]) => ({
        category,
        rows: groupRows,
        summary: aggregateRows(groupRows)
      }))
      .sort(compareDashboardCategoryGroups);
  }

  function fuzzyScore(query, offer) {
    const q = normalize(query);
    const brand = normalize(offer.brand);
    if (!q || !brand) return 0;
    if (brand === q) return 100;
    if (offer.merchantId === query.trim()) return 100;
    if (brand.startsWith(q)) return 92;
    if (brand.includes(q)) return 82;
    const queryWords = words(query);
    const haystack = words(`${offer.brand} ${categorySearchText(offer)} ${offer.network}`);
    const matched = queryWords.filter((word) => haystack.some((item) => item.includes(word) || word.includes(item))).length;
    const tokenScore = queryWords.length ? (matched / queryWords.length) * 70 : 0;
    const overlap = [...q].filter((char) => brand.includes(char)).length / Math.max(q.length, 1);
    return Math.max(tokenScore, overlap * 45);
  }

  function findMerchantMatches(query) {
    const cleaned = query
      .replace(/\b(search|find|merchant|overview|info|information|about|for)\b/gi, " ")
      .replace(/查找|搜索|查看|看看|商家|品牌|概览|信息|资料|关于|帮我|请|找|分析|评估|诊断|怎么样|表现|趋势|健康度/g, " ")
      .replace(metricTermPattern(), " ")
      .replace(/的/g, " ")
      .trim();
    const scored = offers
      .map((offer) => {
        const score = fuzzyScore(cleaned, offer);
        let adjusted = score;
        if (tierPriority(offer, false, false) < 99) adjusted += 18;
        if (number(offer.orders) > 0 || number(offer.clicks) > 0) adjusted += 8;
        if (offer.tier === "Tier 4") adjusted -= 22;
        if (offer.tier === "BLACK TIER") adjusted -= 60;
        return { offer, score, adjusted };
      })
      .filter((item) => item.score >= 45)
      .sort((a, b) => b.adjusted - a.adjusted || b.score - a.score || tierPriority(a.offer, true, true) - tierPriority(b.offer, true, true));
    const seen = new Set();
    return scored.filter(({ offer }) => {
      const key = `${offer.merchantId}:${normalize(offer.brand)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
  }

  function findByMerchantId(text) {
    const match = text.match(/\b\d{5,8}(?:\.0)?\b/);
    if (!match) return null;
    const id = match[0].replace(/\.0$/, "");
    return offers.find((offer) => offer.merchantId === id) || null;
  }

  function findByAsin(text) {
    const match = text.toUpperCase().match(/\bB[A-Z0-9]{9}\b/);
    if (!match) return null;
    const asin = match[0];
    return { asin, rows: offers.filter((offer) => (
      (offer.topAsins || []).includes(asin) ||
      (offer.productAsins || []).includes(asin)
    )) };
  }

  // Return all ASINs found in a prompt (multi-ASIN support).
  function findAllAsins(text) {
    const matches = String(text || "").toUpperCase().match(/\bB[A-Z0-9]{9}\b/g);
    if (!matches || !matches.length) return [];
    const seen = {};
    const results = [];
    for (var i = 0; i < matches.length; i++) {
      var asin = matches[i];
      if (seen[asin]) continue;
      seen[asin] = true;
      results.push({ asin: asin, rows: offers.filter(function(offer) {
        return (offer.topAsins || []).includes(asin) || (offer.productAsins || []).includes(asin);
      }) });
    }
    return results;
  }

  function metricTermPattern() {
    return [
      "commission\\s+(?:made|amount|dollars?)",
      "affiliate\\s+commission",
      "aff\\s+commission",
      "commission\\s+(?:rate|percentage|percent)",
      "conversion(?:\\s+rate)?",
      "order\\s+count",
      "commissions?",
      "revenue",
      "sales",
      "clicks?",
      "orders?",
      "epc",
      "aov",
      "cvr",
      "dpv",
      "atc",
      "产生佣金",
      "佣金收入",
      "佣金金额",
      "佣金额",
      "联盟佣金",
      "佣金率",
      "佣金比例",
      "佣金百分比",
      "佣金",
      "客单价",
      "平均订单金额",
      "转化率",
      "转换率",
      "订单数量",
      "订单数",
      "订单",
      "销售额",
      "收入",
      "营收",
      "点击量",
      "点击",
      "详情页浏览量",
      "详情页浏览",
      "浏览量",
      "加购数",
      "加购",
      "加入购物车"
    ].join("|");
  }

  function comparisonTermPattern() {
    return [
      "greater\\s+than",
      "more\\s+than",
      "higher\\s+than",
      "at\\s+least",
      "less\\s+than",
      "lower\\s+than",
      "at\\s+most",
      "不低于",
      "不少于",
      "大于等于",
      "不超过",
      "小于等于",
      "above",
      "over",
      "minimum",
      "maximum",
      "below",
      "under",
      "min",
      "max",
      ">=",
      "<=",
      ">",
      "<",
      "至少",
      "最低",
      "最少",
      "高于",
      "超过",
      "大于",
      "以上",
      "最多",
      "最高",
      "低于",
      "少于",
      "小于",
      "以下",
      "以内"
    ].join("|");
  }

  function numberTokenPattern() {
    return "\\d[\\d,]*(?:\\.\\d+)?\\s*(?:[kKmM]|千|万)?";
  }

  function metricFilterPattern() {
    return new RegExp(`(${metricTermPattern()})\\s*(?:is|are|with|of|为|是|在|有|:|：)?\\s*(${comparisonTermPattern()})\\s*[$¥￥]?\\s*(${numberTokenPattern()})\\s*%?`, "gi");
  }

  function metricRangeFilterPattern() {
    return new RegExp(`(${metricTermPattern()})\\s*(?:is|are|with|of|为|是|在|有|:|：)?\\s*(?:between|from|range|ranging|介于|从|在)?\\s*[$¥￥]?\\s*(${numberTokenPattern()})\\s*%?\\s*(?:and|to|-|–|—|到|至|和|与)\\s*[$¥￥]?\\s*(${numberTokenPattern()})\\s*%?\\s*(?:之间|范围)?`, "gi");
  }

  function metricTrailingComparisonPattern() {
    return new RegExp(`(${metricTermPattern()})\\s*(?:is|are|with|of|为|是|在|有|:|：)?\\s*[$¥￥]?\\s*(${numberTokenPattern()})\\s*%?\\s*(${comparisonTermPattern()})`, "gi");
  }

  function normalizeMetricName(metric) {
    const text = String(metric || "").toLowerCase().replace(/\s+/g, " ");
    if (text === "epc") return { field: "epc", label: "EPC", type: "money" };
    if (text === "aov" || /客单价|平均订单金额/.test(text)) return { field: "aov", label: "AOV", type: "money" };
    if (text === "cvr" || text.startsWith("conversion") || /转化率|转换率/.test(text)) return { field: "conversionRate", label: "CVR", type: "percent" };
    if (/dpv|详情页浏览|浏览量/.test(text)) return { field: "dpv", label: "DPV", type: "count" };
    if (/atc|加购|加入购物车/.test(text)) return { field: "atc", label: "ATC", type: "count" };
    if (/click|点击/.test(text)) return { field: "clicks", label: "Clicks", type: "count" };
    if (text.includes("commission") || /佣金/.test(text)) {
      if (/made|amount|dollar|affiliate|\baff\b|产生|收入|金额|金额|联盟/.test(text)) return { field: "affCommission", label: "Commission made", type: "money" };
      return { field: "commissionRate", label: "Commission rate", type: "percent" };
    }
    if (text === "revenue" || text === "sales" || /销售额|收入|营收/.test(text)) return { field: "salesAmount", label: "Revenue", type: "money" };
    return { field: "orders", label: "Orders", type: "count" };
  }

  function parseMetricNumber(value) {
    const text = String(value || "").trim().replace(/,/g, "");
    const match = text.match(/^(\d+(?:\.\d+)?)\s*([kKmM]|千|万)?$/);
    if (!match) return NaN;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return NaN;
    const suffix = String(match[2] || "").toLowerCase();
    if (suffix === "k") return base * 1000;
    if (suffix === "m") return base * 1000000;
    if (suffix === "千") return base * 1000;
    if (suffix === "万") return base * 10000;
    return base;
  }

  function normalizeMetricThreshold(metric, raw, sourceText = "") {
    if (!Number.isFinite(raw)) return NaN;
    const hasPercent = sourceText.includes("%");
    return metric.type === "percent"
      ? (hasPercent || raw > 1 ? raw / 100 : raw)
      : raw;
  }

  function normalizeComparisonOperator(operator) {
    const text = String(operator || "").toLowerCase();
    if (/lower\s+than/.test(text)) return "<";
    if (/below|under|less|at most|maximum|max|<=|<|低于|少于|小于|以下|以内|不超过|最多|最高|小于等于/.test(text)) {
      return text.includes("=") || /at most|maximum|max|不超过|最多|最高|小于等于|以内/.test(text) ? "<=" : "<";
    }
    return text.includes("=") || /at least|minimum|min|不低于|不少于|大于等于|至少|最低|最少|以上/.test(text) ? ">=" : ">";
  }

  function normalizeCycleComparisonOperator(operator) {
    const text = String(operator || "").toLowerCase();
    if (/before|below|under|less|shorter|<|within|up to|at most|maximum|max|低于|少于|小于|短于|早于|以内|以下|不超过|最多|至多|小于等于|少于等于|低于等于/.test(text)) {
      return text.includes("=") || /within|up to|at most|maximum|max|以内|不超过|最多|至多|小于等于|少于等于|低于等于/.test(text) ? "<=" : "<";
    }
    return text.includes("=") || /at least|minimum|min|不低于|不少于|大于等于|至少/.test(text) ? ">=" : ">";
  }

  function paymentCycleFilterPattern() {
    return new RegExp(`(?:payment|pay)\\s+cycle|付款周期|支付周期|结算周期|回款周期|周期`, "i");
  }

  function paymentCycleLeadingFilterPattern() {
    return new RegExp(`((?:(?:payment|pay)\\s+cycle)|付款周期|支付周期|结算周期|回款周期|周期)\\s*(?:is|are|with|of|为|是|在|有|:|：)?\\s*(before|below|under|less\\s+than|shorter\\s+than|within|up\\s+to|at\\s+most|maximum|max|<=|<|above|over|greater\\s+than|more\\s+than|at\\s+least|minimum|min|>=|>|低于|少于|小于|短于|早于|以内|以下|不超过|最多|至多|小于等于|少于等于|低于等于|高于|超过|大于|至少|以上|不低于|不少于|大于等于)\\s*(${numberTokenPattern()})\\s*(?:days?|d|天|日)?`, "i");
  }

  function paymentCycleTrailingFilterPattern() {
    return new RegExp(`((?:(?:payment|pay)\\s+cycle)|付款周期|支付周期|结算周期|回款周期|周期)\\s*(?:is|are|with|of|为|是|在|有|:|：)?\\s*(${numberTokenPattern()})\\s*(?:days?|d|天|日)?\\s*(before|below|under|less\\s+than|shorter\\s+than|within|up\\s+to|at\\s+most|maximum|max|<=|<|above|over|greater\\s+than|more\\s+than|at\\s+least|minimum|min|>=|>|低于|少于|小于|短于|早于|以内|以下|不超过|最多|至多|小于等于|少于等于|低于等于|高于|超过|大于|至少|以上|不低于|不少于|大于等于)`, "i");
  }

  function extractPaymentCycleFilter(prompt) {
    const text = String(prompt || "");
    if (!paymentCycleFilterPattern().test(text)) return null;
    const leading = paymentCycleLeadingFilterPattern().exec(text);
    const trailing = leading ? null : paymentCycleTrailingFilterPattern().exec(text);
    const match = leading || trailing;
    if (!match) return null;
    const threshold = parseMetricNumber(leading ? match[3] : match[2]);
    if (!Number.isFinite(threshold)) return null;
    return {
      operator: normalizeCycleComparisonOperator(leading ? match[2] : match[3]),
      threshold,
      raw: match[0].trim()
    };
  }

  function paymentCycleFilterMatches(offer, filter) {
    const cycle = number(offer.paymentCycle);
    if (cycle <= 0) return false;
    if (filter.operator === ">") return cycle > filter.threshold;
    if (filter.operator === ">=") return cycle >= filter.threshold;
    if (filter.operator === "<") return cycle < filter.threshold;
    if (filter.operator === "<=") return cycle <= filter.threshold;
    return true;
  }

  function paymentCycleFilterText(filter, language = "en") {
    if (!filter) return "";
    if (language === "zh") {
      const operatorText = {
        "<": "少于",
        "<=": "不超过",
        ">": "超过",
        ">=": "至少"
      }[filter.operator] || filter.operator;
      return `付款周期${operatorText}${Number(filter.threshold).toLocaleString()}天`;
    }
    return `Payment cycle ${filter.operator} ${Number(filter.threshold).toLocaleString()} days`;
  }

  function normalizeLlmMetricFilter(filter) {
    // Convert LLM-extracted metric filter to internal format used by applyMetricFilters
    if (!filter || !filter.field || !filter.operator) return null;
    var field = String(filter.field || "").toLowerCase().trim();
    var fieldMap = {
      aov: { field: "aov", label: "AOV", type: "money" },
      epc: { field: "epc", label: "EPC", type: "money" },
      conversionrate: { field: "conversionRate", label: "CVR", type: "percent" },
      cvr: { field: "conversionRate", label: "CVR", type: "percent" },
      affcommission: { field: "affCommission", label: "Commission made", type: "money" },
      commissionrate: { field: "commissionRate", label: "Commission rate", type: "percent" },
      salesamount: { field: "salesAmount", label: "Revenue", type: "money" },
      orders: { field: "orders", label: "Orders", type: "count" },
      clicks: { field: "clicks", label: "Clicks", type: "count" },
      dpv: { field: "dpv", label: "DPV", type: "count" },
      atc: { field: "atc", label: "ATC", type: "count" }
    };
    var meta = fieldMap[field];
    if (!meta) return null;
    var value = Number(filter.value || 0);
    // Normalize percent values: LLM sends "5" for 5%, internal stores 0.05
    if (meta.type === "percent" && value > 1) value = value / 100;
    return {
      field: meta.field,
      label: meta.label,
      type: meta.type,
      operator: String(filter.operator),
      threshold: value,
      raw: ""
    };
  }

  function extractMetricFilters(prompt) {
    const filters = [];
    const text = String(prompt || "");
    let match;
    const rangePattern = metricRangeFilterPattern();
    while ((match = rangePattern.exec(text))) {
      const metric = normalizeMetricName(match[1]);
      const first = normalizeMetricThreshold(metric, parseMetricNumber(match[2]), match[0]);
      const second = normalizeMetricThreshold(metric, parseMetricNumber(match[3]), match[0]);
      if (!Number.isFinite(first) || !Number.isFinite(second)) continue;
      filters.push({
        ...metric,
        operator: "between",
        min: Math.min(first, second),
        max: Math.max(first, second),
        raw: match[0].trim()
      });
    }
    const pattern = metricFilterPattern();
    while ((match = pattern.exec(text))) {
      const metric = normalizeMetricName(match[1]);
      const raw = parseMetricNumber(match[3]);
      if (!Number.isFinite(raw)) continue;
      const threshold = normalizeMetricThreshold(metric, raw, match[0]);
      filters.push({
        ...metric,
        operator: normalizeComparisonOperator(match[2]),
        threshold,
        raw: match[0].trim()
      });
    }
    const trailingPattern = metricTrailingComparisonPattern();
    while ((match = trailingPattern.exec(text))) {
      const metric = normalizeMetricName(match[1]);
      const raw = parseMetricNumber(match[2]);
      if (!Number.isFinite(raw)) continue;
      const threshold = normalizeMetricThreshold(metric, raw, match[0]);
      filters.push({
        ...metric,
        operator: normalizeComparisonOperator(match[3]),
        threshold,
        raw: match[0].trim()
      });
    }
    const seen = new Set();
    return filters.filter((filter) => {
      const key = `${filter.field}:${filter.operator}:${filter.threshold}:${filter.min}:${filter.max}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function metricFilterMatches(offer, filter) {
    const value = number(offer[filter.field]);
    if (filter.operator === "between") return value >= filter.min && value <= filter.max;
    if (filter.operator === ">") return value > filter.threshold;
    if (filter.operator === ">=") return value >= filter.threshold;
    if (filter.operator === "<") return value < filter.threshold;
    if (filter.operator === "<=") return value <= filter.threshold;
    return true;
  }

  function applyMetricFilters(rows, filters) {
    if (!filters || !filters.length) return rows;
    return rows.filter((offer) => filters.every((filter) => metricFilterMatches(offer, filter)));
  }

  function metricThresholdText(filter) {
    if (filter.operator === "between") {
      return `${filter.label} between ${metricValueText(filter, filter.min)} and ${metricValueText(filter, filter.max)}`;
    }
    return `${filter.label} ${filter.operator} ${metricValueText(filter, filter.threshold)}`;
  }

  function metricValueText(filter, metricValue) {
    if (filter.type === "percent") return formatPercentNumber(metricValue * 100);
    if (filter.type === "money") return `$${Number(metricValue).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return Number(metricValue).toLocaleString();
  }

  function metricFilterText(filters) {
    return filters && filters.length ? filters.map(metricThresholdText).join(", ") : "";
  }

  function metricSortTermPattern() {
    return [
      "highest",
      "lowest",
      "top",
      "best",
      "maximum",
      "minimum",
      "max",
      "min",
      "most",
      "least",
      "largest",
      "biggest",
      "smallest",
      "desc(?:ending)?",
      "asc(?:ending)?"
    ].join("|");
  }

  function metricSortLeadingPattern() {
    return new RegExp(`\\b(${metricSortTermPattern()})\\s+(?:by\\s+|for\\s+|of\\s+)?(${metricTermPattern()})`, "gi");
  }

  function metricSortTrailingPattern() {
    return new RegExp(`(${metricTermPattern()})\\s+(?:is\\s+|are\\s+)?(${metricSortTermPattern()})\\b`, "gi");
  }

  function metricSortByPattern() {
    return new RegExp(`\\b(?:sort(?:ed)?\\s+by|order(?:ed)?\\s+by|rank(?:ed)?\\s+by|based\\s+on|by)\\s+(${metricTermPattern()})(?:\\s+(${metricSortTermPattern()}))?`, "gi");
  }

  function metricSortPatterns() {
    return [metricSortLeadingPattern(), metricSortTrailingPattern(), metricSortByPattern()];
  }

  function normalizeMetricSortDirection(term) {
    const text = String(term || "").toLowerCase();
    if (/lowest|minimum|\bmin\b|least|smallest|asc/.test(text)) return "asc";
    return "desc";
  }

  function normalizeMetricSortName(metric) {
    const normalized = normalizeMetricName(metric);
    const text = String(metric || "").toLowerCase().replace(/\s+/g, " ");
    if (text.includes("commission") && !/(rate|percentage|percent)/.test(text)) {
      return { field: "affCommission", label: "Commission made", type: "money" };
    }
    return normalized;
  }

  function extractMetricSortIntent(prompt) {
    const text = String(prompt || "");
    const matches = [];
    let match;
    const leading = metricSortLeadingPattern();
    while ((match = leading.exec(text))) {
      matches.push({ term: match[1], metric: match[2], index: match.index, raw: match[0].trim() });
    }
    const trailing = metricSortTrailingPattern();
    while ((match = trailing.exec(text))) {
      matches.push({ term: match[2], metric: match[1], index: match.index, raw: match[0].trim() });
    }
    const byPattern = metricSortByPattern();
    while ((match = byPattern.exec(text))) {
      matches.push({ term: match[2] || "highest", metric: match[1], index: match.index, raw: match[0].trim() });
    }
    if (!matches.length) return null;
    const best = matches.sort((a, b) => a.index - b.index)[0];
    const metric = normalizeMetricSortName(best.metric);
    return {
      ...metric,
      direction: normalizeMetricSortDirection(best.term),
      raw: best.raw
    };
  }

  function stripMetricSortPhrases(text) {
    return metricSortPatterns().reduce((output, pattern) => output.replace(pattern, " "), String(text || ""));
  }

  function cleanedCategoryPhrase(text) {
    return stripMetricSortPhrases(text)
      .replace(metricRangeFilterPattern(), " ")
      .replace(metricFilterPattern(), " ")
      .replace(metricTrailingComparisonPattern(), " ")
      .replace(/\b(?:top|give|show|list|export|download|pull)\s+(?:me\s+)?(?:the\s+)?(?:top\s+)?\d{1,4}\b/gi, " ")
      .replace(/\b\d{1,4}\s+(?:offers?|brands?|recommendations?)\b/gi, " ")
      .replace(/\btier\s*[1-4]\b/gi, " ")
      .replace(/\bblack\s*tier\b/gi, " ")
      .replace(/\b(?:offers?|brands?|recommendations?|recommend|please|best|top|show|give|list|pull|download|export|with|that|has|have|above|over|below|under|greater|less|than|minimum|maximum|min|max|at|least|most|tier)\b/gi, " ")
      .replace(/推荐|请|帮我|给我|显示|列出|拉取|下载|导出|找|筛选|最好|最佳|前\s*\d*|第?\s*[一二三四1-4]\s*(?:层|级|档)|分层|层级|档位|品类|类别|类目|品牌|商家|个|款|条|大于等于|小于等于|不低于|不少于|不超过|大于|高于|超过|以上|至少|最低|小于|低于|少于|以下|以内|最多|最高|介于|之间/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasCategoryIntentText(text) {
    return /\b(?:category|categories|subcategory|subcategories|main\s+category|category-wise|categorywise)\b/i.test(String(text || "")) ||
      /品类|类别|类目|主品类|主类目|子品类|子类目|分类/.test(String(text || ""));
  }

  function categoryScore(query, category) {
    const queryTokens = meaningfulTokens(query);
    if (!queryTokens.length) return 0;
    const categoryTokens = meaningfulTokens(category);
    const queryNorm = normalize(query);
    const categoryNorm = normalize(category);
    let score = 0;
    if (categoryNorm === queryNorm) score += 110;
    else if (categoryNorm.includes(queryNorm) || queryNorm.includes(categoryNorm)) score += 55;
    const matched = queryTokens.filter((queryToken) => (
      categoryTokens.some((categoryToken) => {
        if (categoryToken === queryToken) return true;
        if (categoryToken.length <= 3 || queryToken.length <= 3) return false;
        return categoryToken.includes(queryToken) || queryToken.includes(categoryToken);
      })
    )).length;
    score += (matched / queryTokens.length) * 70;
    score += categoryTokens.length ? (matched / categoryTokens.length) * 20 : 0;
    return score;
  }

  function categoryForPrompt(text) {
    const knownCategories = allCategoryValues();
    const zhCategory = /[\u4e00-\u9fff]/.test(String(text || "")) && chatbotI18n.categoryForPrompt && chatbotI18n.categoryForPrompt(text, knownCategories);
    if (zhCategory) return zhCategory;
    const lower = String(text || "").toLowerCase();
    const phrase = cleanedCategoryPhrase(text);
    const phraseTokens = meaningfulTokens(phrase);
    const allowFuzzyCategory = hasCategoryIntentText(text) || wantsRecommendationList(text) || phraseTokens.length > 1;
    const mainCategories = uniqueCategoryValues()
      .filter((cat) => cat !== "Uncategorized")
      .sort((a, b) => String(b).length - String(a).length);
    const directMain = mainCategories.find((category) => {
      const categoryLower = String(category || "").toLowerCase();
      return categoryLower && (lower.includes(categoryLower) || String(phrase || "").toLowerCase().includes(categoryLower));
    });
    if (directMain) return directMain;
    if (phrase && allowFuzzyCategory) {
      const bestMain = mainCategories
        .map((category) => ({ category, score: categoryScore(phrase, category) }))
        .sort((a, b) => b.score - a.score)[0];
      const mainThreshold = hasCategoryIntentText(text) ? 52 : 68;
      if (bestMain && bestMain.score >= mainThreshold) return bestMain.category;
    }
    const direct = knownCategories.find((category) => {
      const categoryLower = String(category || "").toLowerCase();
      return categoryLower && categoryLower !== "uncategorized" && (lower.includes(categoryLower) || String(phrase || "").toLowerCase().includes(categoryLower));
    });
    if (direct) return direct;
    if (phrase && allowFuzzyCategory) {
      const best = knownCategories
        .map((category) => ({ category, score: categoryScore(phrase, category) }))
        .sort((a, b) => b.score - a.score)[0];
      const threshold = hasCategoryIntentText(text) ? 52 : 62;
      if (best && best.score >= threshold) return best.category;
    }
    for (const [canonical, aliases] of Object.entries(categoryAliases)) {
      if (aliases.some((alias) => words(alias).length > 1 && textIncludesAlias(lower, alias))) return canonical;
    }
    if (phraseTokens.length <= 1) {
      for (const [canonical, aliases] of Object.entries(categoryAliases)) {
        if (aliases.some((alias) => textIncludesAlias(lower, alias))) return canonical;
      }
    }
    for (const [canonical, aliases] of Object.entries(categoryAliases)) {
      if (aliases.some((alias) => textIncludesAlias(lower, alias))) return canonical;
    }
    return null;
  }

  // Return all categories mentioned in a prompt (supports multi-category
  // queries like "tier2美妆和电子" or "beauty and electronics").
  function categoriesForPrompt(text) {
    const single = categoryForPrompt(text);
    if (!single) return [];

    // Separators that indicate multiple categories
    const sep = /和|与|以及|还有|加上|\band\b|,|，|、/i;
    const parts = String(text || "").split(sep).map(function(p) { return p.trim(); }).filter(Boolean);

    if (parts.length <= 1) return [single];

    const categories = [];
    const seen = {};
    for (var i = 0; i < parts.length; i++) {
      var cat = categoryForPrompt(parts[i]);
      if (cat && !seen[cat.toLowerCase()]) {
        seen[cat.toLowerCase()] = true;
        categories.push(cat);
      }
    }
    return categories.length > 0 ? categories : [single];
  }

  // Normalize category input to array form (handles LLM returning string OR array,
  // and also handles comma/和-separated strings).
  function normalizeCategories(cat) {
    if (!cat) return [];
    if (Array.isArray(cat)) return cat.filter(Boolean);
    // LLM may return comma-separated string for multiple categories
    var parts = String(cat).split(/[,，和、]/).map(function(p) { return p.trim(); }).filter(Boolean);
    return parts;
  }

  function categoryMatches(offer, category) {
    if (!category) return true;
    // Support array of categories — match if ANY category fits (OR logic)
    if (Array.isArray(category)) {
      return category.some(function(c) { return categoryMatches(offer, c); });
    }
    const aliases = categoryAliases[category] || [category];
    const mainCategory = sheetMainCategory(offer).toLowerCase();
    if (aliases.some((alias) => textIncludesAlias(mainCategory, alias))) return true;
    if (hasMainCategoryValue(category)) return false;
    const haystack = categorySearchText(offer);
    if (aliases.some((alias) => textIncludesAlias(haystack, alias))) return true;
    const queryTokens = meaningfulTokens(category);
    if (!queryTokens.length) return true;
    const haystackTokens = meaningfulTokens(haystack);
    const matched = queryTokens.filter((queryToken) => (
      haystackTokens.some((token) => token === queryToken || token.includes(queryToken) || queryToken.includes(token))
    )).length;
    return matched >= Math.min(queryTokens.length, queryTokens.length <= 2 ? 2 : Math.ceil(queryTokens.length * 0.65));
  }

  function cleanedMerchantLookupPhrase(text) {
    return stripMetricSortPhrases(text)
      .replace(metricRangeFilterPattern(), " ")
      .replace(metricFilterPattern(), " ")
      .replace(metricTrailingComparisonPattern(), " ")
      .replace(metricTermPattern(), " ")
      .replace(/\b(?:top|give|show|list|export|download|pull|find|search|recommend)\s+(?:me\s+)?(?:the\s+)?(?:top\s+)?\d{1,4}\b/gi, " ")
      .replace(/\b\d{1,4}\s+(?:offers?|brands?|recommendations?)\b/gi, " ")
      .replace(/\b(?:offers?|brands?|recommendations?|recommend|please|best|top|show|give|list|pull|download|export|find|search|merchant|brand|overview|info|information|about|for|the)\b/gi, " ")
      .replace(/推荐|请|帮我|给我|显示|列出|查找|搜索|拉取|下载|导出|最好|最佳|前\s*\d*|商家|品牌|信息|概览|关于|的/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function merchantLookupForPrompt(text) {
    const cleaned = cleanedMerchantLookupPhrase(text);
    if (meaningfulTokens(cleaned).length === 0 && normalize(cleaned).length < 2) return { cleaned, matches: [] };
    return { cleaned, matches: findMerchantMatches(cleaned) };
  }

  function hasStrongMerchantLookup(text, category = null) {
    if (category || hasCategoryIntentText(text) || findByAsin(text) || findByMerchantId(text)) return false;
    if (tierFromPrompt(text) || promptHasPaymentTerms(String(text || "").toLowerCase())) return false;
    if (extractMetricFilters(text).length || extractMetricSortIntent(text)) return false;
    const { cleaned, matches } = merchantLookupForPrompt(text);
    const first = matches[0];
    if (!first) return false;
    const cleanedNorm = normalize(cleaned);
    const brandNorm = normalize(first.offer.brand);
    if (!cleanedNorm || !brandNorm) return false;
    const directBrandMatch = brandNorm === cleanedNorm || brandNorm.startsWith(cleanedNorm) || brandNorm.includes(cleanedNorm) || cleanedNorm.includes(brandNorm);
    const second = matches[1];
    return (directBrandMatch && first.score >= 60) ||
      first.adjusted >= 95 ||
      (first.adjusted >= 85 && (!second || first.adjusted - second.adjusted > 12));
  }

  function tierFromPrompt(text) {
    const zhTier = chatbotI18n.tierFromPrompt && chatbotI18n.tierFromPrompt(text);
    if (zhTier) return zhTier;
    const black = /black\s*tier|blocked|黑名单|黑色\s*tier|黑色分层|屏蔽|暂停/i.test(text);
    if (black) return "BLACK TIER";
    const match = text.match(/tier\s*([1-4一二三四])/i) ||
      text.match(/(?:第\s*)?([一二三四1-4])\s*(?:层|级|档)/) ||
      text.match(/(?:分层|层级|档位)\s*([一二三四1-4])/);
    if (!match) return null;
    const tier = { 一: "1", 二: "2", 三: "3", 四: "4" }[match[1]] || match[1];
    return `Tier ${tier}`;
  }

  // Return all tiers mentioned in a prompt (multi-tier support).
  function tiersFromPrompt(text) {
    const single = tierFromPrompt(text);
    if (!single) return [];
    const sep = /和|与|以及|还有|加上|\band\b|,|，|、/i;
    const parts = String(text || "").split(sep).map(function(p) { return p.trim(); }).filter(Boolean);
    if (parts.length <= 1) return [single];
    const tiers = [];
    const seen = {};
    for (var i = 0; i < parts.length; i++) {
      var t = tierFromPrompt(parts[i]);
      if (t && !seen[t]) { seen[t] = true; tiers.push(t); }
    }
    return tiers.length > 0 ? tiers : [single];
  }

  function normalizeTiers(t) {
    if (!t) return [];
    if (Array.isArray(t)) return t.filter(Boolean);
    return [String(t).trim()].filter(Boolean);
  }

  function wantsRecommendationList(text) {
    const lower = String(text || "").toLowerCase();
    const hasRankCommand = /\b(?:recommend|top|give|show|list|export|download|pull|filter)\b/.test(lower) || /推荐|排行|排名|给我|显示|列出|拉取|导出|下载|筛选|前\s*\d+/.test(text);
    const endsLikeOfferRequest = /\b(?:offers?|brands?|recommendations?)\s*$/.test(lower) || /(?:offer|offers|品牌|商家|推荐)\s*$/.test(text);
    const hasMetricFilter = extractMetricFilters(text).length > 0;
    const metricSort = extractMetricSortIntent(text);
    if (!hasRankCommand && !endsLikeOfferRequest && !hasMetricFilter && !metricSort) return false;
    return requestedRecommendationCount(text, 0) > 0 ||
      /\b(?:offers?|brands?|recommendations?)\b/.test(lower) ||
      /offer|offers|品牌|商家|推荐/.test(text) ||
      hasMetricFilter ||
      Boolean(metricSort) ||
      Boolean(tierFromPrompt(text)) ||
      Boolean(categoryForPrompt(text));
  }

  function collectCategories() {
    const cats = new Set();
    for (let i = 0; i < offers.length; i++) {
      const cat = offers[i].mainCategory || offers[i].category;
      if (cat && cat !== "Uncategorized") cats.add(cat);
    }
    return Array.from(cats).sort();
  }

  // ── Analysis utility functions ──────────────────────────────────────────────

  function percentileRank(value, values) {
    if (!values || !values.length) return 0;
    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var countLower = 0;
    for (var i = 0; i < sorted.length; i++) {
      if (sorted[i] < value) countLower++;
    }
    return Math.round((countLower / sorted.length) * 100);
  }

  function segmentedStats(offers, field) {
    if (!offers || !offers.length) return { head: { count: 0, avg: 0 }, mid: { count: 0, avg: 0 }, tail: { count: 0, avg: 0 } };
    var sorted = offers.slice().sort(function(a, b) { return (b[field] || 0) - (a[field] || 0); });
    var total = sorted.length;
    var headCount = Math.max(1, Math.round(total * 0.2));
    var tailCount = Math.max(1, Math.round(total * 0.2));
    var midCount = total - headCount - tailCount;
    function avg(slice) {
      if (!slice.length) return 0;
      var sum = 0;
      for (var i = 0; i < slice.length; i++) sum += (slice[i][field] || 0);
      return sum / slice.length;
    }
    return {
      head: { count: headCount, avg: avg(sorted.slice(0, headCount)) },
      mid: { count: midCount, avg: avg(sorted.slice(headCount, headCount + midCount)) },
      tail: { count: tailCount, avg: avg(sorted.slice(headCount + midCount)) }
    };
  }

  function metricLabel(field) {
    var labels = { epc: "EPC", aov: "AOV", conversionRate: "CVR", orders: "Orders", clicks: "Clicks", affCommission: "Commission", commissionRate: "Comm %", salesAmount: "Sales", dpv: "DPV", atc: "ATC" };
    return labels[field] || field;
  }

  function pctDelta(selfVal, otherVal) {
    if (otherVal == null || otherVal === 0) return "N/A";
    var delta = ((selfVal - otherVal) / Math.abs(otherVal)) * 100;
    var sign = delta >= 0 ? "+" : "";
    return sign + delta.toFixed(1) + "%";
  }

  function metricValueForOffer(offer, field) {
    if (!offer) return 0;
    if (field === "conversionRate") return (offer.conversionRate || 0) * 100;
    if (field === "commissionRate") return (offer.commissionRate || 0);
    return offer[field] || 0;
  }

  function formatAnalysisMetric(value, field) {
    if (value == null) return "N/A";
    if (field === "conversionRate" || field === "commissionRate") return pct(value / 100);
    if (field === "epc") return epc(value);
    if (field === "aov" || field === "salesAmount" || field === "affCommission") return money(value);
    if (field === "orders" || field === "clicks" || field === "dpv" || field === "atc") return number(value).toLocaleString();
    return String(value);
  }

  // Determine whether regex alone can confidently classify this query,
  // allowing us to skip the LLM API call entirely.
  //
  // We skip LLM for formulaic queries where regex is just as accurate:
  //   ASIN, merchant ID, help/greeting, attribute filters, top-N metric,
  //   tier offer plans, and any query with EXACTLY ONE clear intent signal
  //   (simple tier browse, simple category browse, simple payment, simple
  //   metric filter, simple payment-cycle filter).
  //
  // We keep LLM for:
  //   - Analysis queries (better type/target extraction + narrative text)
  //   - Recommendation queries (better multi-param disambiguation)
  //   - Multi-signal queries (tier + category, tier + metric, etc.)
  //   - Truly ambiguous queries (no regex signal at all)
  function canSkipLLMClassify(prompt) {
    var lower = String(prompt || "").toLowerCase().trim();
    if (!lower) return true;

    // ── Formulaic patterns: regex is EXACT, LLM adds ZERO value ──

    // ASIN: rigid B + 9 alphanumeric format
    if (findByAsin(prompt)) return true;

    // Merchant ID: rigid 5-8 digit format that matches a known offer
    if (findByMerchantId(prompt)) return true;

    // Help / greeting / very short prompts
    if (lower.length < 3) return true;
    if (/^(help|hello|hi|what can you do)\??$/.test(lower)) return true;
    if (/^帮助$|^你好$|^能做什么/.test(prompt)) return true;

    // Special attribute filters — keyword matching is deterministic
    if (/high epc|high aov|low conversion|low cvr|tracking issue|has asin|discount/.test(lower)) return true;
    if (/高\s*epc|高\s*aov|低转化|低转换|跟踪问题|追踪问题|有\s*asin|折扣|优惠/.test(prompt)) return true;

    // Top metric request — formulaic "top/highest EPC/AOV/commission" patterns
    if (extractTopMetricRequest(prompt)) return true;

    // Merchant name + optional metric — "Shokz EPC", "Shokz的AOV", etc.
    // The merchant name is the primary entity; metric suffix adds no ambiguity.
    // hasDirectMerchantKeywordLookup uses cleanedMerchantLookupPhrase which
    // strips metric terms ("EPC", "AOV", …) and "的" before matching.
    if (hasDirectMerchantKeywordLookup(prompt)) return true;

    // ── Intent signals (computed early — used by checks below) ──

    var tier = tierFromPrompt(prompt);
    var category = categoryForPrompt(prompt);
    var hasPaymentKeywords = /payment|paid|unpaid|late|issue|cycle/.test(lower) ||
      /付款|未付款|没付款|未支付|已付款|已支付|逾期|到期|待处理|支付|结算|款项|付款周期|支付周期|结算周期/.test(prompt);
    var hasRecommendationKeywords = /recommend|push|focus|best|should we/.test(lower) ||
      /推荐|排行|排名|最好|最佳|主推|重点|应该|筛选|前\s*\d+/.test(prompt) ||
      wantsRecommendationList(prompt);
    var hasAnalysisKeywords = /分析|评估|诊断|怎么样|表现如何|趋势|健康度|状态|评测|测测|看看|升级|降级|升降级|提升到/.test(prompt) ||
      /\b(?:analyze|analysis|evaluate|diagnose|assess|how\s+is|how\s+are|how\s+about|performance|health\s+check|trend|promotion|demotion|upgrade|downgrade)\b/i.test(lower);
    var hasMetricSignal = extractMetricSortIntent(prompt) || extractMetricFilters(prompt).length > 0;
    var hasPaymentCycleFilter = !!extractPaymentCycleFilter(prompt);

    // ── Keep LLM for analysis and recommendation ──
    // These are checked FIRST because other patterns (tier offer plan, metric
    // signals) may also match recommendation queries — but the user wants
    // analysis and recommendation to always use LLM for better param extraction.
    if (hasAnalysisKeywords) return false;
    if (hasRecommendationKeywords) return false;

    // ── Tier offer plan without recommendation keywords ──
    // Formulaic "Tier 1: 5, Tier 2: 10" with no 推荐/analysis keywords →
    // regex handles perfectly.  If recommendation keywords were present,
    // the check above already returned false.
    if (parseTierOfferRequest(prompt).length > 0) return true;

    // ── Multi-signal queries → LLM helps disambiguate ──
    // Count the non-merchant intent signals present in the prompt.
    // A single signal = simple browse ("Tier 1", "beauty", "unpaid", "EPC>1").
    // Multiple signals = complex query that benefits from LLM routing.
    var signalCount = 0;
    if (tier) signalCount++;
    if (category) signalCount++;
    if (hasPaymentKeywords) signalCount++;
    if (hasMetricSignal) signalCount++;
    if (hasPaymentCycleFilter) signalCount++;
    if (signalCount >= 2) return false;

    // ── Single clear signal → regex handles it perfectly ──
    if (signalCount === 1) return true;

    // ── No domain signal — check alternative regex paths ──

    // Strong merchant name lookup (high-confidence fuzzy match)
    if (hasStrongMerchantLookup(prompt, category)) return true;

    // Context followup (pronouns / metric references to last viewed merchant)
    if (contextFollowup(lower)) return true;

    // Keyword search intent
    if (hasKeywordSearchIntent(prompt, keywordSearchRequest(prompt), {})) return true;

    // No clear signal — ambiguous query.  Let LLM try to disambiguate.
    return false;
  }

  async function classifyWithLLM(prompt, categories) {
    const trimmed = String(prompt || "").trim();
    if (!trimmed) return null;
    if (llmClassifyCache.has(trimmed)) return llmClassifyCache.get(trimmed);
    if (state.llmEnabled === false) return null;
    try {
      const response = await fetch("/api/chat/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        credentials: "same-origin",
        body: JSON.stringify({ prompt: trimmed, categories: categories || [] }),
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) {
        console.warn("[LLM] fallback to regex: HTTP " + response.status);
        llmClassifyCache.set(trimmed, null);
        return null;
      }
      const data = await response.json().catch(() => ({}));
      const intent = data.intent || null;
      const params = (data.params && typeof data.params === "object" && !Array.isArray(data.params)) ? data.params : null;
      if (!intent) {
        llmClassifyCache.set(trimmed, null);
        return null;
      }
      const result = { intent: intent, params: params };
      llmClassifyCache.set(trimmed, result);
      return result;
    } catch (error) {
      const reason = error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : error.message || "unknown";
      console.warn("[LLM] fallback to regex: " + reason);
      llmClassifyCache.set(trimmed, null);
      return null;
    }
  }

  // ── Analysis computation functions ──────────────────────────────────────────

  function findOfferByMerchantName(name) {
    if (!name) return null;
    var lower = name.toLowerCase().trim();
    // Try exact match first
    for (var i = 0; i < offers.length; i++) {
      if ((offers[i].brand || "").toLowerCase() === lower || (offers[i].merchantName || "").toLowerCase() === lower) {
        return offers[i];
      }
    }
    // Try includes match
    for (var i = 0; i < offers.length; i++) {
      if ((offers[i].brand || "").toLowerCase().indexOf(lower) !== -1 || (offers[i].merchantName || "").toLowerCase().indexOf(lower) !== -1) {
        return offers[i];
      }
    }
    // Try fuzzy match via existing lookup
    var matches = findMerchantMatches(name);
    if (matches && matches.length) return matches[0];
    return null;
  }

  function offersInCategory(categoryName) {
    if (!categoryName) return [];
    var lower = categoryName.toLowerCase().trim();
    return offers.filter(function(o) {
      var cat = (o.mainCategory || o.category || "").toLowerCase();
      return cat === lower || cat.indexOf(lower) !== -1;
    });
  }

  function offersInTier(tierName) {
    if (!tierName) return [];
    return offers.filter(function(o) { return o.tier === tierName; });
  }

  function globalAverages() {
    var metrics = ["epc", "aov", "conversionRate", "orders", "clicks", "affCommission", "commissionRate", "salesAmount"];
    var result = {};
    for (var m = 0; m < metrics.length; m++) {
      var field = metrics[m];
      var values = [];
      for (var i = 0; i < offers.length; i++) {
        var v = field === "conversionRate" ? (offers[i].conversionRate || 0) * 100 : (offers[i][field] || 0);
        if (v > 0) values.push(v);
      }
      result[field] = values.length ? values.reduce(function(a, b) { return a + b; }, 0) / values.length : 0;
    }
    return result;
  }

  function analyzeMerchant(name) {
    var offer = findOfferByMerchantName(name);
    if (!offer) return null;

    var category = offer.mainCategory || offer.category || "Uncategorized";
    var tier = offer.tier || "Unknown";
    var categoryOffers = offersInCategory(category);
    var tierOffers = offersInTier(tier);
    var globals = globalAverages();

    var fields = ["epc", "aov", "conversionRate", "orders", "clicks", "affCommission", "commissionRate", "salesAmount"];
    var metrics = {};
    for (var f = 0; f < fields.length; f++) {
      metrics[fields[f]] = metricValueForOffer(offer, fields[f]);
    }

    // Percentile ranks within category
    var ranks = {};
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      var catValues = [];
      for (var i = 0; i < categoryOffers.length; i++) {
        catValues.push(metricValueForOffer(categoryOffers[i], field));
      }
      ranks[field] = {
        value: metrics[field],
        percentile: percentileRank(metrics[field], catValues),
        totalInCategory: categoryOffers.length
      };
    }

    // Comparisons
    function avgField(offList, field) {
      if (!offList.length) return 0;
      var sum = 0;
      for (var i = 0; i < offList.length; i++) sum += metricValueForOffer(offList[i], field);
      return sum / offList.length;
    }

    function compare(selfVal, otherAvg) {
      return { self: selfVal, avg: otherAvg, delta: pctDelta(selfVal, otherAvg) };
    }

    var comparisons = { vsCategory: {}, vsTier: {}, vsGlobal: {} };
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      comparisons.vsCategory[field] = compare(metrics[field], avgField(categoryOffers, field));
      comparisons.vsTier[field] = compare(metrics[field], avgField(tierOffers, field));
      comparisons.vsGlobal[field] = compare(metrics[field], globals[field]);
    }

    // Strengths and weaknesses (based on category percentile)
    var strengths = [];
    var weaknesses = [];
    for (var f = 0; f < fields.length; f++) {
      if (ranks[fields[f]].percentile >= 70) strengths.push(fields[f]);
      if (ranks[fields[f]].percentile <= 30) weaknesses.push(fields[f]);
    }

    // Payment risk
    var paymentRisk = {
      hasOverdue: hasOfferOverduePayment ? hasOfferOverduePayment(offer) : false,
      riskText: paymentRiskTextForOffer ? paymentRiskTextForOffer(offer) : "N/A"
    };

    // Peers (same category + same tier, top 3 by commission)
    var peers = categoryOffers.filter(function(o) {
      return o.tier === tier && (o.brand || o.merchantName) !== (offer.brand || offer.merchantName);
    }).sort(function(a, b) {
      return (b.affCommission || 0) - (a.affCommission || 0);
    }).slice(0, 3).map(function(o) {
      var pm = {};
      for (var f = 0; f < fields.length; f++) {
        pm[fields[f]] = metricValueForOffer(o, fields[f]);
      }
      return { name: o.brand || o.merchantName || "Unknown", metrics: pm };
    });

    return {
      type: "merchant",
      target: { name: offer.brand || offer.merchantName || name, id: offer.merchantId || "", tier: tier, category: category },
      metrics: metrics,
      ranks: ranks,
      comparisons: comparisons,
      strengths: strengths,
      weaknesses: weaknesses,
      paymentRisk: paymentRisk,
      peers: peers
    };
  }

  function analyzeCategory(name) {
    var catOffers = offersInCategory(name);
    if (!catOffers.length) return null;

    var canonicalName = catOffers[0].mainCategory || catOffers[0].category || name;
    var globals = globalAverages();

    // Tier distribution
    var tierDist = {};
    for (var i = 0; i < catOffers.length; i++) {
      var t = catOffers[i].tier || "Unknown";
      tierDist[t] = (tierDist[t] || 0) + 1;
    }

    // Aggregates
    function sumField(list, field) {
      var s = 0;
      for (var i = 0; i < list.length; i++) s += metricValueForOffer(list[i], field);
      return s;
    }
    function avgField(list, field) {
      return list.length ? sumField(list, field) / list.length : 0;
    }

    var aggregates = {
      merchantCount: catOffers.length,
      totalRevenue: sumField(catOffers, "salesAmount"),
      totalCommission: sumField(catOffers, "affCommission"),
      totalOrders: sumField(catOffers, "orders"),
      avgEpc: avgField(catOffers, "epc"),
      avgAov: avgField(catOffers, "aov"),
      avgCvr: avgField(catOffers, "conversionRate"),
      avgCommissionRate: avgField(catOffers, "commissionRate")
    };

    // vs Global
    var vsGlobal = {};
    var compFields = ["epc", "aov", "conversionRate", "commissionRate"];
    for (var f = 0; f < compFields.length; f++) {
      var field = compFields[f];
      vsGlobal[field] = { self: aggregates["avg" + field.charAt(0).toUpperCase() + field.slice(1)] || avgField(catOffers, field), global: globals[field], delta: pctDelta(avgField(catOffers, field), globals[field]) };
    }

    // Top 5 and Bottom 3 by commission
    var byCommission = catOffers.slice().sort(function(a, b) { return (b.affCommission || 0) - (a.affCommission || 0); });
    function briefOffer(o) {
      return {
        name: o.brand || o.merchantName || "Unknown",
        tier: o.tier || "Unknown",
        epc: o.epc || 0,
        aov: o.aov || 0,
        conversionRate: (o.conversionRate || 0) * 100,
        affCommission: o.affCommission || 0
      };
    }
    var topMerchants = byCommission.slice(0, 5).map(briefOffer);
    var bottomMerchants = byCommission.slice(-3).reverse().map(briefOffer);

    return {
      type: "category",
      target: { name: canonicalName, merchantCount: catOffers.length, tierDistribution: tierDist },
      aggregates: aggregates,
      vsGlobal: vsGlobal,
      topMerchants: topMerchants,
      bottomMerchants: bottomMerchants
    };
  }

  function analyzeTier(name) {
    var tierOffers = offersInTier(name);
    if (!tierOffers.length) return null;

    var allTiers = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"];
    var globals = globalAverages();

    function sumField(list, field) {
      var s = 0;
      for (var i = 0; i < list.length; i++) s += metricValueForOffer(list[i], field);
      return s;
    }
    function avgField(list, field) {
      return list.length ? sumField(list, field) / list.length : 0;
    }

    var aggregates = {
      merchantCount: tierOffers.length,
      totalRevenue: sumField(tierOffers, "salesAmount"),
      totalCommission: sumField(tierOffers, "affCommission"),
      totalOrders: sumField(tierOffers, "orders"),
      avgEpc: avgField(tierOffers, "epc"),
      avgAov: avgField(tierOffers, "aov"),
      avgCvr: avgField(tierOffers, "conversionRate"),
      avgCommissionRate: avgField(tierOffers, "commissionRate")
    };

    // vs Other Tiers
    var vsOtherTiers = {};
    for (var t = 0; t < allTiers.length; t++) {
      var otherTier = allTiers[t];
      if (otherTier === name) continue;
      var otherOffers = offersInTier(otherTier);
      if (!otherOffers.length) continue;
      var comp = {};
      var compFields = ["epc", "aov", "conversionRate", "commissionRate"];
      for (var f = 0; f < compFields.length; f++) {
        var field = compFields[f];
        var selfAvg = avgField(tierOffers, field);
        var otherAvg = avgField(otherOffers, field);
        comp[field] = { self: selfAvg, other: otherAvg, delta: pctDelta(selfAvg, otherAvg) };
      }
      vsOtherTiers[otherTier] = comp;
    }

    // Segments (by commission)
    var segments = segmentedStats(tierOffers, "affCommission");

    // Outliers
    var tierAvgEpc = aggregates.avgEpc;
    var tierAvgCvr = aggregates.avgCvr;
    var outliers = [];
    for (var i = 0; i < tierOffers.length; i++) {
      var o = tierOffers[i];
      var oEpc = o.epc || 0;
      var oCvr = (o.conversionRate || 0) * 100;
      var nameO = o.brand || o.merchantName || "Unknown";
      if (tierAvgEpc > 0 && oEpc > tierAvgEpc * 3) {
        outliers.push({ name: nameO, reason: "EPC " + epc(oEpc) + "远超同级均值 " + epc(tierAvgEpc) });
      }
      if (tierAvgCvr > 0 && oCvr > tierAvgCvr * 2) {
        outliers.push({ name: nameO, reason: "CVR " + pct(oCvr / 100) + "远超同级均值 " + pct(tierAvgCvr / 100) });
      }
    }

    return {
      type: "tier",
      target: { name: name, merchantCount: tierOffers.length },
      aggregates: aggregates,
      vsOtherTiers: vsOtherTiers,
      segments: segments,
      outliers: outliers.slice(0, 5)
    };
  }

  // ── Analysis table rendering ────────────────────────────────────────────────

  function renderAnalysisTable(summary) {
    if (!summary) return "<p>No analysis data available.</p>";
    if (summary.type === "merchant") return renderMerchantAnalysisTable(summary);
    if (summary.type === "category") return renderCategoryAnalysisTable(summary);
    if (summary.type === "tier") return renderTierAnalysisTable(summary);
    return "<p>Unknown analysis type.</p>";
  }

  function renderMerchantAnalysisTable(s) {
    var lang = state.language || "en";
    var zh = lang === "zh";
    var fields = ["epc", "aov", "conversionRate", "orders", "affCommission", "commissionRate"];
    var html = "";

    // Core metrics table with percentile ranks
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "核心指标" : "Core Metrics") + "</h4>";
    var firstRank = s.ranks[fields[0]];
    var totalCat = firstRank ? firstRank.totalInCategory : 0;
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "指标" : "Metric") + "</th><th>" + (zh ? "数值" : "Value") + "</th><th>" + (zh ? "品类排名" : "Category Rank") + (totalCat ? " (" + totalCat + " " + (zh ? "个商户" : "merchants") + ")" : "") + "</th></tr></thead><tbody>";
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      var rank = s.ranks[field];
      html += "<tr><td>" + metricLabel(field) + "</td><td>" + formatAnalysisMetric(rank.value, field) + "</td><td>" + (zh ? "前" : "Top ") + (100 - rank.percentile) + "%</td></tr>";
    }
    html += "</tbody></table></div>";

    // Comparisons
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "横向对比" : "Comparisons") + "</h4>";
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "指标" : "Metric") + "</th><th>" + (zh ? "当前" : "Current") + "</th><th>" + (zh ? "品类均值" : "Category Avg") + "</th><th>" + (zh ? "差异" : "Delta") + "</th></tr></thead><tbody>";
    for (var f = 0; f < fields.length; f++) {
      var field = fields[f];
      var comp = s.comparisons.vsCategory[field];
      html += "<tr><td>" + metricLabel(field) + "</td><td>" + formatAnalysisMetric(comp.self, field) + "</td><td>" + formatAnalysisMetric(comp.avg, field) + "</td><td>" + escapeHtml(comp.delta) + "</td></tr>";
    }
    html += "</tbody></table></div>";

    // Strengths & Weaknesses
    html += "<div class=\"analysis-section\">";
    if (s.strengths.length) {
      html += "<p><strong>" + (zh ? "亮点：" : "Strengths: ") + "</strong>";
      var strLabels = [];
      for (var i = 0; i < s.strengths.length; i++) strLabels.push(metricLabel(s.strengths[i]) + " (" + (zh ? "品类前" : "top ") + (100 - s.ranks[s.strengths[i]].percentile) + "%)");
      html += escapeHtml(strLabels.join(", ")) + "</p>";
    }
    if (s.weaknesses.length) {
      html += "<p><strong>" + (zh ? "短板：" : "Weaknesses: ") + "</strong>";
      var weakLabels = [];
      for (var i = 0; i < s.weaknesses.length; i++) weakLabels.push(metricLabel(s.weaknesses[i]) + " (" + (zh ? "品类后" : "bottom ") + (100 - s.ranks[s.weaknesses[i]].percentile) + "%)");
      html += escapeHtml(weakLabels.join(", ")) + "</p>";
    }
    if (!s.strengths.length && !s.weaknesses.length) {
      html += "<p>" + (zh ? "该商户各项指标处于品类中等水平。" : "All metrics are near the category median.") + "</p>";
    }
    html += "<p><strong>" + (zh ? "支付状态：" : "Payment: ") + "</strong>" + escapeHtml(s.paymentRisk.riskText || (zh ? "无风险" : "No risk")) + "</p>";
    html += "</div>";

    // Peers
    if (s.peers && s.peers.length) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "同类商户对比" : "Peer Comparison") + "</h4>";
      html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "商户" : "Merchant") + "</th>";
      for (var f = 0; f < fields.length; f++) html += "<th>" + metricLabel(fields[f]) + "</th>";
      html += "</tr></thead><tbody>";
      // Current merchant row
      html += "<tr style=\"font-weight:bold\"><td>" + escapeHtml(s.target.name) + "</td>";
      for (var f = 0; f < fields.length; f++) html += "<td>" + formatAnalysisMetric(s.metrics[fields[f]], fields[f]) + "</td>";
      html += "</tr>";
      // Peer rows
      for (var p = 0; p < s.peers.length; p++) {
        var peer = s.peers[p];
        html += "<tr><td>" + escapeHtml(peer.name) + "</td>";
        for (var f = 0; f < fields.length; f++) html += "<td>" + formatAnalysisMetric(peer.metrics[fields[f]] || 0, fields[f]) + "</td>";
        html += "</tr>";
      }
      html += "</tbody></table></div>";
    }

    return html;
  }

  function renderCategoryAnalysisTable(s) {
    var lang = state.language || "en";
    var zh = lang === "zh";
    var html = "";

    // Aggregates
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "品类概览" : "Category Overview") + "</h4>";
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "指标" : "Metric") + "</th><th>" + (zh ? "数值" : "Value") + "</th></tr></thead><tbody>";
    html += "<tr><td>" + (zh ? "商户数" : "Merchants") + "</td><td>" + s.aggregates.merchantCount + "</td></tr>";
    html += "<tr><td>" + (zh ? "总收入" : "Total Revenue") + "</td><td>" + money(s.aggregates.totalRevenue) + "</td></tr>";
    html += "<tr><td>" + (zh ? "总佣金" : "Total Commission") + "</td><td>" + money(s.aggregates.totalCommission) + "</td></tr>";
    html += "<tr><td>" + (zh ? "总订单" : "Total Orders") + "</td><td>" + number(s.aggregates.totalOrders).toLocaleString() + "</td></tr>";
    html += "<tr><td>Avg EPC</td><td>" + epc(s.aggregates.avgEpc) + "</td></tr>";
    html += "<tr><td>Avg AOV</td><td>" + money(s.aggregates.avgAov) + "</td></tr>";
    html += "<tr><td>Avg CVR</td><td>" + pct(s.aggregates.avgCvr / 100) + "</td></tr>";
    html += "<tr><td>" + (zh ? "平均佣金率" : "Avg Comm Rate") + "</td><td>" + pct(s.aggregates.avgCommissionRate / 100) + "</td></tr>";
    html += "</tbody></table></div>";

    // vs Global
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "与全站均值对比" : "vs Global Average") + "</h4>";
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "指标" : "Metric") + "</th><th>" + (zh ? "品类" : "Category") + "</th><th>" + (zh ? "全站" : "Global") + "</th><th>Delta</th></tr></thead><tbody>";
    var keys = Object.keys(s.vsGlobal);
    for (var i = 0; i < keys.length; i++) {
      var v = s.vsGlobal[keys[i]];
      html += "<tr><td>" + metricLabel(keys[i]) + "</td><td>" + formatAnalysisMetric(v.self, keys[i]) + "</td><td>" + formatAnalysisMetric(v.global, keys[i]) + "</td><td>" + escapeHtml(v.delta) + "</td></tr>";
    }
    html += "</tbody></table></div>";

    // Top & Bottom
    if (s.topMerchants && s.topMerchants.length) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "品类 Top 5（按佣金）" : "Top 5 by Commission") + "</h4>";
      html += "<table class=\"analysis-table\"><thead><tr><th>#</th><th>" + (zh ? "商户" : "Merchant") + "</th><th>Tier</th><th>EPC</th><th>CVR</th><th>" + (zh ? "佣金" : "Commission") + "</th></tr></thead><tbody>";
      for (var i = 0; i < s.topMerchants.length; i++) {
        var m = s.topMerchants[i];
        html += "<tr><td>" + (i + 1) + "</td><td>" + escapeHtml(m.name) + "</td><td>" + escapeHtml(m.tier) + "</td><td>" + epc(m.epc) + "</td><td>" + pct(m.conversionRate / 100) + "</td><td>" + money(m.affCommission) + "</td></tr>";
      }
      html += "</tbody></table></div>";
    }

    return html;
  }

  function renderTierAnalysisTable(s) {
    var lang = state.language || "en";
    var zh = lang === "zh";
    var html = "";

    // Aggregates
    html += "<div class=\"analysis-section\"><h4>" + (zh ? "层级概览" : "Tier Overview") + "</h4>";
    html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "指标" : "Metric") + "</th><th>" + (zh ? "数值" : "Value") + "</th></tr></thead><tbody>";
    html += "<tr><td>" + (zh ? "商户数" : "Merchants") + "</td><td>" + s.aggregates.merchantCount + "</td></tr>";
    html += "<tr><td>" + (zh ? "总收入" : "Total Revenue") + "</td><td>" + money(s.aggregates.totalRevenue) + "</td></tr>";
    html += "<tr><td>" + (zh ? "总佣金" : "Total Commission") + "</td><td>" + money(s.aggregates.totalCommission) + "</td></tr>";
    html += "<tr><td>" + (zh ? "总订单" : "Total Orders") + "</td><td>" + number(s.aggregates.totalOrders).toLocaleString() + "</td></tr>";
    html += "<tr><td>Avg EPC</td><td>" + epc(s.aggregates.avgEpc) + "</td></tr>";
    html += "<tr><td>Avg AOV</td><td>" + money(s.aggregates.avgAov) + "</td></tr>";
    html += "<tr><td>Avg CVR</td><td>" + pct(s.aggregates.avgCvr / 100) + "</td></tr>";
    html += "</tbody></table></div>";

    // vs Other Tiers
    var tierKeys = Object.keys(s.vsOtherTiers);
    if (tierKeys.length) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "跨层对比" : "Cross-Tier Comparison") + "</h4>";
      html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "指标" : "Metric") + "</th><th>" + escapeHtml(s.target.name) + "</th>";
      for (var t = 0; t < tierKeys.length; t++) html += "<th>" + escapeHtml(tierKeys[t]) + " (Delta)</th>";
      html += "</tr></thead><tbody>";
      var compFields = ["epc", "aov", "conversionRate", "commissionRate"];
      for (var f = 0; f < compFields.length; f++) {
        var field = compFields[f];
        html += "<tr><td>" + metricLabel(field) + "</td><td>" + formatAnalysisMetric(s.vsOtherTiers[tierKeys[0]][field].self, field) + "</td>";
        for (var t = 0; t < tierKeys.length; t++) {
          var comp = s.vsOtherTiers[tierKeys[t]][field];
          html += "<td>" + formatAnalysisMetric(comp.other, field) + " (" + escapeHtml(comp.delta) + ")</td>";
        }
        html += "</tr>";
      }
      html += "</tbody></table></div>";
    }

    // Segments
    if (s.segments) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "商户分化（按佣金）" : "Segmentation (by Commission)") + "</h4>";
      html += "<table class=\"analysis-table\"><thead><tr><th>" + (zh ? "分段" : "Segment") + "</th><th>" + (zh ? "商户数" : "Count") + "</th><th>" + (zh ? "平均佣金" : "Avg Commission") + "</th></tr></thead><tbody>";
      html += "<tr><td>" + (zh ? "头部 (Top 20%)" : "Head (Top 20%)") + "</td><td>" + s.segments.head.count + "</td><td>" + money(s.segments.head.avg) + "</td></tr>";
      html += "<tr><td>" + (zh ? "中部 (Mid 60%)" : "Mid (60%)") + "</td><td>" + s.segments.mid.count + "</td><td>" + money(s.segments.mid.avg) + "</td></tr>";
      html += "<tr><td>" + (zh ? "尾部 (Bottom 20%)" : "Tail (Bottom 20%)") + "</td><td>" + s.segments.tail.count + "</td><td>" + money(s.segments.tail.avg) + "</td></tr>";
      html += "</tbody></table></div>";
    }

    // Outliers
    if (s.outliers && s.outliers.length) {
      html += "<div class=\"analysis-section\"><h4>" + (zh ? "异常值" : "Outliers") + "</h4><ul>";
      for (var i = 0; i < s.outliers.length; i++) {
        html += "<li><strong>" + escapeHtml(s.outliers[i].name) + "</strong>: " + escapeHtml(s.outliers[i].reason) + "</li>";
      }
      html += "</ul></div>";
    }

    return html;
  }

  // ── LLM analysis text (async) ──────────────────────────────────────────────

  async function fetchAnalysisText(summary, language) {
    try {
      var response = await fetch("/api/chat/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        credentials: "same-origin",
        body: JSON.stringify({ summary: summary, language: language || "en" }),
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        console.warn("[analysis] HTTP " + response.status);
        return null;
      }
      var data = await response.json().catch(function() { return {}; });
      if (data.ok && data.text) return data.text;
      return null;
    } catch (error) {
      console.warn("[analysis] fetch error: " + (error.message || "unknown"));
      return null;
    }
  }

  function renderAnalysisNarrative(containerEl, text) {
    if (!containerEl || !text) return;
    var p = document.createElement("div");
    p.className = "analysis-narrative";
    p.innerHTML = "<p>" + escapeHtml(text).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>") + "</p>";
    containerEl.appendChild(p);
  }

  function fallbackAnalysisText(summary, language) {
    var zh = language === "zh";
    var lines = [];
    if (summary.type === "merchant") {
      var name = summary.target.name;
      if (summary.strengths && summary.strengths.length) {
        var sNames = [];
        for (var i = 0; i < summary.strengths.length; i++) sNames.push(metricLabel(summary.strengths[i]));
        lines.push(zh ? (escapeHtml(name) + " 的亮点是 " + sNames.join("、") + " 处于品类前列。") : (escapeHtml(name) + " stands out in " + sNames.join(", ") + " within its category."));
      }
      if (summary.weaknesses && summary.weaknesses.length) {
        var wNames = [];
        for (var i = 0; i < summary.weaknesses.length; i++) wNames.push(metricLabel(summary.weaknesses[i]));
        lines.push(zh ? ("关注点：" + wNames.join("、") + " 低于品类均值，建议优化。") : ("Areas to watch: " + wNames.join(", ") + " are below category average."));
      }
      if (!lines.length) {
        lines.push(zh ? (escapeHtml(name) + " 各项指标处于品类中等水平，表现稳定。") : (escapeHtml(name) + " metrics are near the category median — stable performance."));
      }
      if (summary.paymentRisk && summary.paymentRisk.hasOverdue) {
        lines.push(zh ? "⚠ 该商户存在逾期付款风险，建议关注。" : "⚠ This merchant has overdue payment risk.");
      }
    } else if (summary.type === "category") {
      var catName = summary.target.name;
      lines.push(zh ? (escapeHtml(catName) + " 品类共 " + summary.aggregates.merchantCount + " 个商户。") : (escapeHtml(catName) + " has " + summary.aggregates.merchantCount + " merchants."));
      var vsGlobalKeys = Object.keys(summary.vsGlobal || {});
      for (var i = 0; i < vsGlobalKeys.length; i++) {
        var v = summary.vsGlobal[vsGlobalKeys[i]];
        if (v.delta && v.delta.indexOf("+") === 0) {
          lines.push(metricLabel(vsGlobalKeys[i]) + (zh ? " 高于全站均值 " : " above global average by ") + escapeHtml(v.delta) + "。");
        }
      }
      if (!lines.length) lines.push(zh ? "该品类整体表现与全站均值持平。" : "This category performs at global average levels.");
    } else if (summary.type === "tier") {
      var tierName = summary.target.name;
      lines.push(zh ? (escapeHtml(tierName) + " 共 " + summary.aggregates.merchantCount + " 个商户。") : (escapeHtml(tierName) + " has " + summary.aggregates.merchantCount + " merchants."));
      if (summary.segments) {
        lines.push(zh ? ("头部 " + summary.segments.head.count + " 个商户贡献主要佣金，尾部 " + summary.segments.tail.count + " 个商户可能需关注。") : ("Top " + summary.segments.head.count + " merchants drive most commission; bottom " + summary.segments.tail.count + " may need attention."));
      }
    }
    return lines.join("<br>");
  }

  // ── Analysis answer router ──────────────────────────────────────────────────

  function analysisAnswer(prompt, params) {
    console.log("[analysis] analysisAnswer called, prompt:", prompt, "params:", JSON.stringify(params));
    try {
      var language = responseLanguageFor(prompt);
      var zh = language === "zh";
      var analysisType = params.analysisType;
      var analysisTarget = params.analysisTarget;

      // If analysis type or target not specified, try to infer from prompt.
      // LLMs sometimes return {analysisType:"merchant"} without analysisTarget,
      // so we must also infer when analysisTarget is missing (not just type).
      if (!analysisType || !analysisTarget) {
        var searchTarget = analysisTarget || prompt;
        var merchantOffer = findOfferByMerchantName(searchTarget);
        if (merchantOffer) {
          if (!analysisType) analysisType = "merchant";
          if (!analysisTarget) analysisTarget = merchantOffer.brand || merchantOffer.merchantName;
        } else if (categoryForPrompt(searchTarget)) {
          if (!analysisType) analysisType = "category";
          if (!analysisTarget) analysisTarget = categoryForPrompt(searchTarget);
        } else if (tierFromPrompt(searchTarget)) {
          if (!analysisType) analysisType = "tier";
          if (!analysisTarget) analysisTarget = tierFromPrompt(searchTarget);
        } else if (!analysisType) {
          // Default: try merchant search (only when type is also missing)
          analysisType = "merchant";
        }
      }

      // Ensure target (last resort)
      if (!analysisTarget) analysisTarget = prompt;

      console.log("[analysis] type:", analysisType, "target:", analysisTarget);

      // Run analysis
      var summary = null;
      if (analysisType === "merchant") {
        summary = analyzeMerchant(analysisTarget);
      } else if (analysisType === "category") {
        summary = analyzeCategory(analysisTarget);
      } else if (analysisType === "tier") {
        summary = analyzeTier(analysisTarget);
      }

      console.log("[analysis] summary:", summary ? ("type=" + summary.type + " target=" + (summary.target && summary.target.name)) : "null");

      if (!summary) {
        return zh
          ? ("未找到 <strong>" + escapeHtml(analysisTarget) + "</strong> 的数据。请检查名称是否正确，或尝试用英文名称查询。")
          : ("No data found for <strong>" + escapeHtml(analysisTarget) + "</strong>. Please check the name and try again.");
      }

      // Set context
      if (analysisType === "merchant") {
        var offer = findOfferByMerchantName(analysisTarget);
        setContext(offer ? buildMerchantContext(offer) : null);
      } else if (analysisType === "category") {
        var catRows = offersInCategory(analysisTarget);
        setContext(buildCategoryContext(analysisTarget, catRows.slice(0, 80)));
      } else if (analysisType === "tier") {
        var tierRows = offersInTier(analysisTarget);
        setContext(buildTierContext(analysisTarget, tierRows));
      }

      // Build table HTML immediately
      var tableHtml = renderAnalysisTable(summary);
      console.log("[analysis] tableHtml length:", tableHtml.length);

      // Placeholder for narrative text (loaded async)
      var narrativeId = "analysis-narrative-" + Date.now();
      var loadingText = zh ? "正在生成分析…" : "Generating analysis…";
      var html = tableHtml + "<div id=\"" + narrativeId + "\" class=\"analysis-narrative-placeholder\"><p><em>" + loadingText + "</em></p></div>";

      // Async: fetch LLM text or fallback (deferred so DOM is ready)
      setTimeout(function() {
        var container = document.getElementById(narrativeId);
        if (!container) { console.warn("[analysis] container not found:", narrativeId); return; }
        (async function() {
          try {
            console.log("[analysis] fetching LLM text...");
            var text = await fetchAnalysisText(summary, language);
            console.log("[analysis] LLM text:", text ? ("len=" + text.length) : "null, using fallback");
            if (!text) text = fallbackAnalysisText(summary, language);
            container.innerHTML = "";
            renderAnalysisNarrative(container, text);
          } catch (e) {
            console.error("[analysis] async narrative error:", e);
            container.innerHTML = "<p>" + escapeHtml(fallbackAnalysisText(summary, language)) + "</p>";
          }
        })();
      }, 0);

      return html;
    } catch (error) {
      console.error("[analysis] analysisAnswer error:", error);
      return (language === "zh"
        ? "分析过程出错：" + escapeHtml(error.message || "unknown")
        : "Analysis error: " + escapeHtml(error.message || "unknown"));
    }
  }

  function detectQueryIntent(userMessage) {
    if (state.llmClassifyResult && state.llmClassifyResult.intent) {
      const intent = state.llmClassifyResult.intent;
      state.llmClassifyResult = null;
      return intent;
    }
    const lower = userMessage.toLowerCase().trim();
    if (findByAsin(userMessage)) return "asin";
    if (findByMerchantId(userMessage)) return "merchant";
    const zhIntent = chatbotI18n.detectIntent && chatbotI18n.detectIntent(userMessage);
    const category = categoryForPrompt(userMessage);
    const metricSort = extractMetricSortIntent(userMessage);
    const metricFilters = extractMetricFilters(userMessage);
    const keywordRequest = keywordSearchRequest(userMessage);
    if (zhIntent && zhIntent !== "recommendation" && zhIntent !== "category") return zhIntent;
    // keyword 搜索：仅当没有匹配到类别时，才优先于 merchant/category
    if (!category && keywordRequest && hasKeywordSearchIntent(userMessage, keywordRequest, { category })) return "keyword";
    if (/payment|paid|unpaid|late|issue|cycle/.test(lower) || /付款|未付款|没付款|未支付|已付款|已支付|逾期|到期|待处理|支付|结算|款项|付款周期|支付周期|结算周期/.test(userMessage)) return "payment";
    if (hasStrongMerchantLookup(userMessage, category)) return "merchant";
    if (zhIntent === "recommendation") return "recommendation";
    if (metricSort) return "recommendation";
    if (metricFilters.length) return "recommendation";
    if (/recommend|push|focus|best|should we/.test(lower) || /推荐|排行|排名|最好|最佳|主推|重点|应该|筛选|前\s*\d+/.test(userMessage) || wantsRecommendationList(userMessage)) return "recommendation";
    if (/分析|评估|诊断|怎么样|表现如何|趋势|健康度|状态|评测|测测|看看|升级|降级|升降级|提升到/.test(userMessage)) return "analysis";
    if (/\b(?:analyze|analyse|analysis|evaluate|diagnose|assess|how\s+is|how\s+are|how\s+about|performance|health\s+check|trend|promotion|demotion|upgrade|downgrade)\b/i.test(lower)) return "analysis";
    if (tierFromPrompt(userMessage)) return "tier";
    if (category || zhIntent === "category") return "category";
    if (contextFollowup(lower)) return "merchant";
    return "merchant";
  }

  function recommendationScore(offer, context = {}) {
    const includeTier4 = context.includeTier4 || false;
    const includeBlack = context.includeBlack || false;
    const priority = tierPriority(offer, includeTier4, includeBlack);
    if (priority >= 99) return -9999;
    if (offer.tier === "Tier 2" && highlightStatus(offer) === "Optimization only") return -9999;

    const clicks = number(offer.clicks);
    const orders = number(offer.orders);
    const confidence = Math.min(1, Math.sqrt(Math.max(clicks, 0) / 250));

    let score = 100 - priority * 14;
    score += Math.log10(orders + 1) * 12;
    score += Math.log10(clicks + 1) * 3;
    score += number(offer.conversionRate) * 260 * confidence;
    score += Math.min(number(offer.epc), 5) * 8 * Math.max(confidence, 0.35);
    score += Math.min(number(offer.salesAmount), 100000) / 12000;
    score += Math.min(number(offer.atc), 500) / 80;
    score += offer.hasDiscount ? 7 : 0;
    score += offer.hasAsin ? 2 : 0;
    score += offer.recommendedLink ? 2 : 0;
    score -= clicks > 0 && clicks < 25 ? 12 : 0;
    score -= orders > 0 && orders < 5 ? 8 : 0;
    score -= hasPaymentRisk(offer) ? 32 : 0;
    score -= offer.trackingIssue ? 20 : 0;
    score -= offer.tier === "Tier 4" ? 40 : 0;
    score -= offer.tier === "BLACK TIER" ? 100 : 0;

    const publisherStrategy = tier2PublisherStrategy(offer, "en");
    if (publisherStrategy) {
      const publisherScoreAdjustments = {
        green_optimize: 7,
        green_under_sample: 5,
        under_sample: 3,
        maintain_optimize: 2,
        low_success_replace: -4,
        red_recovery: -6
      };
      score += publisherScoreAdjustments[publisherStrategy.code] || 0;
    }

    if (context.category && categoryMatches(offer, context.category)) score += 14;
    if (context.google) {
      score += number(offer.orders) >= 50 ? 8 : -4;
      score += number(offer.conversionRate) >= 0.01 ? 7 : -2;
      score += number(offer.clicks) >= 500 ? 4 : 0;
    }
    return score;
  }

  function compareRecommendationOffers(a, b, context = {}) {
    const includeTier4 = context.includeTier4 || false;
    const includeBlack = context.includeBlack || false;
    const metricSort = context.metricSort;
    if (metricSort && metricSort.field) {
      const tierDelta = tierPriority(a, includeTier4, includeBlack) - tierPriority(b, includeTier4, includeBlack);
      if (tierDelta) return tierDelta;
      const metricDelta = metricSort.direction === "asc"
        ? number(a[metricSort.field]) - number(b[metricSort.field])
        : number(b[metricSort.field]) - number(a[metricSort.field]);
      if (metricDelta) return metricDelta;
    }
    return (
      number(b.salesAmount) - number(a.salesAmount) ||
      number(b.orders) - number(a.orders) ||
      number(b.conversionRate) - number(a.conversionRate) ||
      number(b.aov) - number(a.aov) ||
      number(b.epc) - number(a.epc) ||
      tierPriority(a, includeTier4, includeBlack) - tierPriority(b, includeTier4, includeBlack) ||
      number(b.affCommission) - number(a.affCommission) ||
      number(b.clicks) - number(a.clicks) ||
      String(a.brand || "").localeCompare(String(b.brand || ""), undefined, { numeric: true, sensitivity: "base" })
    );
  }

  // ── Category ranking functions ─────────────────────────────────────────────

  function categoryRankingScore(category) {
    // Compute a composite score for a category, used to rank categories
    // in the "recommended categories" feature.  Heavily weighted toward
    // revenue and commission, with secondary weights for scale and efficiency.
    var rows = offers.filter(function(o) { return categoryMatches(o, category); });
    if (!rows.length) return 0;
    var s = aggregateRows(rows);
    var totalRevenue = s.totalRevenue || 0;
    var totalCommission = s.totalCommission || 0;
    var totalOrders = s.totalOrders || 0;
    var offerCount = rows.length;
    var avgAov = s.avgAov || 0;
    var blendedEpc = s.blendedEpc || 0;
    var tier1Count = rows.filter(function(o) { return o.tier === "Tier 1"; }).length;
    var coreTier2Count = rows.filter(function(o) { return o.tier === "Tier 2" && highlightStatus(o) !== "Optimization only"; }).length;
    var paymentRiskCount = rows.filter(hasPaymentRisk).length;
    var score = 0;
    score += Math.log10(totalRevenue + 1) * 25;
    score += Math.log10(totalCommission + 1) * 20;
    score += Math.log10(offerCount + 1) * 10;
    score += Math.log10(totalOrders + 1) * 8;
    score += Math.min(avgAov, 500) / 15;
    score += Math.min(blendedEpc, 5) * 20;
    score += (tier1Count + coreTier2Count) * 3;
    score -= (paymentRiskCount / Math.max(offerCount, 1)) * 15;
    return Math.round(score);
  }

  function computeCategoryRankings() {
    var cats = uniqueCategoryValues();
    return cats
      .map(function(cat) { return { category: cat, score: categoryRankingScore(cat) }; })
      .sort(function(a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.category.localeCompare(b.category);
      });
  }

  function renderCategoryOfferRow(offer, index, language) {
    return '<div class="recommendation-answer" style="margin-left:1em;border-left:3px solid var(--accent-color,#4a90d9);padding-left:12px">' +
      '<strong>' + (index + 1) + '. ' + escapeHtml(offer.brand || "") + '</strong> - ' + escapeHtml(tierGroup(offer)) +
      '<ul>' +
      '<li><strong>' + (language === "zh" ? "关键指标" : "Key metrics") + ':</strong> AOV ' + shortMoney(offer.aov) + ', EPC ' + shortEpc(offer.epc) + ', CVR ' + shortPct(offer.conversionRate) + ', Orders ' + number(offer.orders).toLocaleString() + ', Revenue ' + shortMoney(offer.salesAmount) + '</li>' +
      '<li><strong>' + (language === "zh" ? "推荐理由" : "Why recommended") + ':</strong> ' + escapeHtml(whyRecommended(offer, { language: language })) + '</li>' +
      '<li><strong>' + (language === "zh" ? "最佳导流角度" : "Best traffic angle") + ':</strong> ' + escapeHtml(bestAngle(offer, { language: language })) + '</li>' +
      '</ul></div>';
  }

  function renderCategoryRankingHtml(rankings, language) {
    if (!rankings.length) {
      return language === "zh"
        ? "<p>当前数据中没有找到品类信息。</p>"
        : "<p>No category data found in the current dataset.</p>";
    }
    var medalEmoji = ["🏆", "🥈", "🥉", "4️⃣", "5️⃣"];
    var topRankings = rankings.slice(0, 5);
    var parts = [];
    if (language === "zh") {
      parts.push('<h3 style="margin-bottom:12px">📊 推荐品类排名 Top 5</h3>');
    } else {
      parts.push('<h3 style="margin-bottom:12px">📊 Top 5 Recommended Categories</h3>');
    }
    topRankings.forEach(function(ranking, rankIndex) {
      var cat = ranking.category;
      var rows = offers.filter(function(o) { return categoryMatches(o, cat); });
      var s = aggregateRows(rows);
      var top5 = rankedRecommendations(rows, { includeTier4: false, includeBlack: false }).slice(0, 5);
      if (language === "zh") {
        parts.push('<div class="recommendation-answer" style="margin-top:16px">' +
          '<h4>' + (medalEmoji[rankIndex] || "") + ' ' + (rankIndex + 1) + '. ' + escapeHtml(cat) + '（综合分: ' + ranking.score + '）</h4>' +
          '<p style="color:var(--text-secondary,#666);font-size:0.9em">' +
          'Offer数: ' + rows.length.toLocaleString() + ' | 总营收: ' + shortMoney(s.totalRevenue) + ' | 总佣金: ' + shortMoney(s.totalCommission) + ' | 平均AOV: ' + shortMoney(s.avgAov) + ' | Blended EPC: ' + shortEpc(s.blendedEpc) +
          '</p>' +
          '<p><strong>Top 5 推荐:</strong></p>');
      } else {
        parts.push('<div class="recommendation-answer" style="margin-top:16px">' +
          '<h4>' + (medalEmoji[rankIndex] || "") + ' ' + (rankIndex + 1) + '. ' + escapeHtml(cat) + ' (Score: ' + ranking.score + ')</h4>' +
          '<p style="color:var(--text-secondary,#666);font-size:0.9em">' +
          'Offers: ' + rows.length.toLocaleString() + ' | Revenue: ' + shortMoney(s.totalRevenue) + ' | Commission: ' + shortMoney(s.totalCommission) + ' | Avg AOV: ' + shortMoney(s.avgAov) + ' | Blended EPC: ' + shortEpc(s.blendedEpc) +
          '</p>' +
          '<p><strong>Top 5 offers:</strong></p>');
      }
      top5.forEach(function(offer, i) {
        parts.push(renderCategoryOfferRow(offer, i, language));
      });
      parts.push('</div>');
    });
    if (language === "zh") {
      parts.push('<p style="margin-top:16px;color:var(--text-secondary,#666);font-style:italic">💡 输入品类名（如 "beauty 推荐"）查看该品类的详细推荐。</p>');
    } else {
      parts.push('<p style="margin-top:16px;color:var(--text-secondary,#666);font-style:italic">💡 Type a category name (e.g. "beauty offers") to see detailed recommendations for that category.</p>');
    }
    return parts.join("");
  }

  function recommendedCategoriesAnswer(prompt) {
    var language = responseLanguageFor(prompt);
    var rankings = computeCategoryRankings();
    var topRankings = rankings.slice(0, 5);

    // Store for follow-up queries
    var offersByCat = {};
    topRankings.forEach(function(r) {
      offersByCat[r.category] = offers.filter(function(o) { return categoryMatches(o, r.category); });
    });
    state.lastCategoryRanking = {
      rankings: rankings,
      topCategories: topRankings.map(function(r) { return r.category; }),
      offersByCategory: offersByCat
    };

    // Set context panel with all top-category offers
    var allRows = [];
    topRankings.forEach(function(r) {
      offersByCat[r.category].forEach(function(o) { allRows.push(o); });
    });
    var contextSummary = aggregateRows(allRows);
    var contextFilters = { exportCount: allRows.length, requestedCount: allRows.length, includeTier4: true, includeBlack: true };
    setContext({ type: "recommendation", items: allRows, summary: contextSummary, filters: contextFilters });

    return renderCategoryRankingHtml(rankings, language);
  }

  function sortedForCategory(category, options = {}) {
    const includeTier4 = options.includeTier4 || /tier 4|retest/i.test(options.prompt || "");
    const includeBlack = options.includeBlack || /black|blocked/i.test(options.prompt || "");
    var tierFilter = options.tier;
    return offers
      .filter(function(o) { return categoryMatches(o, category); })
      .filter(function(o) {
        if (!tierFilter) return true;
        if (Array.isArray(tierFilter)) return tierFilter.length ? tierFilter.indexOf(o.tier) !== -1 : true;
        return o.tier === tierFilter;
      })
      .filter(function(o) { return includeTier4 || o.tier !== "Tier 4"; })
      .filter(function(o) { return includeBlack || o.tier !== "BLACK TIER"; })
      .sort(function(a, b) { return compareRecommendationOffers(a, b, { includeTier4, includeBlack }); });
  }

  function rankedRecommendations(pool, context = {}) {
    return pool
      .filter((offer) => context.includeBlack || offer.tier !== "BLACK TIER")
      .filter((offer) => context.includeTier4 || offer.tier !== "Tier 4")
      .map((offer) => ({ offer, score: recommendationScore(offer, context) }))
      .filter((item) => item.score > -9999)
      .sort((a, b) => compareRecommendationOffers(a.offer, b.offer, context))
      .map((item) => item.offer);
  }

  function topRecommendations(pool, context = {}) {
    return rankedRecommendations(pool, context)
      .slice(0, 5);
  }

  function whyRecommended(offer, context = {}) {
    const language = context.language || responseLanguageFor(context.prompt || state.currentQuery);
    const publisherStrategy = tier2PublisherStrategy(offer, language);
    if (offer.recommendation) {
      if (publisherStrategy) {
        const prefix = language === "zh" ? "Publisher 策略" : "Publisher strategy";
        return `${offer.recommendation} ${prefix}: ${publisherStrategy.idea}`;
      }
      return offer.recommendation;
    }
    const signals = [];
    if (language === "zh") {
      if (tierGroup(offer) === "Tier 1") signals.push("优先 Tier 1 offer");
      if (tierGroup(offer) === "Core Tier 2") signals.push("Tier 2 表现较强");
      if (publisherStrategy) signals.push(publisherStrategy.label);
      if (number(offer.orders) > 0) signals.push(`${number(offer.orders).toLocaleString()} 个订单`);
      if (number(offer.conversionRate) >= 0.01) signals.push("CVR 健康");
      if (number(offer.epc) > 0.25) signals.push("EPC 可用");
      if (context.category && categoryMatches(offer, context.category)) signals.push("品类匹配");
      return signals.length ? signals.join("，") : "当前筛选结果中综合评分最高";
    }
    if (tierGroup(offer) === "Tier 1") signals.push("priority Tier 1 offer");
    if (tierGroup(offer) === "Core Tier 2") signals.push("strong Tier 2 performance");
    if (publisherStrategy) signals.push(publisherStrategy.label);
    if (number(offer.orders) > 0) signals.push(`${number(offer.orders).toLocaleString()} orders`);
    if (number(offer.conversionRate) >= 0.01) signals.push("healthy CVR");
    if (number(offer.epc) > 0.25) signals.push("usable EPC");
    if (context.category && categoryMatches(offer, context.category)) signals.push("category fit");
    return signals.length ? signals.join(", ") : "best available score in the filtered set";
  }

  function contextFollowup(lower) {
    if (!state.lastOffer) return false;
    if (/^tier\s*[1-4]\b|^black\s*tier\b/.test(lower)) return false;
    if (/\b(it|its|this|that|the merchant|this merchant|that merchant)\b/.test(lower) || /^(它|它的|这个|这个商家|该商家|这个品牌|该品牌)/.test(lower)) return true;
    return /^(epc|aov|orders?|order count|cvr|conversion|payment|paid|category|tier|commission|revenue|clicks?|dpv|atc)\b/.test(lower) ||
      /^(订单|订单数|转化|转化率|转换率|付款|支付|未付款|已付款|品类|类别|分层|佣金|佣金率|收入|营收|销售额|点击|点击量|加购|详情页)/.test(lower);
  }

  function setContext(context) {
    state.currentContext = context;
    renderContextPanel(context);
  }

  function buildRecommendationContext(items, filters = {}) {
    return { type: "recommendation", items, summary: aggregateRows(items), filters };
  }

  function buildMerchantContext(merchant) {
    state.lastOffer = merchant;
    state.lastRows = [merchant];
    return { type: "merchant", items: [merchant], summary: aggregateRows([merchant]), filters: {} };
  }

  function buildASINContext(asinResult) {
    const primary = asinResult.rows[0] || null;
    if (primary) {
      state.lastOffer = primary;
      state.lastRows = [primary];
    }
    return { type: "asin", items: asinResult.rows, summary: aggregateRows(asinResult.rows), filters: { asin: asinResult.asin, primary } };
  }

  function buildCategoryContext(category, rows) {
    state.lastRows = rows;
    return { type: "category", items: rows, summary: aggregateRows(rows), filters: { category } };
  }

  function buildKeywordContext(request, matches, topRows) {
    const rows = matches.map((match) => match.offer);
    state.lastRows = rows;
    const matchedCategories = Array.from(new Set(rows.flatMap((offer) => categoryParts(offer))))
      .filter((category) => category && category !== "Uncategorized")
      .slice(0, 12);
    return {
      type: "keyword",
      items: topRows,
      summary: aggregateRows(rows),
      filters: {
        keyword: request.keyword,
        canonical: request.canonical,
        aliases: request.aliases,
        matchedCategories,
        totalMatches: rows.length,
        topOfferNames: topRows.map((offer) => offer.brand).filter(Boolean)
      }
    };
  }

  function buildTierContext(tier, rows) {
    state.lastRows = rows;
    return { type: "tier", items: rows, summary: aggregateRows(rows), filters: { tier } };
  }

  function buildPaymentContext(rows, prompt) {
    state.lastRows = rows;
    const summary = updatePaymentSummary(rows);
    summary.monthBreakdown = ACTIVE_PAYMENT_MONTHS.map((month) => monthStatus(month, rows));
    return { type: "payment", items: rows, summary, filters: { prompt } };
  }

  function monthStatus(month, rows) {
    const checkDate = calculatePaymentAvailabilityDate(month);
    const checkable = dateOnly(checkDate) ? PAYMENT_TODAY >= dateOnly(checkDate) : false;
    const monthRows = rows.filter((record) => record.reportMonth === month);
    const unpaid = monthRows.filter((record) => record.paymentStatus === "Unpaid").length;
    const paid = monthRows.filter((record) => record.paymentStatus === "Paid").length;
    const pending = monthRows.filter((record) => record.paymentStatus === "Pending").length;
    const remaining = monthRows.reduce((sum, record) => sum + number(record.remainingAmount), 0);
    return { month, checkDate, status: checkable ? "checkable" : "pending", unpaid, paid, pending, remaining };
  }

  function statCards(cards) {
    return `<div class="context-stats">${cards.map(([label, value]) => (
      `<div class="context-stat"><span>${escapeHtml(labelText(label))}</span><strong>${escapeHtml(value)}</strong></div>`
    )).join("")}</div>`;
  }

  function miniTable(rows, columns) {
    if (!rows.length) return `<p>${escapeHtml(t("context.noMatches", "No matching offers found."))}</p>`;
    return `<div class="mini-table-wrap"><table class="mini-table">
      <thead><tr>${columns.map((col) => `<th>${escapeHtml(labelText(col.label))}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${columns.map((col) => `<td>${col.render(row)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  const contextColumns = [
    { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.brand || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
    { label: "Tier", render: (o) => escapeHtml(tierGroup(o)) },
    { label: "Highlight", render: (o) => escapeHtml(highlightStatus(o)) },
    { label: "Category", render: (o) => escapeHtml(displayCategory(o)) },
    { label: "AOV", render: (o) => shortMoney(o.aov) },
    { label: "EPC", render: (o) => shortEpc(o.epc) },
    { label: "CVR", render: (o) => shortPct(o.conversionRate) },
    { label: "Orders", render: (o) => number(o.orders).toLocaleString() },
    { label: "Revenue", render: (o) => shortMoney(o.salesAmount) },
    { label: "Commission made", render: (o) => shortMoney(o.affCommission) },
    { label: "Payment cycle", render: (o) => escapeHtml(paymentCycleText(o, "-")) }
  ];

  function contextColumnsFor() {
    return contextColumns;
  }

  function insightList(rows) {
    const bestEpc = bestBy(rows, "epc");
    const bestCvr = bestBy(rows, "conversionRate");
    const bestRevenue = bestBy(rows, "salesAmount");
    const bestCommission = bestBy(rows, "affCommission");
    const paymentRisk = rows.find(hasPaymentRisk);
    const cautionOffer = rows.find((offer) => /caution|monitor|retest|selected/i.test(recommendedAction(offer))) || rows.find((offer) => number(offer.conversionRate) < 0.01);
    const items = [
      ["Best by EPC", bestEpc ? `${bestEpc.brand} (${shortEpc(bestEpc.epc)})` : "not available in current data"],
      ["Best by CVR", bestCvr ? `${bestCvr.brand} (${shortPct(bestCvr.conversionRate)})` : "not available in current data"],
      ["Highest revenue", bestRevenue ? `${bestRevenue.brand} (${shortMoney(bestRevenue.salesAmount)})` : "not available in current data"],
      ["Highest commission", bestCommission ? `${bestCommission.brand} (${shortMoney(bestCommission.affCommission)})` : "not available in current data"],
      ["Payment risk", paymentRisk ? `${paymentRisk.brand}: ${paymentRisk.paymentStatus}` : "None in this result"],
      ["Needs caution", cautionOffer ? `${cautionOffer.brand}: ${caution(cautionOffer)}` : "None flagged"]
    ];
    return `<div class="insight-list">${items.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}</div>`;
  }

  function renderRecommendationStats(context) {
    const rows = context.items;
    const s = context.summary;
    const tierText = Object.entries(s.tierBreakdown).map(([tier, count]) => `${tier}: ${count}`).join(", ") || "not available";
    const tier2Text = Object.entries(s.tier2Breakdown).map(([status, count]) => `${status}: ${count}`).join(", ");
    const filterText = [
      metricFilterText(context.filters && context.filters.metricFilters),
      paymentCycleFilterText(context.filters && context.filters.paymentCycleFilter)
    ].filter(Boolean).join(", ");
    const scopeText = context.filters && context.filters.exportCount
      ? `<div class="context-note"><strong>Overview scope:</strong> ${Number(context.filters.exportCount).toLocaleString()} requested offers. The chat preview stays at 5.${filterText ? ` Filter: ${escapeHtml(filterText)}.` : ""}</div>`
      : "";
    return statCards([
      ["Offers", String(s.totalOffers)],
      ["Revenue made", shortMoney(s.totalRevenue)],
      ["Commission made", shortMoney(s.totalCommission)],
      ["Orders", countValue(s.totalOrders)],
      ["Blended EPC", shortEpc(s.blendedEpc)],
      ["Average CVR", shortPct(s.avgCvr)]
    ]) +
    scopeText +
    `<div class="context-note"><strong>Tier breakdown:</strong> ${escapeHtml(tierText)}${tier2Text ? `<br><strong>Tier 2 highlights:</strong> ${escapeHtml(tier2Text)}` : ""}</div>` +
    miniTable(rows, contextColumnsFor(rows)) +
    insightList(rows);
  }

  function renderMerchantStats(offer) {
    return `<div class="merchant-focus">
      <h4>${escapeHtml(offer.brand || "Merchant")}</h4>
      ${statCards([
        ["Merchant ID", textValue(offer.merchantId)],
        ["Tier", tierGroup(offer)],
        ["Network", textValue(offer.network)],
        ["Category", textValue(displayCategory(offer))],
        ["AOV", money(offer.aov)],
        ["EPC", epc(offer.epc)],
        ["CVR", pct(offer.conversionRate)],
        ["Revenue made", money(offer.salesAmount)],
        ["Commission made", money(offer.affCommission)],
        ["Orders", countValue(offer.orders)],
        ["Clicks", countValue(offer.clicks)],
        ["DPV", countValue(offer.dpv)],
        ["ATC", countValue(offer.atc)],
        ["Commission rate", (Number(offer.commissionRate) || 0).toFixed(2) + "%"],
        ["Payment", textValue(offer.paymentStatus)],
        ["Link status", textValue(offer.linkStatus || offer.recommendedLink)]
      ])}
      <div class="context-note">
        <strong>CPC:</strong> ${escapeHtml(textValue(offer.cpc))}<br>
        <strong>Discount/deal:</strong> ${escapeHtml(textValue(offer.dealInfo || offer.discountInfo))}<br>
        <strong>Payment by month:</strong> ${escapeHtml(paymentByMonthText(offer))}<br>
        <strong>Recommended action:</strong> ${escapeHtml(recommendedAction(offer))}<br>
        <strong>Notes:</strong> ${escapeHtml(textValue(offer.recommendation || offer.reason))}
      </div>
    </div>`;
  }

  function renderASINStats(context) {
    const asin = context.filters.asin;
    const primary = context.filters.primary;
    if (!primary) return `<p>ASIN <strong>${escapeHtml(asin)}</strong> was not found in the current data.</p>`;
    return `<div class="context-note">
      <strong>ASIN:</strong> ${escapeHtml(asin)}<br>
      <strong>Product name:</strong> not available in current data<br>
      <strong>Product URL:</strong> not available in current data<br>
      <strong>Deal price:</strong> not available in current data<br>
      <strong>Original price:</strong> not available in current data<br>
      <strong>Discount %:</strong> not available in current data<br>
      ASIN-level performance is not available. Showing merchant-level performance instead.
    </div>${renderMerchantStats(primary)}`;
  }

  function renderPaymentStats(context) {
    const rows = context.items;
    const s = context.summary;
    const followUp = rows
      .filter((record) => record.paymentStatus === "Unpaid" || record.paymentStatus === "Partial")
      .sort((a, b) => paymentStatusRank(a.paymentStatus) - paymentStatusRank(b.paymentStatus))
      .slice(0, 8)
      .map((record) => `${record.merchantName} ${optionText(record.reportMonth)} (${statusText(record.paymentStatus)})`)
      .join(", ") || t("payment.none", "None");
    const months = s.monthBreakdown.map((item) => (
      `<p><strong>${escapeHtml(optionText(item.month))}:</strong> ${escapeHtml(t(`payment.${item.status}`, item.status))} ${escapeHtml(item.checkDate)}; ${escapeHtml(t("payment.unpaid", "unpaid"))} ${item.unpaid}, ${escapeHtml(t("payment.pendingCount", "pending"))} ${item.pending}</p>`
    )).join("");
    return statCards([
      ["Revenue made", paymentSummaryMoney(rows, s.totalRevenueMade)],
      ["Commission made", paymentSummaryMoney(rows, s.totalCommissionMade)],
      ["Unpaid merchants", String(s.unpaidMerchantCount)],
      ["Pending merchants", String(s.pendingMerchantCount)],
      ["Overdue rows", String(s.overdueCount)]
    ]) +
    `<div class="insight-list">${months}</div>` +
    `<div class="context-note"><strong>${escapeHtml(t("payment.followup", "Merchants needing follow-up"))}:</strong> ${escapeHtml(followUp)}</div>` +
    miniTable(rows.slice(0, 20), [
      { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.merchantName || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
      { label: "Month", render: (o) => escapeHtml(`${optionText(o.reportMonth)} ${o.reportYear}`) },
      { label: "Status", render: (o) => escapeHtml(statusText(o.paymentStatus || "Unknown")) },
      { label: "Tier", render: (o) => escapeHtml(o.tier || "Unknown") },
      { label: "Revenue", render: (o) => paymentMoney(o, o.revenueMade) },
      { label: "Commission made", render: (o) => paymentMoney(o, o.commissionMade) },
      { label: "Cycle", render: (o) => escapeHtml(o.paymentCycle ? `${o.paymentCycle} days` : "-") },
      { label: "Expected payment date", render: (o) => escapeHtml(o.expectedPaymentDate || o.paymentAvailabilityDate || "not available") }
    ]);
  }

  function renderCategoryStats(context) {
    const rows = context.items;
    const top = topRecommendations(rows, { category: context.filters.category });
    const s = aggregateRows(rows);
    return statCards([
      ["Offers in category", String(rows.length)],
      ["Revenue", shortMoney(s.totalRevenue)],
      ["Commission", shortMoney(s.totalCommission)],
      ["Average AOV", shortMoney(s.avgAov)],
      ["Blended EPC", shortEpc(s.blendedEpc)],
      ["Average CVR", shortPct(s.avgCvr)]
    ]) +
    `<div class="context-note"><strong>Best traffic angle:</strong> ${escapeHtml(top[0] ? bestAngle(top[0], { category: context.filters.category }) : "not available in current data")}</div>` +
    miniTable(top, contextColumnsFor(top)) +
    insightList(top);
  }

  function renderKeywordStats(context) {
    const rows = context.items;
    const s = context.summary;
    const filters = context.filters || {};
    const tierText = Object.entries(s.tierBreakdown || {}).map(([tier, count]) => `${tier}: ${count}`).join(", ") || "not available";
    const categoryText = (filters.matchedCategories || []).join(", ") || "not available in current data";
    const topText = (filters.topOfferNames || []).join(", ") || "not available in current data";
    return statCards([
      ["Search keyword", textValue(filters.keyword)],
      ["Matching offers", String(filters.totalMatches || s.totalOffers || 0)],
      ["Revenue made", shortMoney(s.totalRevenue)],
      ["Commission made", shortMoney(s.totalCommission)],
      ["Average AOV", shortMoney(s.avgAov)],
      ["Blended EPC", shortEpc(s.blendedEpc)],
      ["Average CVR", shortPct(s.avgCvr)]
    ]) +
    `<div class="context-note"><strong>Matched categories:</strong> ${escapeHtml(categoryText)}</div>` +
    `<div class="context-note"><strong>Top 5 recommended offers:</strong> ${escapeHtml(topText)}</div>` +
    `<div class="context-note"><strong>Tier breakdown:</strong> ${escapeHtml(tierText)}</div>` +
    miniTable(rows, contextColumnsFor(rows));
  }

  function renderContextPanel(context) {
    const query = state.currentQuery ? `${t("context.basedOn", "Based on:")} ${state.currentQuery}` : t("context.generalFiltered", "General filtered view");
    const titles = {
      default: [t("context.defaultTitle", "Context Overview"), t("context.defaultSubtitle", "General offer snapshot")],
      recommendation: [t("context.recommendationTitle", "Recommendation Overview"), query],
      merchant: [t("context.merchantTitle", "Merchant Statistics"), query],
      asin: [t("context.asinTitle", "ASIN Statistics"), query],
      category: [t("context.categoryTitle", "Category Overview"), query],
      keyword: ["Keyword Search Overview", query],
      tier: [t("context.tierTitle", "Tier Overview"), query],
      payment: [t("context.paymentTitle", "Payment Overview"), query]
    };
    const [title, subtitle] = titles[context.type] || titles.default;
    els.contextTitle.textContent = title;
    els.contextSubtitle.textContent = subtitle;

    if (context.type === "merchant") {
      els.recBox.innerHTML = renderMerchantStats(context.items[0]);
    } else if (context.type === "asin") {
      els.recBox.innerHTML = renderASINStats(context);
    } else if (context.type === "payment") {
      els.recBox.innerHTML = renderPaymentStats(context);
    } else if (context.type === "category") {
      els.recBox.innerHTML = renderCategoryStats(context);
    } else if (context.type === "keyword") {
      els.recBox.innerHTML = renderKeywordStats(context);
    } else if (context.type === "tier") {
      els.recBox.innerHTML = renderRecommendationStats(buildRecommendationContext(topRecommendations(context.items, { includeTier4: true, includeBlack: true }), context.filters));
    } else if (context.type === "recommendation") {
      els.recBox.innerHTML = renderRecommendationStats(context);
    } else {
      const rows = getFiltered();
      const top = topRecommendations(rows, {});
      els.recBox.innerHTML = renderRecommendationStats(buildRecommendationContext(top, {}));
    }
  }

  function paymentByMonthText(offer) {
    const paid = offer.paidInvoiceMonths || [];
    const unpaid = offer.paymentRiskMonths || [];
    const parts = [];
    if (paid.length) parts.push(`Paid: ${paid.join(", ")}`);
    if (unpaid.length) parts.push(`Unpaid: ${unpaid.join(", ")}`);
    return parts.length ? parts.join("; ") : "not available in current data";
  }

  function fieldRows(offer, language = state.language) {
    const notAvailable = language === "zh" ? chatCopy(language).notAvailable : "not available in current data";
    return [
      ["Merchant", textValue(offer.brand || offer.merchantId)],
      ["Tier", textValue(tierGroup(offer))],
      ["Category", textValue(displayCategory(offer))],
      ["Region", textValue(offer.region)],
      ["Commission rate", (Number(offer.commissionRate) || 0).toFixed(2) + "%"],
      ["Payment cycle", paymentCycleText(offer, notAvailable)],
      ["AOV", money(offer.aov)]
    ];
  }

  function merchantOverview(offer, extra = "", language = responseLanguageFor()) {
    setContext(buildMerchantContext(offer));
    return merchantOverviewHtml(offer, extra, language);
  }

  function merchantOverviewHtml(offer, extra = "", language = responseLanguageFor()) {
    const rows = fieldRows(offer, language)
      .map(([label, value]) => `<li><strong>${escapeHtml(chatLabelText(label, language))}:</strong> ${escapeHtml(value)}</li>`)
      .join("");
    return `<div class="merchant-card"><h4>${escapeHtml(offer.brand || chatCopy(language).merchantOverview || "Merchant")} ${extra}</h4><ul>${rows}</ul></div>` +
      downloadCardHtml([offer], {
        downloadType: "offers",
        filePrefix: "merchant_offer",
        exportScope: offer.brand || offer.merchantId || "merchant",
        sheetName: "Merchant"
      }, {
        title: "Merchant file",
        description: "1 offer row with compact merchant metrics."
      });
  }

  function resultTable(rows, columns, language = state.language) {
    if (!rows.length) return `<p>${escapeHtml(language === "zh" ? chatCopy(language).noMatches : t("context.noMatches", "No matching offers found."))}</p>`;
    return `<div class="result-table-wrap"><table class="result-table">
      <thead><tr>${columns.map((col) => `<th>${escapeHtml(chatLabelText(col.label, language))}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${columns.map((col) => `<td>${col.render(row)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  const chatOverviewColumns = [
    { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.brand || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
    { label: "Tier", render: (o) => escapeHtml(tierGroup(o)) },
    { label: "Category", render: (o) => escapeHtml(displayCategory(o)) },
    { label: "Region", render: (o) => escapeHtml(o.region || "-") },
    { label: "Commission rate", render: (o) => shortPct(o.commissionRate) },
    { label: "Payment cycle", render: (o) => escapeHtml(paymentCycleText(o, "-")) },
    { label: "AOV", render: (o) => shortMoney(o.aov) }
  ];

  const compactColumns = chatOverviewColumns;
  const topMetricColumns = chatOverviewColumns;
  const keywordColumns = chatOverviewColumns;
  const tier2CompactColumns = chatOverviewColumns;

  function metricMentioned(prompt, metric) {
    const text = String(prompt || "").toLowerCase();
    if (metric === "aov") return /\baov\b|客单价|平均订单金额/.test(text);
    if (metric === "epc") return /\bepc\b/.test(text);
    if (metric === "commission") return /commission|commissions|commisison|comission|\baff\s+commission\b|affiliate\s+commission|产生佣金|佣金收入|佣金金额|佣金额|联盟佣金|佣金/.test(text);
    return false;
  }

  function extractTopMetricRequest(prompt) {
    const text = String(prompt || "");
    const lower = text.toLowerCase();
    const wantsTop = /\b(top|highest|best|largest|biggest|rank|ranking|sort|排行|排名|最高|最大|最佳|最好|前\s*\d*)\b/i.test(text) ||
      /最高|最大|最佳|最好|排行|排名|前\s*\d*/.test(text);
    if (!wantsTop) return null;

    const hasAov = metricMentioned(prompt, "aov");
    const hasCommission = metricMentioned(prompt, "commission");
    const hasEpc = metricMentioned(prompt, "epc");
    if (!hasAov && !hasCommission && !hasEpc) return null;

    if (hasAov && hasCommission) {
      return {
        key: "aov_commission",
        label: "AOV + Commission",
        sortDescription: "AOV first, then commission made",
        fields: [
          { field: "aov", label: "AOV", type: "money" },
          { field: "affCommission", label: "Commission made", type: "money" }
        ]
      };
    }
    if (hasCommission) {
      return {
        key: "commission",
        label: "Commission",
        sortDescription: "AOV first, then commission made",
        fields: [
          { field: "aov", label: "AOV", type: "money" },
          { field: "affCommission", label: "Commission made", type: "money" }
        ]
      };
    }
    if (hasAov) {
      return {
        key: "aov",
        label: "AOV",
        sortDescription: "AOV",
        fields: [{ field: "aov", label: "AOV", type: "money" }]
      };
    }
    return {
      key: "epc",
      label: "EPC",
      sortDescription: "EPC",
      fields: [{ field: "epc", label: "EPC", type: "money" }]
    };
  }

  function compareTopMetricRows(a, b, request) {
    for (const metric of request.fields) {
      const diff = number(b[metric.field]) - number(a[metric.field]);
      if (diff) return diff;
    }
    return (
      number(b.salesAmount) - number(a.salesAmount) ||
      number(b.orders) - number(a.orders) ||
      number(b.conversionRate) - number(a.conversionRate) ||
      tierPriority(a, true, true) - tierPriority(b, true, true) ||
      String(a.brand || "").localeCompare(String(b.brand || ""), undefined, { numeric: true, sensitivity: "base" })
    );
  }

  function topMetricFilterText(context) {
    const parts = [];
    if (context.tier) parts.push(context.tier);
    if (context.category) parts.push(context.category);
    const metricText = metricFilterText(context.metricFilters);
    if (metricText) parts.push(metricText);
    return parts.join(", ");
  }

  function categoryForTopMetricPrompt(prompt) {
    const phrase = cleanedCategoryPhrase(prompt)
      .replace(/\b(?:epc|aov|commission|commissions|commisison|comission|affiliate|aff|made|amount|rate)\b/gi, " ")
      .replace(/佣金|客单价|平均订单金额/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!phrase) return null;
    const category = categoryForPrompt(prompt);
    if (!category) return null;
    if (normalize(category) === normalize(phrase) && !categoryAliases[category] && !uniqueCategoryValues().some((value) => normalize(value) === normalize(category))) return null;
    return category;
  }

  function topMetricOfferAnswer(prompt, request) {
    const tier = tierFromPrompt(prompt);
    const category = categoryForTopMetricPrompt(prompt);
    const includeBlack = /black|blocked|include black|黑名单|黑色|屏蔽|暂停/i.test(prompt);
    const metricFilters = extractMetricFilters(prompt);
    const requestedCount = requestedRecommendationCount(prompt, 5);
    let rows = offers
      .filter((offer) => !tier || offer.tier === tier)
      .filter((offer) => !category || categoryMatches(offer, category))
      .filter((offer) => tier || includeBlack || offer.tier !== "BLACK TIER")
      .filter((offer) => request.fields.every((metric) => number(offer[metric.field]) > 0));
    rows = applyMetricFilters(rows, metricFilters)
      .sort((a, b) => compareTopMetricRows(a, b, request));

    const exportRows = rows.slice(0, Math.min(requestedCount, MAX_RECOMMENDATION_EXPORT));
    const top = exportRows.slice(0, 5);
    setContext(buildRecommendationContext(exportRows, {
      type: "top_metric",
      requestedCount,
      exportCount: exportRows.length,
      tier,
      category,
      metricFilters,
      ranking: request.label
    }));
    if (!top.length) return `I found no offers with usable ${escapeHtml(request.label)} data for this request.`;

    const filterText = topMetricFilterText({ tier, category, metricFilters });
    const downloadId = registerRecommendationDownload(exportRows, {
      downloadType: "offers",
      filePrefix: `top_${request.key}_offers`,
      exportScope: filterText || request.key,
      sheetName: `Top ${request.label}`.slice(0, 31),
      prompt,
      ranking: request.label,
      columns: recommendationExportColumns()
    }, requestedCount);
    const foundText = exportRows.length < requestedCount
      ? `I found ${exportRows.length.toLocaleString()} matching offers.`
      : `The Excel download includes all ${exportRows.length.toLocaleString()} requested offers.`;
    const filterNote = filterText ? ` Filter: ${escapeHtml(filterText)}.` : "";

    return `<p><strong>Top ${escapeHtml(request.label)} offers:</strong> sorted by ${escapeHtml(request.sortDescription)}. Showing ${top.length.toLocaleString()} in chat. ${escapeHtml(foundText)}${filterNote}</p>` +
      `<div class="download-card">
        <div>
          <strong>Full top ${escapeHtml(request.label)} file</strong>
          <span>${exportRows.length.toLocaleString()} offers sorted by ${escapeHtml(request.sortDescription)}.</span>
        </div>
        <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">Download Excel</button>
      </div>` +
      resultTable(top, topMetricColumns);
  }

  function keywordScopeLabel(request) {
    if (!request) return "keyword";
    if (request.canonical === "headphones") return "headphones/audio";
    if (request.canonical === "speaker") return "speaker/audio";
    return request.keyword || request.canonical || "keyword";
  }

  function keywordNeedsClarification(request) {
    if (!request) return false;
    const keywordTokens = meaningfulTokens(request.keyword);
    return keywordTokens.length === 1 && normalize(request.keyword) === "audio";
  }

  function keywordSearchAnswer(prompt, request, options = {}) {
    const language = responseLanguageFor(prompt);
    if (keywordNeedsClarification(request)) {
      setContext(buildKeywordContext(request, [], []));
      return language === "zh"
        ? "你是指 headphones/earbuds/audio 产品，还是想看全部 electronics offers？"
        : "Do you mean headphones/earbuds/audio products, or do you want all electronics offers?";
    }
    const tier = tierFromPrompt(prompt);
    const includeTier4 = /tier\s*4|retest|第四层|第四级|四层|四级|重测|重新测试/i.test(prompt);
    const includeBlack = /black|blocked|黑名单|黑色|屏蔽|暂停/i.test(prompt);
    const metricFilters = extractMetricFilters(prompt);
    const topMetricRequest = options.topMetricRequest || null;
    const matches = keywordSearchMatches(prompt, { request, tier, includeTier4, includeBlack, metricFilters, topMetricRequest });
    if (!matches.length) {
      setContext(buildKeywordContext(request, [], []));
      return "No matching offers found in current data.";
    }

    const requestedCount = requestedRecommendationCount(prompt, matches.length);
    const safeCount = Math.min(Math.max(requestedCount, 1), MAX_RECOMMENDATION_EXPORT);
    const exportMatches = matches.slice(0, safeCount);
    const exportRows = exportMatches.map((match) => match.offer);
    const topRows = exportRows.slice(0, 5);
    setContext(buildKeywordContext(request, matches, topRows));

    const scopeLabel = keywordScopeLabel(request);
    const matchedCategories = Array.from(new Set(matches.flatMap((match) => categoryParts(match.offer))))
      .filter((category) => category && category !== "Uncategorized")
      .slice(0, 8);
    const filterParts = [
      tier,
      metricFilterText(metricFilters),
      topMetricRequest ? `ranked by ${topMetricRequest.sortDescription}` : ""
    ].filter(Boolean);
    const filterNote = filterParts.length ? ` Filter: ${filterParts.join(", ")}.` : "";
    const downloadId = registerRecommendationDownload(exportRows, {
      downloadType: "offers",
      filePrefix: "keyword_offer_search",
      exportScope: request.keyword || scopeLabel,
      sheetName: "Keyword Offers",
      prompt,
      keyword: request.keyword,
      columns: recommendationExportColumns()
    }, safeCount);
    const rankingText = topMetricRequest
      ? `ranked by ${topMetricRequest.sortDescription}`
      : "ranked by keyword match, Tier 1, Tier 2, Tier 3 priority, then performance";
    const exportNote = exportRows.length < matches.length
      ? `${exportRows.length.toLocaleString()} of ${matches.length.toLocaleString()} matching offers are included in the file.`
      : `${exportRows.length.toLocaleString()} matching offers are included in the file.`;

    if (language === "zh") {
      return `<p><strong>找到与 ${escapeHtml(scopeLabel)} 相关的 offer。</strong> 根据品类、产品关键词和推荐优先级，先显示前 ${topRows.length.toLocaleString()} 个。</p>` +
        `<p><strong>匹配品类:</strong> ${escapeHtml(matchedCategories.join(", ") || "当前数据没有可用匹配品类")}${escapeHtml(filterNote)}</p>` +
        `<div class="download-card">
          <div>
            <strong>关键词 offer 文件</strong>
            <span>${escapeHtml(exportNote)} ${escapeHtml(rankingText)}。</span>
          </div>
          <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">下载 Excel</button>
        </div>` +
        resultTable(topRows, keywordColumns, language);
    }

    return `<p><strong>I found offers related to ${escapeHtml(scopeLabel)}.</strong> Top ${topRows.length.toLocaleString()} brand recommendations with the usual offer data are below, based on category, product keyword, and recommendation priority.</p>` +
      `<p><strong>Matched categories:</strong> ${escapeHtml(matchedCategories.join(", ") || "not available in current data")}${escapeHtml(filterNote)}</p>` +
      `<div class="download-card">
        <div>
          <strong>Keyword offer file</strong>
          <span>${escapeHtml(exportNote)} ${escapeHtml(rankingText)}.</span>
        </div>
        <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">Download Excel</button>
      </div>` +
      resultTable(topRows, keywordColumns, language);
  }

  const paymentCycleOfferColumns = [
    { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.brand || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
    { label: "Cycle", render: (o) => escapeHtml(o.paymentCycle ? `${o.paymentCycle} days` : "-") },
    { label: "Tier", render: (o) => escapeHtml(tierGroup(o)) },
    { label: "Category", render: (o) => escapeHtml(o.category || "Uncategorized") },
    { label: "EPC", render: (o) => shortEpc(o.epc) },
    { label: "AOV", render: (o) => shortMoney(o.aov) },
    { label: "Orders", render: (o) => number(o.orders).toLocaleString() },
    { label: "Revenue", render: (o) => shortMoney(o.salesAmount) },
    { label: "Payment", render: (o) => escapeHtml(o.paymentStatus || "not available") }
  ];

  const paymentColumns = [
    { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.merchantName || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
    { label: "Tier", render: (o) => escapeHtml(o.tier || "Unknown") },
    { label: "Month", render: (o) => escapeHtml(`${optionText(o.reportMonth)} ${o.reportYear}`) },
    { label: "Status", render: (o) => escapeHtml(statusText(o.paymentStatus || "Unknown")) },
    { label: "Revenue made", render: (o) => paymentMoney(o, o.revenueMade) },
    { label: "Commission made", render: (o) => paymentMoney(o, o.commissionMade) },
    { label: "Cycle", render: (o) => escapeHtml(o.paymentCycle ? `${o.paymentCycle} days` : "-") },
    { label: "Expected payment date", render: (o) => escapeHtml(o.expectedPaymentDate || o.paymentAvailabilityDate || "not available") },
    { label: "Notes", render: (o) => escapeHtml(o.notes || "not available") }
  ];

  function chatStatusText(value, language) {
    if (language !== "zh") return statusText(value);
    const map = { Paid: "已付款", Unpaid: "未付款", Pending: "待处理", Partial: "部分付款", Unknown: "未知" };
    return map[value] || value || "未知";
  }

  function chatMonthText(value, language) {
    if (language !== "zh") return optionText(value);
    const map = { February: "二月", March: "三月", April: "四月", May: "五月", June: "六月" };
    return map[value] || value || "";
  }

  function chatPaymentNoteText(value, language) {
    if (language !== "zh") return value || "not available";
    const text = String(value || "");
    if (/Payment is due and needs follow-up/i.test(text)) return "付款已到期，需要跟进。";
    if (/Payment confirmed by Levanta/i.test(text)) return "Levanta 已确认付款。";
    if (/Partial payment/i.test(text)) return "已记录部分付款，需要跟进剩余金额。";
    if (/Payment is not due yet|Payment not due/i.test(text)) return "付款尚未到检查时间。";
    return text || "当前数据不可用";
  }

  function paymentColumnsFor(language) {
    if (language !== "zh") return paymentColumns;
    return [
      { label: "Merchant", render: (o) => `<strong>${escapeHtml(o.merchantName || "")}</strong><br><small>${escapeHtml(o.merchantId || "")}</small>` },
      { label: "Tier", render: (o) => escapeHtml(o.tier || "Unknown") },
      { label: "Month", render: (o) => escapeHtml(`${chatMonthText(o.reportMonth, language)} ${o.reportYear}`) },
      { label: "Status", render: (o) => escapeHtml(chatStatusText(o.paymentStatus || "Unknown", language)) },
      { label: "Revenue made", render: (o) => paymentMoney(o, o.revenueMade) },
      { label: "Commission made", render: (o) => paymentMoney(o, o.commissionMade) },
      { label: "Cycle", render: (o) => escapeHtml(o.paymentCycle ? `${o.paymentCycle} days` : "-") },
      { label: "Available", render: (o) => escapeHtml(o.paymentAvailabilityDate || "not available") },
      { label: "Notes", render: (o) => escapeHtml(chatPaymentNoteText(o.notes, language)) }
    ];
  }

  function paymentStatusRank(status) {
    const ranks = { Overdue: 1, Unpaid: 2, Partial: 3, Unknown: 4, Pending: 5, Paid: 6 };
    return ranks[status] || 9;
  }

  function sortPaymentRows(rows) {
    return rows.slice().sort((a, b) => (
      paymentStatusRank(a.paymentStatus) - paymentStatusRank(b.paymentStatus) ||
      number(b.remainingAmount) - number(a.remainingAmount) ||
      String(b.reportMonthKey).localeCompare(String(a.reportMonthKey))
    ));
  }

  const paymentTableColumns = [
    { label: "Merchant ID", render: (record) => escapeHtml(record.merchantId || "") },
    { label: "Merchant", render: (record) => `<strong>${escapeHtml(record.merchantName || "")}</strong><p>${escapeHtml(displayCategory(record))}</p>` },
    { label: "Network", render: (record) => escapeHtml(record.network || "") },
    { label: "Region", render: (record) => escapeHtml(record.region || "-") },
    { label: "Tier", render: (record) => `<span class="badge tier">${escapeHtml(record.tier || "Unknown")}</span>` },
    { label: "Month", render: (record) => escapeHtml(`${optionText(record.reportMonth)} ${record.reportYear}`) },
    { label: "Status", render: (record) => `<span class="badge ${paymentStatusClass(record.paymentStatus)}">${escapeHtml(statusText(record.paymentStatus || "Unknown"))}</span>` },
    { label: "Revenue Made", render: (record) => paymentMoney(record, record.revenueMade) },
    { label: "Commission Made", render: (record) => paymentMoney(record, record.commissionMade) },
    { label: "Cycle", render: (record) => escapeHtml(record.paymentCycle ? `${record.paymentCycle} days` : "-") },
    { label: "Expected Payment Date", render: (record) => escapeHtml(record.expectedPaymentDate || record.paymentAvailabilityDate || "-") },
    { label: "Payment Made", render: (record) => escapeHtml(paymentMadeDateText(record)) }
  ];

  const PAYMENT_STATUS_FILTER_ORDER = ["Paid", "Pending", "Unpaid", "Overdue", "Partial", "Unknown"];

  function paymentStatusFilterValues() {
    return uniquePaymentValues("paymentStatus").sort((a, b) => {
      const aIndex = PAYMENT_STATUS_FILTER_ORDER.indexOf(a);
      const bIndex = PAYMENT_STATUS_FILTER_ORDER.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
      return String(a).localeCompare(String(b));
    });
  }

  function paymentSortOptions() {
    return [
      { value: "", label: optionText("Default priority") },
      ...paymentTableColumns.map((column) => ({ value: column.label, label: labelText(column.label) }))
    ];
  }

  function paymentMonthSortValue(record) {
    const year = Number(record.reportYear || 0);
    const monthIndex = PAYMENT_MONTHS.indexOf(record.reportMonth);
    return year * 100 + (monthIndex < 0 ? 0 : monthIndex + 1);
  }

  function paymentTableSortValue(record, key) {
    if (key === "Merchant ID") return record.merchantId || "";
    if (key === "Merchant") return record.merchantName || "";
    if (key === "Network") return record.network || "";
    if (key === "Region") return record.region || "";
    if (key === "Tier") return record.tier || "";
    if (key === "Month") return paymentMonthSortValue(record);
    if (key === "Status") return paymentStatusRank(record.paymentStatus);
    if (key === "Revenue Made") return number(record.revenueMade);
    if (key === "Commission Made") return number(record.commissionMade);
    if (key === "Cycle") return number(record.paymentCycle);
    if (key === "Expected Payment Date") return record.expectedPaymentDate || record.paymentAvailabilityDate || "";
    if (key === "Payment Made") return record.paymentStatus === "Paid" ? record.paymentMadeDate || "" : "";
    return record[key] || "";
  }

  function sortPaymentRowsForTable(rows, sortState = state.paymentSort) {
    if (!sortState || !sortState.key) return sortPaymentRows(rows);
    return sortReportRows(rows, sortState, paymentTableSortValue);
  }

  function findPaymentMerchantMatches(query) {
    const cleaned = query
      .replace(/\b(what|is|are|the|payment|payments|cycle|for|merchant|paid|unpaid|status|of|this|that|issue|issues|does|have|has|already|which|offers|with|show|all|late|pending|partial|unknown|remaining|expected|commission|revenue|march|april|may|june|july|august|report|month|in|on|not)\b/gi, " ")
      .replace(/付款|支付|结算|周期|商家|品牌|已付款|未付款|没付款|未支付|状态|问题|逾期|到期|待处理|部分付款|未知|剩余|预期|佣金|收入|三月|四月|五月|六月|七月|八月|报表|月份|查看|显示|全部|所有|请|帮我|哪些|哪个|是否|已经|还没|没有|未/g, " ")
      .trim();
    if (cleaned.length < 3) return [];
    const merchants = Array.from(new Map(getPaymentRecords().map((record) => [
      record.merchantId || normalize(record.merchantName),
      {
        brand: record.merchantName,
        merchantId: record.merchantId,
        category: record.category,
        categoryPath: record.categoryPath,
        mainCategory: record.mainCategory,
        subCategory: record.subCategory,
        mainCategoryCn: record.mainCategoryCn,
        subCategoryCn: record.subCategoryCn,
        network: record.network
      }
    ])).values());
    return merchants
      .map((merchant) => ({ merchant, score: fuzzyScore(cleaned, merchant) }))
      .filter((item) => item.score >= 45)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }

  function closestMatchesHtml(matches, query) {
    const language = responseLanguageFor(query);
    const copy = chatCopy(language);
    if (!matches.length) {
      setContext({ type: "default", items: getFiltered().slice(0, 80), summary: {}, filters: {} });
      if (language === "zh") return `${escapeHtml(copy.notFoundPrefix)} <strong>${escapeHtml(query)}</strong>。${escapeHtml(copy.tryLookup)}`;
      return `I could not find <strong>${escapeHtml(query)}</strong>. Try merchant ID, ASIN, or category.`;
    }
    const rows = matches.map((item) => item.offer);
    state.lastRows = rows;
    setContext(buildCategoryContext("closest matches", rows));
    const message = language === "zh" ? escapeHtml(copy.closeMatches) : "I found multiple close merchant matches. Which one do you mean?";
    return `${message}<br>` +
      downloadCardHtml(rows, {
        downloadType: "offers",
        filePrefix: "merchant_matches",
        exportScope: query || "closest_matches",
        sheetName: "Closest Matches"
      }, {
        title: "Closest matches file",
        description: `${rows.length.toLocaleString()} matching offers from this lookup.`
      }) +
      resultTable(rows, compactColumns.slice(0, 5), language);
  }

  function requestedRecommendationCount(prompt, fallback = 5) {
    const text = String(prompt || "");
    if (chatbotI18n.requestedRecommendationCount) {
      const requested = chatbotI18n.requestedRecommendationCount(text, fallback, MAX_RECOMMENDATION_EXPORT);
      if (requested !== fallback) return requested;
    }
    const patterns = [
      /\b(?:top|give|show|list|export|download|pull)\s+(?:me\s+)?(?:the\s+)?(?:top\s+)?(\d{1,4})\b/i,
      /\b(\d{1,4})\s+(?:offers?|brands?|recommendations?)\b/i,
      /\b(\d{1,4})\s+tier\s*[1-4]\s*(?:offers?|brands?|recommendations?)?\b/i,
      /(?:推荐|给我|显示|列出|拉取|导出|下载|筛选|找)\s*(\d{1,4})\s*(?:个|款|条)?/i,
      /前\s*(\d{1,4})\s*(?:个|款|条)?/i,
      /(\d{1,4})\s*(?:个|款|条)?\s*(?:offer|offers|品牌|商家|推荐)/i
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      const before = text.slice(Math.max(0, match.index - 8), match.index);
      if (/tier\s*$/i.test(before)) continue;
      const requested = Number(match[1]);
      if (Number.isFinite(requested) && requested > 0) {
        return Math.min(Math.max(Math.floor(requested), 1), MAX_RECOMMENDATION_EXPORT);
      }
    }
    return fallback;
  }

  function recommendationPreviewCount(requestedCount, availableCount) {
    const requested = Math.max(1, Math.floor(number(requestedCount) || 5));
    const limit = requested <= 10 ? requested : 10;
    return Math.min(limit, availableCount);
  }

  function offerIdentityKey(offer) {
    return `${String(offer && offer.merchantId || "").trim()}::${normalize(offer && offer.brand)}`;
  }

  function tierNameFromToken(value) {
    const token = String(value || "").trim().toLowerCase();
    if (token === "1" || token === "one") return "Tier 1";
    if (token === "2" || token === "two") return "Tier 2";
    if (token === "3" || token === "three") return "Tier 3";
    if (token === "4" || token === "four") return "Tier 4";
    return "";
  }

  function mergeTierPlanItem(plan, tier, count) {
    if (!tier || !Number.isFinite(count) || count <= 0) return;
    const existing = plan.find((item) => item.tier === tier);
    const safeCount = Math.min(Math.floor(count), MAX_RECOMMENDATION_EXPORT);
    if (existing) existing.count = safeCount;
    else plan.push({ tier, count: safeCount });
  }

  function parseTierOfferRequest(prompt) {
    const text = String(prompt || "");
    const plan = [];
    // "各N个/个" pattern: "Tier1和Tier2各5个" → 5 each for Tier 1 and Tier 2
    const eachMatch = text.match(/各\s*(\d{1,4})\s*(?:个|offers?|brands?)/i);
    const eachCount = eachMatch ? Number(eachMatch[1]) : 0;
    if (eachCount > 0) {
      const tiers = tiersFromPrompt(text);
      for (var t = 0; t < tiers.length; t++) {
        mergeTierPlanItem(plan, tiers[t], eachCount);
      }
      if (plan.length) return plan;
    }
    const countFirst = /\b(\d{1,4})\s*(?:offers?|brands?|recommendations?)?\s*(?:from|for|in|of)?\s*tier\s*([1-4])\b/gi;
    const tierFirst = /\btier\s*([1-4])\s*(?:[:=\-]|with|for|of)?\s*(\d{1,4})\s*(?:offers?|brands?|recommendations?)?/gi;
    let match;
    while ((match = countFirst.exec(text))) {
      mergeTierPlanItem(plan, tierNameFromToken(match[2]), Number(match[1]));
    }
    while ((match = tierFirst.exec(text))) {
      mergeTierPlanItem(plan, tierNameFromToken(match[1]), Number(match[2]));
    }
    return plan;
  }

  function bundleRequestedCount(plan) {
    return (plan || []).reduce((sum, item) => sum + number(item.count), 0);
  }

  function tierBundleCounts(rows) {
    return rows.reduce((counts, offer) => {
      counts[offer.tier] = (counts[offer.tier] || 0) + 1;
      return counts;
    }, {});
  }

  function tierCandidatePool(tier, context = {}) {
    const metricFilters = context.metricFilters || [];
    const categories = context.categories || [];
    let pool = offers.filter(function(o) { return o.tier === tier; });
    if (categories.length) {
      pool = pool.filter(function(o) { return categoryMatches(o, categories); });
    }
    pool = applyMetricFilters(pool, metricFilters);
    return rankedRecommendations(pool, {
      ...context,
      includeTier4: true,
      includeBlack: tier === "BLACK TIER" || context.includeBlack
    });
  }

  function isExcludedRecommendationOffer(offer) {
    return state.excludedRecommendationKeys.has(offerIdentityKey(offer));
  }

  function rebuildRecommendationBundle(plan, options = {}) {
    const previousRows = options.previousRows || [];
    const context = options.context || {};
    const rows = [];
    const gaps = [];
    const selectedKeys = new Set();

    plan.forEach((item) => {
      const tier = item.tier;
      const requested = Math.min(Math.max(Math.floor(number(item.count) || 0), 0), MAX_RECOMMENDATION_EXPORT);
      const tierRows = [];
      previousRows
        .filter((offer) => offer.tier === tier)
        .forEach((offer) => {
          const key = offerIdentityKey(offer);
          if (tierRows.length >= requested || selectedKeys.has(key) || isExcludedRecommendationOffer(offer)) return;
          tierRows.push(offer);
          selectedKeys.add(key);
        });

      tierCandidatePool(tier, context).forEach((offer) => {
        const key = offerIdentityKey(offer);
        if (tierRows.length >= requested || selectedKeys.has(key) || isExcludedRecommendationOffer(offer)) return;
        tierRows.push(offer);
        selectedKeys.add(key);
      });

      rows.push(...tierRows);
      if (tierRows.length < requested) {
        gaps.push({ tier, requested, available: tierRows.length, gap: requested - tierRows.length });
      }
    });

    const bundle = {
      plan: plan.map((item) => ({ tier: item.tier, count: item.count })),
      rows,
      gaps,
      context,
      requestedCount: bundleRequestedCount(plan),
      excludedKeys: Array.from(state.excludedRecommendationKeys)
    };
    state.activeRecommendationBundle = bundle;
    setContext(buildRecommendationContext(rows, {
      ...context,
      bundle: true,
      bundlePlan: bundle.plan,
      requestedCount: bundle.requestedCount,
      exportCount: rows.length,
      gaps
    }));
    return bundle;
  }

  function bundlePlanText(plan) {
    return plan.map((item) => `${item.tier}: ${number(item.count).toLocaleString()}`).join(", ");
  }

  function bundleCountsText(rows) {
    const counts = tierBundleCounts(rows);
    return Object.keys(counts)
      .sort((a, b) => tierPriority({ tier: a }, true, true) - tierPriority({ tier: b }, true, true))
      .map((tier) => `${tier}: ${counts[tier].toLocaleString()}`)
      .join(", ");
  }

  function bundleGapText(gaps) {
    if (!gaps || !gaps.length) return "";
    return gaps.map((gap) => `${gap.tier} requested ${gap.requested.toLocaleString()}, found ${gap.available.toLocaleString()}, short ${gap.gap.toLocaleString()}`).join("; ");
  }

  function renderRecommendationBundleHtml(bundle, options = {}) {
    const previewRows = bundle.rows.slice(0, recommendationPreviewCount(bundle.requestedCount, bundle.rows.length));
    const downloadId = registerRecommendationDownload(bundle.rows, {
      ...bundle.context,
      downloadType: "offers",
      filePrefix: "offer_recommendations",
      exportScope: "tier_mix",
      sheetName: "Offer Recommendations"
    }, bundle.requestedCount);
    const action = options.action || "Built a recommendation package";
    const gapText = bundleGapText(bundle.gaps);
    const details = [
      `Plan: ${bundlePlanText(bundle.plan)}`,
      `Current file: ${bundle.rows.length.toLocaleString()} offers (${bundleCountsText(bundle.rows) || "none"})`,
      gapText ? `Shortage: ${gapText}` : ""
    ].filter(Boolean).join(". ");
    const note = options.note ? `<p>${escapeHtml(options.note)}</p>` : "";
    return `<p><strong>${escapeHtml(action)}.</strong> ${escapeHtml(details)}.</p>` +
      note +
      `<div class="download-card">
        <div>
          <strong>Offer recommendation file</strong>
          <span>${escapeHtml(bundle.rows.length.toLocaleString())} offers in one Excel sheet. Excluded offers stay out for this chat session.</span>
        </div>
        <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">Download Excel</button>
      </div>` +
      previewRows.map(function(offer, index) {
        return renderRecommendationOfferHtml(offer, index, { language: "en", ...bundle.context });
      }).join("");
  }

  function recommendationBundleAnswer(prompt, plan) {
    const llmParams = state.llmParams || {};
    const regexCategories = categoriesForPrompt(prompt);
    const llmCat = llmParams.category;
    const categories = llmCat ? normalizeCategories(llmCat) : regexCategories;
    const context = {
      prompt,
      categories,
      includeTier4: true,
      includeBlack: true,
      metricFilters: extractMetricFilters(prompt),
      metricSort: extractMetricSortIntent(prompt)
    };
    const bundle = rebuildRecommendationBundle(plan, { context });
    return renderRecommendationBundleHtml(bundle);
  }

  function matchedOffersFromPrompt(prompt, pool) {
    const normalizedPrompt = normalize(prompt);
    const idMatches = new Set((String(prompt || "").match(/\b\d{5,8}(?:\.0)?\b/g) || []).map((id) => id.replace(/\.0$/, "")));
    const ignoredTokens = new Set(["do", "not", "try", "dont", "want", "exclude", "remove", "skip", "change", "replace", "swap", "tier", "offer", "offers", "recommendation", "recommendations", "with", "other", "one", "another", "from", "the", "and"]);
    const promptTokens = (String(prompt || "").toLowerCase().match(/[a-z0-9]+/g) || [])
      .filter((token) => token.length >= 3 && !ignoredTokens.has(token));
    const matches = [];
    const seen = new Set();
    [...pool]
      .sort((a, b) => normalize(b.brand).length - normalize(a.brand).length)
      .forEach((offer) => {
        const key = offerIdentityKey(offer);
        if (seen.has(key)) return;
        const brand = normalize(offer.brand);
        const id = String(offer.merchantId || "").trim();
        const brandTokenMatch = promptTokens.some((token) => brand.includes(token));
        if ((brand.length >= 3 && (normalizedPrompt.includes(brand) || brandTokenMatch)) || (id && idMatches.has(id))) {
          seen.add(key);
          matches.push(offer);
        }
      });
    return matches;
  }

  function isRecommendationExclusionPrompt(prompt) {
    return /\b(do\s*not\s*try|don't\s*try|dont\s*try|do\s*not\s*want|don't\s*want|dont\s*want|exclude|remove|skip|not\s*try)\b/i.test(prompt);
  }

  function isRecommendationReplacementPrompt(prompt) {
    return /\b(change|replace|swap|another|other\s+one)\b/i.test(prompt) && Boolean(state.activeRecommendationBundle);
  }

  function recommendationBundleExclusionAnswer(prompt) {
    const bundle = state.activeRecommendationBundle;
    if (!bundle) return "Create a recommendation package first, then tell me which offers to exclude.";
    let matches = matchedOffersFromPrompt(prompt, bundle.rows);
    if (!matches.length) matches = matchedOffersFromPrompt(prompt, offers);
    if (!matches.length) return "I could not match those offer names in the current data. Send the merchant names or IDs to exclude.";

    const beforeRows = bundle.rows;
    matches.forEach((offer) => state.excludedRecommendationKeys.add(offerIdentityKey(offer)));
    const nextBundle = rebuildRecommendationBundle(bundle.plan, { previousRows: beforeRows, context: bundle.context });
    const beforeKeys = new Set(beforeRows.map(offerIdentityKey));
    const afterKeys = new Set(nextBundle.rows.map(offerIdentityKey));
    const removed = beforeRows.filter((offer) => !afterKeys.has(offerIdentityKey(offer)));
    const added = nextBundle.rows.filter((offer) => !beforeKeys.has(offerIdentityKey(offer)));
    const removedText = removed.length ? `Removed: ${removed.map((offer) => offer.brand).join(", ")}` : `Excluded: ${matches.map((offer) => offer.brand).join(", ")}`;
    const addedText = added.length ? `Added replacements: ${added.map((offer) => offer.brand).join(", ")}` : "No replacement was available for one or more excluded offers";
    return renderRecommendationBundleHtml(nextBundle, {
      action: "Updated the recommendation package",
      note: `${removedText}. ${addedText}.`
    });
  }

  function recommendationBundleReplacementAnswer(prompt) {
    const bundle = state.activeRecommendationBundle;
    if (!bundle) return "Create a recommendation package first, then ask me to change one offer.";
    const promptedTier = tierFromPrompt(prompt);
    const pool = promptedTier ? bundle.rows.filter((offer) => offer.tier === promptedTier) : bundle.rows;
    if (!pool.length) return `There are no ${promptedTier || "matching"} offers in the current recommendation package.`;

    const namedMatches = matchedOffersFromPrompt(prompt, pool);
    const target = namedMatches[0] || pool[pool.length - 1];
    const beforeRows = bundle.rows;
    const beforeKeys = new Set(beforeRows.map(offerIdentityKey));
    state.excludedRecommendationKeys.add(offerIdentityKey(target));
    const nextBundle = rebuildRecommendationBundle(bundle.plan, { previousRows: beforeRows, context: bundle.context });
    const replacement = nextBundle.rows.find((offer) => offer.tier === target.tier && !beforeKeys.has(offerIdentityKey(offer)));
    const replacementText = replacement
      ? `Replaced ${target.brand} with ${replacement.brand} from ${target.tier}.`
      : `Removed ${target.brand} from ${target.tier}, but there was no unused replacement available.`;
    return renderRecommendationBundleHtml(nextBundle, {
      action: "Changed one recommendation",
      note: replacementText
    });
  }

  function metricSortDescription(metricSort) {
    if (!metricSort || !metricSort.field) return "";
    const direction = metricSort.direction === "asc" ? "lowest" : "highest";
    return `tier priority first, then ${metricSort.label} ${direction}`;
  }

  // Shared per-offer renderer used by both recommendationHtml (single-tier)
  // and renderRecommendationBundleHtml (multi-tier plan) so that every
  // recommendation output includes why-recommended, caution, traffic angle, etc.
  function renderRecommendationOfferHtml(offer, index, context) {
    const language = context.language || "en";
    const copy = chatCopy(language);
    return `<div class="recommendation-answer">
        <strong>${index + 1}. ${escapeHtml(offer.brand || "")}</strong> - ${escapeHtml(tierGroup(offer))}
        <ul>
          <li><strong>${escapeHtml(language === "zh" ? copy.merchantId : "Merchant ID")}:</strong> ${escapeHtml(offer.merchantId || (language === "zh" ? copy.notAvailable : "not available"))}</li>
          <li><strong>${escapeHtml(language === "zh" ? copy.keyMetrics : "Key metrics")}:</strong> AOV ${shortMoney(offer.aov)}, EPC ${shortEpc(offer.epc)}, commission ${(Number(offer.commissionRate) || 0).toFixed(2)}%, clicks ${number(offer.clicks).toLocaleString()}, orders ${number(offer.orders).toLocaleString()}, CVR ${shortPct(offer.conversionRate)}, revenue ${shortMoney(offer.salesAmount)}</li>
          ${tier2RecommendationDetailsHtml(offer, language)}
          <li><strong>${escapeHtml(language === "zh" ? copy.whyRecommended : "Why recommended")}:</strong> ${escapeHtml(whyRecommended(offer, context))}</li>
          <li><strong>${escapeHtml(language === "zh" ? copy.bestTrafficAngle : "Best traffic angle")}:</strong> ${escapeHtml(bestAngle(offer, context))}</li>
          <li><strong>${escapeHtml(language === "zh" ? copy.cautionNextStep : "Caution / next step")}:</strong> ${escapeHtml(caution(offer, language))}</li>
        </ul>
      </div>`;
  }

  function recommendationHtml(rows, context = {}) {
    const language = responseLanguageFor(context.prompt || state.currentQuery);
    const copy = chatCopy(language);
    const localizedContext = { ...context, language };
    const requestedCount = number(context.requestedCount) || 5;
    const ranked = rankedRecommendations(rows, localizedContext);
    const exportRows = ranked.slice(0, requestedCount);
    const top = exportRows.slice(0, recommendationPreviewCount(requestedCount, exportRows.length));
    setContext(buildRecommendationContext(exportRows, { ...localizedContext, requestedCount, exportCount: exportRows.length }));
    if (!top.length) return language === "zh" ? copy.recommendationEmpty : "I found no offers that fit this recommendation request with the current filters.";
    const label = language === "zh"
      ? context.category ? `（${escapeHtml(context.category)}）` : context.tier ? `（${escapeHtml(context.tier)}）` : ""
      : context.category ? ` for ${escapeHtml(context.category)}` : context.tier ? ` from ${escapeHtml(context.tier)}` : "";
    const downloadId = registerRecommendationDownload(exportRows, localizedContext, requestedCount);
    const exportNote = language === "zh"
      ? exportRows.length < requestedCount
        ? chatFormat(copy.exportPartial, { count: exportRows.length.toLocaleString() })
        : chatFormat(copy.exportComplete, { count: exportRows.length.toLocaleString() })
      : exportRows.length < requestedCount
        ? `I found ${exportRows.length.toLocaleString()} offers that fit.`
        : `The Excel download includes all ${exportRows.length.toLocaleString()} requested offers.`;
    const filterText = metricFilterText(context.metricFilters);
    const filterNote = filterText ? ` Filtered by ${filterText}.` : "";
    const previewTitle = language === "zh" ? copy.recommendationPreview : "Recommendation preview";
    const showingText = language === "zh"
      ? chatFormat(copy.showingTop, { count: top.length.toLocaleString() })
      : `showing the top ${top.length.toLocaleString()} here so the chat stays readable.`;
    let rankingText = language === "zh"
      ? `${exportRows.length.toLocaleString()} 个 offer，${copy.rankedBy}`
      : `${exportRows.length.toLocaleString()} offers ranked by revenue, orders, CVR, AOV, then EPC.${filterNote}`;
    const metricSortText = metricSortDescription(context.metricSort);
    if (metricSortText) {
      rankingText = `${exportRows.length.toLocaleString()} offers ranked by ${metricSortText}.${filterNote}`;
    }
    return `<p><strong>${escapeHtml(previewTitle)}${label}:</strong> ${escapeHtml(showingText)} ${escapeHtml(exportNote)}</p>` +
      `<div class="download-card">
        <div>
          <strong>${escapeHtml(language === "zh" ? copy.fullRecommendationFile : "Full recommendation file")}</strong>
          <span>${escapeHtml(rankingText)}</span>
        </div>
        <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">${escapeHtml(language === "zh" ? copy.downloadExcel : "Download Excel")}</button>
      </div>` +
      top.map(function(offer, index) { return renderRecommendationOfferHtml(offer, index, localizedContext); }).join("");
  }

  function paymentCycleOfferAnswer(prompt, filter) {
    const language = responseLanguageFor(prompt);
    const rows = offers
      .filter((offer) => paymentCycleFilterMatches(offer, filter))
      .sort((a, b) => number(a.paymentCycle) - number(b.paymentCycle) || tierPriority(a, true, true) - tierPriority(b, true, true) || number(b.orders) - number(a.orders));
    const requestedCount = requestedRecommendationCount(prompt, Math.min(rows.length, MAX_RECOMMENDATION_EXPORT));
    const exportRows = rows.slice(0, Math.min(requestedCount, MAX_RECOMMENDATION_EXPORT));
    const top = exportRows.slice(0, 5);
    const filterText = paymentCycleFilterText(filter, language);
    const scopeOperator = { "<": "below", "<=": "up-to", ">": "above", ">=": "at-least" }[filter.operator] || "cycle";
    const scope = `payment-cycle-${scopeOperator}-${filter.threshold}-days`;
    setContext(buildRecommendationContext(exportRows, {
      exportScope: scope,
      exportCount: exportRows.length,
      requestedCount,
      paymentCycleFilter: filter,
      includeTier4: true,
      includeBlack: true
    }));
    if (!top.length) {
      return language === "zh"
        ? `没有找到${escapeHtml(filterText)}的 offer。可以尝试放宽条件，比如 120天以下。`
        : `I found no offers with ${escapeHtml(filterText)}.`;
    }
    const downloadId = registerRecommendationDownload(exportRows, {
      exportScope: scope,
      paymentCycleFilter: filter,
      includeTier4: true,
      includeBlack: true
    }, requestedCount);
    const foundText = exportRows.length < rows.length
      ? `showing ${exportRows.length.toLocaleString()} of ${rows.length.toLocaleString()} matching offers`
      : `${exportRows.length.toLocaleString()} matching offers`;
    if (language === "zh") {
      const zhFoundText = exportRows.length < rows.length
        ? `导出 ${exportRows.length.toLocaleString()} 个，共 ${rows.length.toLocaleString()} 个匹配 offer`
        : `找到 ${exportRows.length.toLocaleString()} 个匹配 offer`;
      return `<p><strong>付款周期筛选预览：</strong>${escapeHtml(filterText)}，按付款周期从短到长排序；${escapeHtml(zhFoundText)}。聊天中先预览前 ${top.length.toLocaleString()} 个。</p>` +
        `<div class="download-card">
          <div>
            <strong>付款周期 offer 文件</strong>
            <span>${exportRows.length.toLocaleString()} 个 offer，单一 Excel 总表，按付款周期从短到长排序。</span>
          </div>
          <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">下载 Excel</button>
        </div>` +
        resultTable(top, paymentCycleOfferColumns, language);
    }
    return `<p><strong>Payment cycle preview:</strong> ${escapeHtml(filterText)}, sorted shortest first; ${escapeHtml(foundText)}. Showing the top ${top.length.toLocaleString()} here so the chat stays readable.</p>` +
      `<div class="download-card">
        <div>
          <strong>Full payment-cycle file</strong>
          <span>${exportRows.length.toLocaleString()} offers with ${escapeHtml(filterText)}, sorted from shortest payment cycle.</span>
        </div>
        <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">Download Excel</button>
      </div>` +
      resultTable(top, paymentCycleOfferColumns, language);
  }

  function paymentAnswer(prompt) {
    const lower = prompt.toLowerCase();
    const language = responseLanguageFor(prompt);
    const copy = chatCopy(language);
    // LLM params take priority, regex fallback via ??
    const p = state.llmParams || {};
    const month = p.month || monthNameFromText(prompt);
    const tier = p.tier || tierFromPrompt(prompt);
    const merchantMatches = findPaymentMerchantMatches(prompt);
    let rows = getPaymentRecords();

    if (merchantMatches.length) {
      const merchant = merchantMatches[0].merchant;
      rows = getPaymentByMerchant(merchant.merchantId || merchant.brand);
      if (month) rows = rows.filter((record) => record.reportMonth === month);
      rows = sortPaymentRows(rows);
      setContext(buildPaymentContext(rows, prompt));
      const s = updatePaymentSummary(rows);
      const cycle = rows.find((record) => record.paymentCycle);
      const title = `${merchant.brand}${month ? ` - ${month}` : ""}`;
      const cycleText = cycle ? `${cycle.paymentCycle} days` : language === "zh" ? copy.notAvailable : t("payment.notAvailable", "not available in current data");
      const download = downloadCardHtml(rows, {
        downloadType: "payments",
        filePrefix: "payment_records",
        exportScope: title,
        sheetName: "Payments",
        downloadColumns: paymentExportColumns()
      }, {
        title: "Payment records file",
        description: `${rows.length.toLocaleString()} payment records for this merchant/month lookup.`
      });
      if (language === "zh") {
        return `<p><strong>${escapeHtml(title)}</strong> ${escapeHtml(copy.paymentSummary)}: ${s.recordCount.toLocaleString()} ${escapeHtml(copy.recordsAcross)} ${s.merchantCount.toLocaleString()} ${escapeHtml(copy.merchants)}；${escapeHtml(copy.unpaid)} ${s.unpaidMerchantCount.toLocaleString()}，${escapeHtml(copy.pending)} ${s.pendingMerchantCount.toLocaleString()}，${escapeHtml(copy.overdue)} ${s.overdueCount.toLocaleString()}。${escapeHtml(copy.paymentCycle)}：${escapeHtml(cycleText)}。</p>` +
          download +
          resultTable(rows, paymentColumnsFor(language), language);
      }
      return `<p><strong>${escapeHtml(title)}</strong> ${escapeHtml(t("payment.summary", "payment summary"))}: ${s.recordCount.toLocaleString()} ${escapeHtml(t("payment.recordsAcross", "records across"))} ${s.merchantCount.toLocaleString()} ${escapeHtml(t("payment.merchants", "merchants"))}; ${escapeHtml(t("payment.unpaid", "unpaid"))} ${s.unpaidMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.pendingCount", "pending"))} ${s.pendingMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.overdue", "overdue"))} ${s.overdueCount.toLocaleString()}. ${escapeHtml(t("payment.cycle", "payment cycle"))}: ${escapeHtml(cycleText)}.</p>` +
        download +
        resultTable(rows, paymentColumnsFor(language), language);
    }

    if (month) rows = rows.filter((record) => record.reportMonth === month);
    if (tier) rows = rows.filter((record) => record.tier === tier);
    if (/unpaid|issue|late|not paid|overdue|due/.test(lower) || /未付款|没付款|未支付|逾期|到期|需跟进/.test(prompt)) rows = rows.filter((record) => record.paymentStatus === "Unpaid" || isPaymentOverdue(record));
    else if (/partial/.test(lower) || /部分付款|部分支付/.test(prompt)) rows = rows.filter((record) => record.paymentStatus === "Partial");
    else if (/pending|not available yet|before due/.test(lower) || /待处理|未到期|还没到|等待/.test(prompt)) rows = rows.filter((record) => record.paymentStatus === "Pending");
    else if (/already paid|\bpaid\b/.test(lower) || /已付款|已支付/.test(prompt)) rows = rows.filter((record) => record.paymentStatus === "Paid");
    else rows = rows.filter((record) => record.paymentStatus !== "Paid" || /all|summary|overview/.test(lower) || /全部|所有|汇总|概览/.test(prompt));

    rows = sortPaymentRows(rows).slice(0, 60);
    setContext(buildPaymentContext(rows, prompt));
    const s = updatePaymentSummary(rows);
    const label = month ? `${month} payment records` : "Payment records";
    const download = downloadCardHtml(rows, {
      downloadType: "payments",
      filePrefix: "payment_records",
      exportScope: label,
      sheetName: "Payments",
      downloadColumns: paymentExportColumns()
    }, {
      title: "Payment records file",
      description: `${rows.length.toLocaleString()} payment records matching this request.`
    });
    if (language === "zh") {
      const title = month ? `${month} ${copy.paymentRecords}` : copy.paymentRecords;
      return `<p><strong>${escapeHtml(title)}:</strong> ${s.recordCount.toLocaleString()} ${escapeHtml(copy.recordsAcross)} ${s.merchantCount.toLocaleString()} ${escapeHtml(copy.merchants)}；${escapeHtml(copy.unpaid)} ${s.unpaidMerchantCount.toLocaleString()}，${escapeHtml(copy.pending)} ${s.pendingMerchantCount.toLocaleString()}，${escapeHtml(copy.overdue)} ${s.overdueCount.toLocaleString()}。</p>` +
        download +
        resultTable(rows, paymentColumnsFor(language), language);
    }
    return `<p><strong>${escapeHtml(state.language === "zh" ? `${optionText(month || "") || t("payments.records", "Payment records")}` : label)}:</strong> ${s.recordCount.toLocaleString()} ${escapeHtml(t("payment.recordsAcross", "records across"))} ${s.merchantCount.toLocaleString()} ${escapeHtml(t("payment.merchants", "merchants"))}; ${escapeHtml(t("payment.unpaid", "unpaid"))} ${s.unpaidMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.pendingCount", "pending"))} ${s.pendingMerchantCount.toLocaleString()}, ${escapeHtml(t("payment.overdue", "overdue"))} ${s.overdueCount.toLocaleString()}.</p>` +
      download +
      resultTable(rows, paymentColumnsFor(language), language);
  }

  function asinAnswer(results) {
    // Support both single result (backward compat) and array (multi-ASIN)
    if (!Array.isArray(results)) results = [results];
    const language = responseLanguageFor();
    const copy = chatCopy(language);
    if (!results.length || !results[0].rows.length) {
      var notFoundAsin = results.length ? results[0].asin : "";
      return language === "zh"
        ? `ASIN <strong>${escapeHtml(notFoundAsin)}</strong> ${escapeHtml(copy.asinNotFound)}`
        : `ASIN <strong>${escapeHtml(notFoundAsin)}</strong> was not found in the current data.`;
    }
    setContext(buildASINContext(results[0]));
    // Render each ASIN → merchant mapping
    var parts = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (!r.rows.length) {
        parts.push(language === "zh"
          ? `<p>ASIN <strong>${escapeHtml(r.asin)}</strong> ${escapeHtml(copy.asinNotFound)}</p>`
          : `<p>ASIN <strong>${escapeHtml(r.asin)}</strong> was not found in the current data.</p>`);
        continue;
      }
      var offer = r.rows[0];
      if (language === "zh") {
        parts.push(`<p>ASIN <strong>${escapeHtml(r.asin)}</strong> ${escapeHtml(copy.asinBelongsTo)} <strong>${escapeHtml(offer.brand)}</strong></p>`);
      } else {
        parts.push(`<p>ASIN <strong>${escapeHtml(r.asin)}</strong> → <strong>${escapeHtml(offer.brand)}</strong></p>`);
      }
    }
    // Show merchant overview for the first matched ASIN
    var primary = results.find(function(r) { return r.rows.length > 0; });
    if (primary) {
      var offer = primary.rows[0];
      if (language === "zh") {
        parts.push(merchantOverviewHtml(offer, "(ASIN match)", language));
        parts.push(`<p><strong>${escapeHtml(copy.recommendedTrafficAngle)}:</strong> ${escapeHtml(bestAngle(offer, { language }))}</p>`);
      } else {
        parts.push(merchantOverviewHtml(offer, "(ASIN match)", language));
        parts.push(`<p><strong>Recommended traffic angle:</strong> ${escapeHtml(bestAngle(offer, { language }))}</p>`);
      }
    }
    return parts.join("");
  }

  function answerPrompt(prompt) {
    // Extract LLM params into state.llmParams so downstream fns (paymentAnswer) can use them.
    // detectQueryIntent will consume state.llmClassifyResult.intent as before.
    state.llmParams = (state.llmClassifyResult && state.llmClassifyResult.params) || {};
    const p = state.llmParams;

    state.currentQuery = prompt;
    const lower = prompt.toLowerCase().trim();
    const language = responseLanguageFor(prompt);
    const copy = chatCopy(language);
    const tierOfferPlan = (p.tierOfferPlan && p.tierOfferPlan.length)
      ? p.tierOfferPlan
      : parseTierOfferRequest(prompt);
    if (tierOfferPlan.length) return recommendationBundleAnswer(prompt, tierOfferPlan);
    if (isRecommendationExclusionPrompt(prompt)) return recommendationBundleExclusionAnswer(prompt);
    if (isRecommendationReplacementPrompt(prompt)) return recommendationBundleReplacementAnswer(prompt);
    // detectQueryIntent will consume state.llmClassifyResult and return LLM intent if present
    const intent = detectQueryIntent(prompt);
    // ASIN: LLM-extracted array or regex lookup (multi-ASIN support)
    const llmAsins = p.asin;
    const asinResults = llmAsins
      ? (Array.isArray(llmAsins) ? llmAsins : [llmAsins]).map(function(a) {
          return { asin: a, rows: offers.filter(function(o) { return (o.topAsins || []).includes(a) || (o.productAsins || []).includes(a); }) };
        }).filter(function(r) { return r.rows.length > 0; })
      : findAllAsins(prompt);
    if (asinResults.length && intent === "asin") return asinAnswer(asinResults);

    // Merchant ID: LLM-extracted ID or regex lookup
    const exactFromLLM = p.merchantId;
    const exact = exactFromLLM
      ? offers.find(function(o) { return o.merchantId === exactFromLLM; }) || null
      : findByMerchantId(prompt);
    if (exact) return merchantOverview(exact, "", language);

    // Payment cycle filter: LLM-extracted or regex
    const pcfLLM = p.paymentCycleFilter;
    const paymentCycleFilter = (pcfLLM && pcfLLM.operator && pcfLLM.threshold != null)
      ? { operator: pcfLLM.operator, threshold: Number(pcfLLM.threshold) }
      : extractPaymentCycleFilter(prompt);
    if (paymentCycleFilter) return paymentCycleOfferAnswer(prompt, paymentCycleFilter);

    if (contextFollowup(lower)) {
      if (promptHasPaymentTerms(lower) || /付款|支付|未付款|已付款|周期|逾期|到期/.test(prompt)) {
        return paymentAnswer(`${state.lastOffer.brand} ${prompt}`);
      }
      if (/epc/.test(lower)) {
        setContext(buildMerchantContext(state.lastOffer));
        return language === "zh"
          ? `<strong>${escapeHtml(state.lastOffer.brand)}</strong> ${escapeHtml(copy.epcIs)} ${epc(state.lastOffer.epc)}。`
          : `<strong>${escapeHtml(state.lastOffer.brand)}</strong> EPC is ${epc(state.lastOffer.epc)}.`;
      }
      if (/aov|客单价/.test(lower)) {
        setContext(buildMerchantContext(state.lastOffer));
        return language === "zh"
          ? `<strong>${escapeHtml(state.lastOffer.brand)}</strong> ${escapeHtml(copy.aovIs)} ${money(state.lastOffer.aov)}。`
          : `<strong>${escapeHtml(state.lastOffer.brand)}</strong> AOV is ${money(state.lastOffer.aov)}.`;
      }
      if (/order|订单/.test(lower)) {
        setContext(buildMerchantContext(state.lastOffer));
        return language === "zh"
          ? `<strong>${escapeHtml(state.lastOffer.brand)}</strong> ${escapeHtml(copy.orderCountIs)} ${number(state.lastOffer.orders).toLocaleString()}。`
          : `<strong>${escapeHtml(state.lastOffer.brand)}</strong> order count is ${number(state.lastOffer.orders).toLocaleString()}.`;
      }
      return merchantOverview(state.lastOffer, "", language);
    }

    // Parameters: LLM-extracted first, regex fallback.
    // Categories now support multi-value: LLM may return a string, comma-separated
    // string, or array — normalizeCategories converts all to array.
    // regexCategories always comes from categoriesForPrompt which splits on
    // 和/and/、 etc. and extracts each part individually.
    const regexCategories = categoriesForPrompt(prompt);
    const llmCat = p.category;
    const categories = llmCat ? normalizeCategories(llmCat) : regexCategories;
    const category = categories[0] || null;  // primary category for backward compat
    // Tiers now support multi-value (multi-tier support).
    // LLM may return string/array; normalizeTiers converts to array.
    // tiersFromPrompt splits on 和/and/、 etc. for regex extraction.
    const regexTiers = tiersFromPrompt(prompt);
    const llmTier = p.tier;
    const tiers = llmTier ? normalizeTiers(llmTier) : regexTiers;
    const tier = tiers[0] || null;  // primary tier for backward compat
    const wantsTier4 = p.includeTier4 === true || /tier 4|retest|第四层|第四级|四层|四级|重测|重新测试/i.test(prompt);
    const wantsBlack = p.includeBlack === true || /black|blocked|黑名单|黑色|屏蔽|暂停/i.test(prompt);
    const wantsRecommendation = intent === "recommendation";
    const wantsGoogle = /google|keyword|brand keyword|search/.test(lower) || /关键词|搜索|品牌词/.test(prompt);
    const metricFilters = (p.metricFilters && p.metricFilters.length)
      ? p.metricFilters.map(normalizeLlmMetricFilter).filter(Boolean)
      : extractMetricFilters(prompt);
    const topMetricRequest = extractTopMetricRequest(prompt);
    const llmSort = p.metricSort;
    const metricSort = (llmSort && llmSort.field && llmSort.direction)
      ? { field: llmSort.field, label: llmSort.field, type: "money", direction: llmSort.direction }
      : extractMetricSortIntent(prompt);
    const keywordRequest = keywordSearchRequest(prompt);

    // When LLM params indicate a recommendation (tier, count, metricFilter, metricSort),
    // skip keyword search — the user is asking for ranked offers, not a text search.
    const llmIndicatesRecommendation = p.tier || p.count || (p.metricFilters && p.metricFilters.length) || p.metricSort;

    // LLM-param route: user asked for category-level ranking
    if (p.recommendCategories === true) {
      return recommendedCategoriesAnswer(prompt);
    }

    if (intent === "analysis") {
      return analysisAnswer(prompt, p);
    }

    if (!llmIndicatesRecommendation && intent !== "merchant" && hasKeywordSearchIntent(prompt, keywordRequest, { category })) {
      return keywordSearchAnswer(prompt, keywordRequest, { topMetricRequest });
    }

    if (topMetricRequest) {
      return topMetricOfferAnswer(prompt, topMetricRequest);
    }

    if (intent === "payment") {
      return paymentAnswer(prompt);
    }

    // Regex fallback: detect category-ranking intent when LLM didn't return recommendCategories
    // Trigger when user asks for "recommended categories" / "category ranking" / "品类推荐"
    // without specifying a concrete category, tier, count, or metric filter/sort.
    if (wantsRecommendation && !categories.length && !tiers.length && !p.count && !metricFilters.length && !metricSort && hasCategoryIntentText(prompt) && !keywordRequest) {
      return recommendedCategoriesAnswer(prompt);
    }

    if (wantsRecommendation) {
      let pool = categories.length ? sortedForCategory(categories, { includeTier4: wantsTier4, includeBlack: wantsBlack, prompt, tier: tiers }) : offers;
      if (tiers.length) pool = pool.filter(function(o) { return tiers.indexOf(o.tier) !== -1; });
      pool = applyMetricFilters(pool, metricFilters);
      const reqCount = p.count || requestedRecommendationCount(prompt);
      return recommendationHtml(pool, { categories, category, tiers, tier, google: wantsGoogle, includeTier4: wantsTier4, includeBlack: wantsBlack, metricFilters, metricSort, requestedCount: reqCount, prompt });
    }

    if (tiers.length) {
      let rows = offers
        .filter(function(o) { return tiers.indexOf(o.tier) !== -1; })
        .filter(function(o) { return wantsTier4 || o.tier !== "Tier 4" || tiers.indexOf("Tier 4") !== -1; })
        .filter(function(o) { return wantsBlack || o.tier !== "BLACK TIER" || tiers.indexOf("BLACK TIER") !== -1; })
        .sort(function(a, b) { return compareRecommendationOffers(a, b, { includeTier4: true, includeBlack: true }); });
      if (categories.length) {
        rows = rows.filter(function(o) { return categoryMatches(o, categories); });
      }
      var tierLabel = tiers.join(" + ");
      setContext(buildTierContext(tierLabel, rows));
      var topRows = topRecommendations(rows, { tier: tierLabel, includeTier4: true, includeBlack: true });
      var columns = tiers.length === 1 && tiers[0] === "Tier 2" ? tier2CompactColumns : compactColumns;
      var catLabel = categories.length ? categories.join(" + ") : "";
      var title = language === "zh"
        ? `${escapeHtml(tierLabel)}${catLabel ? " " + escapeHtml(catLabel) : ""} ${escapeHtml(copy.tierOverview)}`
        : `${escapeHtml(tierLabel)}${catLabel ? " " + escapeHtml(catLabel) : ""} overview and top candidates:`;
      return title +
        downloadCardHtml(rows, {
          downloadType: "offers",
          filePrefix: "tier_offers",
          exportScope: tier,
          sheetName: tier
        }, {
          title: `${tier} file`,
          description: `${rows.length.toLocaleString()} ${tier} offers from the current offer data.`
        }) +
        resultTable(topRows, columns, language);
    }

    if (categories.length) {
      let rows = sortedForCategory(categories, { includeTier4: wantsTier4, includeBlack: wantsBlack, prompt });
      if (tiers.length) rows = rows.filter(function(o) { return tiers.indexOf(o.tier) !== -1; });
      const previewRows = rows.slice(0, 25);
      setContext(buildCategoryContext(category, rows.slice(0, 80)));
      const catLabel = categories.join(" + ");
      const tierLabel = tiers.length ? tiers.join(" + ") + " " : "";
      const title = language === "zh"
        ? `<strong>${escapeHtml(tierLabel)}${escapeHtml(catLabel)}</strong> ${escapeHtml(copy.categoryOffers)}`
        : `Relevant <strong>${escapeHtml(tierLabel)}${escapeHtml(catLabel)}</strong> offers, sorted by tier priority and performance:`;
      return title +
        downloadCardHtml(rows, {
          downloadType: "offers",
          filePrefix: "category_offers",
          exportScope: catLabel,
          sheetName: "Category Offers"
        }, {
          title: `${catLabel} file`,
          description: `${rows.length.toLocaleString()} matching category offers.`
        }) +
        resultTable(previewRows, compactColumns, language);
    }

    // Category ranking follow-up: user drills into a specific category after seeing rankings
    if (state.lastCategoryRanking && categories.length && !tiers.length && !wantsRecommendation) {
      var targetCat = categories[0];
      var rankInfo = state.lastCategoryRanking.rankings.find(function(r) {
        return categoryMatches({ category: r.category }, targetCat);
      });
      if (rankInfo) {
        var rows2 = sortedForCategory([targetCat], { includeTier4: wantsTier4, includeBlack: wantsBlack, prompt: prompt });
        var preview2 = rows2.slice(0, 25);
        setContext(buildCategoryContext(targetCat, rows2.slice(0, 80)));
        var rankNote = language === "zh"
          ? '（品类排名第' + (state.lastCategoryRanking.rankings.indexOf(rankInfo) + 1) + '，综合分: ' + rankInfo.score + '）'
          : ' (Rank #' + (state.lastCategoryRanking.rankings.indexOf(rankInfo) + 1) + ', Score: ' + rankInfo.score + ')';
        var title2 = language === "zh"
          ? '<h3>' + escapeHtml(targetCat) + ' 品类详情' + rankNote + '</h3>'
          : '<h3>' + escapeHtml(targetCat) + ' category details' + rankNote + '</h3>';
        return title2 +
          resultTable(preview2, compactColumns, language) +
          downloadCardHtml(rows2, {
            downloadType: "offers",
            filePrefix: "category_offers",
            exportScope: targetCat,
            sheetName: "Category Offers"
          }, {
            title: targetCat + ' file',
            description: rows2.length.toLocaleString() + ' matching offers.'
          });
      }
    }

    if (/high epc|high aov|low conversion|low cvr|tracking issue|has asin|discount/.test(lower) || /高\s*epc|高\s*aov|低转化|低转换|跟踪问题|追踪问题|有\s*asin|折扣|优惠/.test(prompt)) {
      const rows = offers
        .filter((offer) => !(/tracking issue/.test(lower) || /跟踪问题|追踪问题/.test(prompt)) || offer.trackingIssue)
        .filter((offer) => !(/has asin/.test(lower) || /有\s*asin/.test(prompt)) || offer.hasAsin)
        .filter((offer) => !(/discount/.test(lower) || /折扣|优惠/.test(prompt)) || offer.hasDiscount)
        .sort((a, b) => {
          if (/low conversion|low cvr/.test(lower) || /低转化|低转换/.test(prompt)) return number(a.conversionRate) - number(b.conversionRate);
          if (/high aov/.test(lower) || /高\s*aov/.test(prompt)) return number(b.aov) - number(a.aov);
          return number(b.epc) - number(a.epc);
        });
      const previewRows = rows.slice(0, 30);
      setContext(buildCategoryContext("filtered result", rows));
      return downloadCardHtml(rows, {
        downloadType: "offers",
        filePrefix: "filtered_offers",
        exportScope: lower.slice(0, 48) || "filtered_result",
        sheetName: "Filtered Offers"
      }, {
        title: "Filtered offers file",
        description: `${rows.length.toLocaleString()} matching offers for this filter.`
      }) +
      resultTable(previewRows, compactColumns, language);
    }

    if (lower.length < 3 || /^(help|hello|hi|what can you do)\??$/.test(lower) || /帮助|你好|能做什么/.test(prompt)) {
      setContext({ type: "default", items: getFiltered().slice(0, 80), summary: {}, filters: {} });
      return language === "zh" ? copy.help : "What do you want to look up: merchant name, merchant ID, ASIN, category, payment status, or recommendations?";
    }

    const matches = findMerchantMatches(prompt);
    if (matches.length === 1 || (matches[0] && matches[0].adjusted >= 95 && (!matches[1] || matches[0].adjusted - matches[1].adjusted > 10))) {
      return merchantOverview(matches[0].offer, "", language);
    }
    return closestMatchesHtml(matches, prompt);
  }

  function dbMerchantProductRows(products = []) {
    return products.slice(0, 5).map((product) => {
      const asin = product.asin || "-";
      const name = product.productName || product.title || "Unnamed product";
      const bsr = product.bsr || product.subCategoryBsr || "-";
      return `<li><strong>${escapeHtml(asin)}</strong><span>${escapeHtml(name)}</span><small>BSR ${escapeHtml(bsr)}</small></li>`;
    }).join("");
  }

  function dbMerchantInsightHtml(payload, fallbackOffer = {}) {
    if (!payload || payload.ok === false) return "";
    const merchant = payload.merchant || {};
    const monthly = Array.isArray(payload.monthlyAmazonMetrics) ? payload.monthlyAmazonMetrics[0] : null;
    const products = Array.isArray(payload.products) ? payload.products : [];
    const title = merchant.merchantName || fallbackOffer.brand || `Merchant ${payload.merchantId || ""}`;
    const productCount = merchant.productCount ?? products.length;
    const monthLine = monthly
      ? `${escapeHtml(monthly.month || "Latest month")}: ${compactNumber(monthly.orders || 0)} orders, ${compactMoney(monthly.revenue || 0)} revenue, EPC ${shortEpc(monthly.epc || 0)}`
      : "Monthly Amazon metrics are not available for this merchant yet.";
    return `<section class="db-chat-card">
      <div class="db-chat-card-head">
        <strong>Live DB details</strong>
        <span>${escapeHtml(title)}</span>
      </div>
      <div class="db-chat-facts">
        <span>${escapeHtml(String(productCount || 0))} products</span>
        <span>${escapeHtml(monthLine)}</span>
      </div>
      ${products.length ? `<ul class="db-chat-products">${dbMerchantProductRows(products)}</ul>` : `<p>No product rows returned by DB for this merchant.</p>`}
    </section>`;
  }

  async function loadDbMerchantInsight(offer) {
    if (!offer || typeof fetch !== "function") return;
    const merchantId = String(offer.merchantId || "").trim();
    if (!merchantId || dbMerchantLoading.has(merchantId)) return;
    if (dbMerchantCache.has(merchantId)) {
      const cached = dbMerchantInsightHtml(dbMerchantCache.get(merchantId), offer);
      if (cached) addMessage("assistant", cached);
      return;
    }
    dbMerchantLoading.add(merchantId);
    try {
      const response = await fetch(`${DB_MERCHANT_UI_API}?merchantId=${encodeURIComponent(merchantId)}&limit=8&months=6`, { cache: "no-store" });
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }
      if (!response.ok || (payload && payload.ok === false)) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`);
      }
      dbMerchantCache.set(merchantId, payload);
      const html = dbMerchantInsightHtml(payload, offer);
      if (html) addMessage("assistant", html);
    } catch (error) {
      addMessage("assistant", `<section class="db-chat-card db-chat-card-muted"><strong>Live DB details unavailable</strong><p>The static merchant answer is still loaded. DB detail requires the server-side Offer DB environment.</p></section>`);
    } finally {
      dbMerchantLoading.delete(merchantId);
    }
  }

  function dbLookupSkipPrompt(prompt) {
    const lower = String(prompt || "").toLowerCase().trim();
    if (lower.length < 3 || /^(help|hello|hi|what can you do)\??$/.test(lower)) return true;
    if (findByAsin(prompt) || extractPaymentCycleFilter(prompt) || promptHasPaymentTerms(lower)) return true;
    if (tierFromPrompt(prompt) || extractMetricFilters(prompt).length || extractMetricSortIntent(prompt) || extractTopMetricRequest(prompt)) return true;
    return /\b(?:recommend|top|best|category|categories|payment|paid|unpaid|late|overdue|export|download|list)\b/.test(lower);
  }

  function dbSearchQueryForPrompt(prompt) {
    const cleaned = cleanedMerchantLookupPhrase(prompt) || String(prompt || "").trim();
    return cleaned.replace(/\s+/g, " ").trim().slice(0, 80);
  }

  function dbMerchantOfferForPrompt(prompt) {
    const exact = findByMerchantId(prompt);
    if (exact) return exact;
    if (dbLookupSkipPrompt(prompt)) return null;
    const query = dbSearchQueryForPrompt(prompt);
    if (query.length < 2) return null;
    const matches = findMerchantMatches(query);
    const first = matches[0];
    const second = matches[1];
    if (!first) return null;
    if (matches.length === 1) return first.offer;
    if (first.adjusted >= 95 && (!second || first.adjusted - second.adjusted > 10)) return first.offer;
    return null;
  }

  function dbSearchRowsHtml(rows = []) {
    return rows.slice(0, 6).map((row) => {
      const merchantId = row.merchantId || "-";
      const merchantName = row.merchantName || row.brand || "Unnamed merchant";
      const meta = [row.network, row.status, row.commissionRate ? `Commission ${row.commissionRate}` : ""].filter(Boolean).join(" / ");
      return `<li><strong>${escapeHtml(merchantId)}</strong><span>${escapeHtml(merchantName)}</span><small>${escapeHtml(meta || "DB match")}</small></li>`;
    }).join("");
  }

  function dbSearchInsightHtml(payload) {
    if (!payload || payload.ok === false) return "";
    const rows = Array.isArray(payload.results) ? payload.results : [];
    const title = `Live DB search: ${payload.query || ""}`.trim();
    return `<section class="db-chat-card">
      <div class="db-chat-card-head">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(rows.length ? `${rows.length} public matches` : "No public matches")}</span>
      </div>
      ${rows.length ? `<ul class="db-chat-products db-chat-search">${dbSearchRowsHtml(rows)}</ul>` : `<p>No DB merchants in the public snapshot matched this search.</p>`}
    </section>`;
  }

  async function loadDbSearchInsight(prompt) {
    if (typeof fetch !== "function" || dbLookupSkipPrompt(prompt)) return;
    const query = dbSearchQueryForPrompt(prompt);
    if (query.length < 2) return;
    const cacheKey = normalize(query);
    if (!cacheKey || dbSearchLoading.has(cacheKey)) return;
    if (dbSearchCache.has(cacheKey)) {
      const cached = dbSearchInsightHtml(dbSearchCache.get(cacheKey));
      if (cached) addMessage("assistant", cached);
      return;
    }
    dbSearchLoading.add(cacheKey);
    try {
      const response = await fetch(`${DB_SEARCH_UI_API}?q=${encodeURIComponent(query)}&limit=6`, { cache: "no-store" });
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }
      if (!response.ok || (payload && payload.ok === false)) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`);
      }
      dbSearchCache.set(cacheKey, payload);
      const html = dbSearchInsightHtml(payload);
      if (html) addMessage("assistant", html);
    } catch (error) {
      dbSearchCache.delete(cacheKey);
    } finally {
      dbSearchLoading.delete(cacheKey);
    }
  }

  function addMessage(role, html) {
    const msg = document.createElement("div");
    msg.className = `message ${role}`;
    msg.innerHTML = html;
    els.chatLog.appendChild(msg);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }

  function updateDeepSkeleton(activeStep) {
    // activeStep: 1, 2, or 3 — drives skeleton steps based on real progress
    document.querySelectorAll(".deep-skeleton-step").forEach(function (el, i) {
      el.classList.remove("active", "done");
      if (i + 1 < activeStep) el.classList.add("done");
      if (i + 1 === activeStep) el.classList.add("active");
    });
  }

  // === 多重浮窗面板管理器 ===

  function _deepPanelTemplate() {
    return '<div class="deep-window-header">' +
      '<h2 class="deep-window-title">' + t("deep.title", "Deep Analysis") + '</h2>' +
      '<div class="deep-window-actions">' +
        '<button class="deep-window-stop hidden" type="button">' + t("deep.stop", "Stop") + '</button>' +
        '<button class="deep-window-export" type="button">' + t("deep.export", "Export") + '</button>' +
        '<button class="deep-window-minimize" type="button" aria-label="Minimize" title="Minimize">─</button>' +
        '<button class="deep-window-close" type="button" aria-label="Close">✕</button>' +
      '</div></div>' +
      '<div class="deep-window-body">' +
        '<div class="deep-window-skeleton">' +
          '<div class="deep-skeleton-step active"><div class="deep-skeleton-spinner"></div><span>' + t("deep.skeleton.step1", "Understanding your question…") + '</span></div>' +
          '<div class="deep-skeleton-step"><div class="deep-skeleton-spinner"></div><span>' + t("deep.skeleton.step2", "Querying data…") + '</span></div>' +
          '<div class="deep-skeleton-step"><div class="deep-skeleton-spinner"></div><span>' + t("deep.skeleton.step3", "Generating report…") + '</span></div>' +
        '</div>' +
        '<div class="deep-window-content hidden">' +
          '<div class="deep-report-title"></div>' +
          '<div class="deep-report-summary"></div>' +
          '<div class="deep-report-sections"></div>' +
        '</div>' +
        '<div class="deep-window-error hidden"><p></p></div>' +
      '</div>';
  }

  function _createDeepPanel(prompt) {
    var id = "deep-panel-" + (++_deepPanelIdCounter);
    var zIndex = ++_deepMaxZIndex;
    // 层叠偏移：新面板依次偏移
    var baseIdx = _deepPanels.length;
    var left = Math.max(12, (window.innerWidth - 760) / 2 + baseIdx * 30);
    var top = Math.max(12, (window.innerHeight - 720) / 2 + baseIdx * 30);
    left = Math.min(left, window.innerWidth - 300);
    top = Math.min(top, window.innerHeight - 200);

    var div = document.createElement("div");
    div.className = "deep-window";
    div.id = id;
    div.style.zIndex = zIndex;
    div.style.left = left + "px";
    div.style.top = top + "px";
    div.innerHTML = _deepPanelTemplate();
    document.body.appendChild(div);

    var panel = {
      id: id,
      el: div,
      prompt: prompt,
      abortController: null,
      state: "loading",
      minimized: false,
      zIndex: zIndex,
      dragState: null,
      title: t("deep.report.defaultTitle", "Analysis Report"),
      skeletonEl: div.querySelector(".deep-window-skeleton"),
      contentEl: div.querySelector(".deep-window-content"),
      errorEl: div.querySelector(".deep-window-error"),
      titleEl: div.querySelector(".deep-window-title"),
      summaryEl: div.querySelector(".deep-report-summary"),
      sectionsEl: div.querySelector(".deep-report-sections")
    };

    _bindPanelEvents(panel);
    _initPanelDrag(panel);
    _bringPanelToFront(panel);
    _deepPanels.push(panel);
    return panel;
  }

  function _bindPanelEvents(panel) {
    var el = panel.el;
    el.querySelector(".deep-window-close").addEventListener("click", function () {
      _removeDeepPanel(panel.id);
    });
    el.querySelector(".deep-window-minimize").addEventListener("click", function () {
      if (panel.minimized) {
        _expandDeepPanel(panel.id);
      } else {
        _minimizeDeepPanel(panel.id);
      }
    });
    el.querySelector(".deep-window-export").addEventListener("click", function () {
      window.print();
    });
    el.querySelector(".deep-window-stop").addEventListener("click", function () {
      _cancelDeepPanel(panel.id);
    });
    // 点击 header 置顶（最低优先，让 drag 先处理）
    el.querySelector(".deep-window-header").addEventListener("mousedown", function () {
      if (!panel.dragState) _bringPanelToFront(panel);
    });
  }

  // === 拖拽（每个面板独立）===

  function _initPanelDrag(panel) {
    var header = panel.el.querySelector(".deep-window-header");
    header.addEventListener("mousedown", function (e) {
      if (e.target.closest("button, input, select, textarea, .deep-window-actions")) return;
      e.preventDefault();
      var rect = panel.el.getBoundingClientRect();
      panel.dragState = {
        startX: e.clientX,
        startY: e.clientY,
        panelLeft: rect.left,
        panelTop: rect.top,
        moved: false
      };
      panel.el.classList.add("dragging");
      _bringPanelToFront(panel);
      document.addEventListener("mousemove", _onPanelDragMove);
      document.addEventListener("mouseup", _onPanelDragEnd);
    });
  }

  function _onPanelDragMove(e) {
    var panel = _deepPanels.find(function (p) { return p.dragState; });
    if (!panel || !panel.dragState) return;
    var ds = panel.dragState;
    ds.moved = true;
    var newLeft = ds.panelLeft + e.clientX - ds.startX;
    var newTop = ds.panelTop + e.clientY - ds.startY;
    newLeft = Math.max(-panel.el.offsetWidth * 0.5, Math.min(newLeft, window.innerWidth - 40));
    newTop = Math.max(0, Math.min(newTop, window.innerHeight - 60));
    panel.el.style.left = newLeft + "px";
    panel.el.style.top = newTop + "px";
  }

  function _onPanelDragEnd() {
    var panel = _deepPanels.find(function (p) { return p.dragState; });
    if (panel) {
      var wasMinClick = panel.minimized && !panel.dragState.moved;
      panel.dragState = null;
      panel.el.classList.remove("dragging");
      // 点击最小化药丸（未拖动）→ 展开
      if (wasMinClick) {
        _expandDeepPanel(panel.id);
        return;
      }
    }
    document.removeEventListener("mousemove", _onPanelDragMove);
    document.removeEventListener("mouseup", _onPanelDragEnd);
  }

  function _bringPanelToFront(panel) {
    _deepMaxZIndex++;
    panel.zIndex = _deepMaxZIndex;
    panel.el.style.zIndex = panel.zIndex;
  }

  // === 最小化 / 展开 ===

  function _minimizeDeepPanel(id) {
    var panel = _deepPanels.find(function (p) { return p.id === id; });
    if (!panel || panel.state === "loading" || panel.minimized) return;
    panel.minimized = true;
    panel.el.classList.add("minimized");
    // 切换最小化按钮为展开图标
    var minBtn = panel.el.querySelector(".deep-window-minimize");
    if (minBtn) { minBtn.textContent = "▢"; minBtn.title = "Expand"; }
    _bringPanelToFront(panel);
  }

  function _expandDeepPanel(id) {
    var panel = _deepPanels.find(function (p) { return p.id === id; });
    if (!panel) return;
    panel.minimized = false;
    panel.el.classList.remove("minimized");
    // 恢复最小化按钮图标
    var minBtn = panel.el.querySelector(".deep-window-minimize");
    if (minBtn) { minBtn.textContent = "─"; minBtn.title = "Minimize"; }
    _bringPanelToFront(panel);
  }

  function _removeDeepPanel(id) {
    var idx = _deepPanels.findIndex(function (p) { return p.id === id; });
    if (idx === -1) return;
    var panel = _deepPanels[idx];
    if (panel.abortController) {
      panel.abortController.abort();
    }
    panel.el.remove();
    _deepPanels.splice(idx, 1);
  }

  // === 骨架屏 ===

  function updateDeepSkeletonInPanel(panel, activeStep) {
    var steps = panel.skeletonEl ? panel.skeletonEl.querySelectorAll(".deep-skeleton-step") : [];
    steps.forEach(function (el, i) {
      el.classList.remove("active", "done");
      if (i + 1 < activeStep) el.classList.add("done");
      if (i + 1 === activeStep) el.classList.add("active");
    });
  }

  // === 打开 / 渲染 / 错误 / 取消 ===

  function _showPanelSkeleton(panel, reasoning) {
    panel.state = "loading";
    if (panel.skeletonEl) panel.skeletonEl.classList.remove("hidden");
    if (panel.contentEl) panel.contentEl.classList.add("hidden");
    if (panel.errorEl) panel.errorEl.classList.add("hidden");
    // 重置骨架步
    var steps = panel.skeletonEl ? panel.skeletonEl.querySelectorAll(".deep-skeleton-step") : [];
    steps.forEach(function (el, i) {
      el.classList.remove("active", "done");
      if (i === 0) el.classList.add("active");
    });
    // 按钮状态
    panel.el.querySelector(".deep-window-stop")?.classList.toggle("hidden", !reasoning);
    panel.el.querySelector(".deep-window-close")?.classList.toggle("hidden", !!reasoning);
    panel.el.querySelector(".deep-window-export")?.classList.toggle("hidden", !!reasoning);
    panel.el.classList.toggle("generating", !!reasoning);
  }

  function _renderPanelReport(panel, report) {
    panel.state = "content";
    if (panel.skeletonEl) panel.skeletonEl.classList.add("hidden");
    if (panel.contentEl) panel.contentEl.classList.remove("hidden");
    if (panel.errorEl) panel.errorEl.classList.add("hidden");

    var title = report.title || t("deep.report.defaultTitle", "Analysis Report");
    panel.title = title;
    if (panel.titleEl) panel.titleEl.textContent = title;
    if (panel.summaryEl) panel.summaryEl.textContent = report.summary || "";

    if (panel.sectionsEl) {
      panel.sectionsEl.innerHTML = (report.sections || []).map(function (section) {
        var severityClass = section.severity ? " severity-" + section.severity : "";
        var tableHtml = "";
        if (section.table && section.table.headers && section.table.headers.length) {
          var headers = section.table.headers;
          var rows = section.table.rows || [];
          headers = headers.map(function (h) { return _deepHeaderLabel(h); });
          var colTypes = headers.map(function (h) { return _isNumericCol(h) ? "num" : "text"; });
          var headerHtml = headers.map(function (h, i) {
            var cls = colTypes[i] === "num" ? ' class="num"' : "";
            return "<th" + cls + ">" + escapeHtml(h) + "</th>";
          }).join("");
          var rowHtml = rows.map(function (row) {
            return "<tr>" + row.map(function (c, i) {
              var cls = colTypes[i] === "num" ? ' class="num"' : "";
              return "<td" + cls + ">" + escapeHtml(c) + "</td>";
            }).join("") + "</tr>";
          }).join("");
          tableHtml = '<div class="deep-table-wrap"><table class="deep-report-table"><thead><tr>' + headerHtml + '</tr></thead><tbody>' + rowHtml + '</tbody></table></div>';
        }
        return '<section class="deep-report-section' + severityClass + '">' +
          '<h3>' + escapeHtml(section.title) + '</h3>' +
          (section.findings ? '<ul class="deep-report-findings">' + section.findings.map(function (f) { return '<li>' + escapeHtml(f) + '</li>'; }).join("") + '</ul>' : "") +
          tableHtml +
          '</section>';
      }).join("");
    }

    // 恢复按钮
    panel.el.querySelector(".deep-window-stop")?.classList.add("hidden");
    panel.el.querySelector(".deep-window-close")?.classList.remove("hidden");
    panel.el.querySelector(".deep-window-export")?.classList.remove("hidden");
    panel.el.classList.remove("generating");
  }

  function _showPanelError(panel, message) {
    panel.state = "error";
    if (panel.skeletonEl) panel.skeletonEl.classList.add("hidden");
    if (panel.contentEl) panel.contentEl.classList.add("hidden");
    if (panel.errorEl) {
      panel.errorEl.classList.remove("hidden");
      panel.errorEl.innerHTML = "<p>" + escapeHtml(message) + "</p>";
    }
    addMessage("assistant", t("deep.chat.errorPrefix", "📊 Deep Analysis Failed: ") + escapeHtml(message));

    panel.el.querySelector(".deep-window-stop")?.classList.add("hidden");
    panel.el.querySelector(".deep-window-close")?.classList.remove("hidden");
    panel.el.querySelector(".deep-window-export")?.classList.remove("hidden");
    panel.el.classList.remove("generating");
  }

  function _cancelDeepPanel(id) {
    var panel = _deepPanels.find(function (p) { return p.id === id; });
    if (panel && panel.abortController) {
      panel.abortController.abort();
      panel.abortController = null;
    }
    _removeDeepPanel(id);
    var msg = t("deep.stopAborted", "Analysis cancelled.");
    addMessage("assistant", t("deep.chat.summaryPrefix", "📊 Deep Analysis: ") + msg);
  }

  // === 提交深度推理 ===

  async function submitDeepReasoning(prompt) {
    var panel = _createDeepPanel(prompt);
    panel.abortController = new AbortController();
    var signal = panel.abortController.signal;
    _showPanelSkeleton(panel, true);

    try {
      updateDeepSkeletonInPanel(panel, 2);
      var response = await fetch("/api/chat/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, mode: "deep", language: responseLanguageFor(prompt) }),
        signal
      });

      if (signal.aborted) return;
      if (!response.ok) {
        _showPanelError(panel, t("deep.error.http", "Request failed ({status}), please try again later.").replace("{status}", response.status));
        return;
      }

      var data = await response.json();
      if (signal.aborted) return;

      if (!data.ok || !data.report) {
        _showPanelError(panel, t("deep.error.return", "Analysis returned an error, please try again later."));
        return;
      }

      updateDeepSkeletonInPanel(panel, 3);
      _renderPanelReport(panel, data.report);
      addMessage("assistant", _deepPanelSummaryHtml(panel, data.report, prompt));
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("[deep] reasoning error:", error);
      _showPanelError(panel, t("deep.error.network", "Network request failed, please check your connection."));
    }
  }

  // === 聊天摘要 ===

  function _deepPanelSummaryHtml(panel, report, prompt) {
    var cardKey = ++_deepCardKeyCounter;
    panel._cardKey = cardKey;
    // 缓存报告数据，支持面板关闭后点击摘要重建
    _deepReportCache[cardKey] = { prompt: prompt, report: report };
    var escapedTitle = escapeHtml(report.title || t("deep.report.defaultTitle", "Analysis Report"));
    var escapedSummary = escapeHtml(report.summary || "");
    var promptPreview = escapeHtml(prompt.slice(0, 80) + (prompt.length > 80 ? "…" : ""));
    var prefix = t("deep.chat.summaryPrefix", "📊 Deep Analysis: ");
    return '<div class="deep-summary-card" onclick="(function(){ ' +
      'var evt = new CustomEvent(\'deep-expand-panel\', {detail: {key: ' + cardKey + '}}); ' +
      'document.dispatchEvent(evt); })()">' +
      '<h4>' + prefix + escapedTitle + '</h4>' +
      '<p>' + escapedSummary + '</p>' +
      '<small style="color:var(--muted);font-size:11px">' + promptPreview + '</small>' +
    '</div>';
  }

  // 数字列关键词——用于表格渲染时智能对齐
  var _NUMERIC_COL_PATTERNS = [
    /^epc$/i, /^avg\s*epc$/i, /^revenue$/i, /^sales$/i, /^orders$/i,
    /^aov$/i, /^commission$/i, /^rate$/i, /^amount$/i, /^count$/i,
    /^fee$/i, /^price$/i, /^profit$/i, /^cost$/i, /^total$/i,
    /^value$/i, /^budget$/i, /^spend$/i, /^roas$/i, /^cpa$/i,
    /^cvr$/i, /^cr$/i, /^rpm$/i, /^margin$/i, /^roi$/i,
    /^pct$/i, /^[0-9]/, /\$/, /%/, /€/, /£/,
    /^currency$/i, /^tax$/i, /^shipping$/i, /^refund$/i,
  ];

  function _isNumericCol(header) {
    return _NUMERIC_COL_PATTERNS.some(function (p) { return p.test(header); });
  }

  function _deepHeaderLabel(raw) {
    // 为 Deep Analysis 表头添加单位标签
    var unitMap = {
      "epc": " ($)",
      "aov": " ($)",
      "销售额": " ($)",
      "总销售额": " ($)",
      "联盟佣金": " ($)",
      "佣金": " ($)",
      "转化率": " (%)",
      "佣金率": " (%)",
      "订单": " (单)",
      "总订单": " (单)",
      "订单量": " (单)",
      "总订单数": " (单)",
      "总订单量": " (单)",
      "点击": "",
      "总点击": "",
      "点击数": "",
      "总点击量": "",
      "总点击数": "",
      "单价": " ($)",
      "客单价": " ($)",
      "dpv": " ($)",
      "DPV": " ($)",
      "atc": "",
      "ATC": "",
      "paymentCycle": " (天)",
      "支付周期": " (天)",
    };
    // 先尝试精确匹配
    if (unitMap[raw]) return raw + unitMap[raw];
    // 模糊匹配：包含关键词
    if (/转化率|佣金率|conv\.?\s*rate|conversion/i.test(raw)) return raw + " (%)";
    if (/销售额|sales|revenue|commission|epc|aov|dpv/i.test(raw) && !/率|rate|click|order/i.test(raw)) return raw + " ($)";
    if (/订单|order/i.test(raw) && !/率|rate/i.test(raw)) return raw + " (单)";
    if (/周期|cycle|payment/i.test(raw)) return raw + " (天)";
    return raw;
  }
  // renderDeepReport 和 deepSummaryHtml 已移至 _renderPanelReport 和 _deepPanelSummaryHtml

  async function applyPrompt(prompt) {
    // ★ Deep reasoning mode routing
    if (state.deepMode) {
      addMessage("user", escapeHtml(prompt));
      await submitDeepReasoning(prompt);
      return;
    }

    const language = responseLanguageFor(prompt);
    // Skip the LLM classification call when regex alone can confidently
    // determine intent + extract parameters (ASIN, merchant ID, tier,
    // category, payment status, metric filters, attribute filters, etc.).
    // The analysis narrative text (/api/chat/analyze) is a separate
    // async call inside analysisAnswer() and is NOT affected by this.
    if (state.llmEnabled !== false && !canSkipLLMClassify(prompt)) {
      const loadingText = language === "zh" ? "正在理解你的问题…" : "Understanding your question…";
      const loadingMsg = document.createElement("div");
      loadingMsg.className = "message assistant loading-indicator";
      loadingMsg.textContent = loadingText;
      els.chatLog.appendChild(loadingMsg);
      els.chatLog.scrollTop = els.chatLog.scrollHeight;
      const result = await classifyWithLLM(prompt, collectCategories());
      loadingMsg.remove();
      state.llmClassifyResult = result;
    } else {
      state.llmClassifyResult = null;
      if (state.llmEnabled !== false) {
        console.log("[LLM] skipped — regex classification is sufficient for: " + prompt.slice(0, 60));
      }
    }
    const dbMerchantOffer = dbMerchantOfferForPrompt(prompt);
    addMessage("user", escapeHtml(prompt));
    try {
      addMessage("assistant", answerPrompt(prompt));
    } catch (error) {
      console.error("[analysis] answerPrompt error:", error);
      addMessage("assistant", (language === "zh"
        ? "抱歉，分析过程出错。请稍后重试。"
        : "Sorry, an error occurred. Please try again.") + " (" + escapeHtml(error.message || "unknown") + ")");
    }
    if (dbMerchantOffer) loadDbMerchantInsight(dbMerchantOffer);
    else loadDbSearchInsight(prompt);
  }

  function renderMetrics(rows) {
    const s = aggregateRows(rows);
    const cards = [
      ["Offers", rows.length.toLocaleString()],
      ["Revenue", shortMoney(s.totalRevenue)],
      ["Commission EPC", shortEpc(s.blendedEpc)],
      ["AOV", shortMoney(s.avgAov)],
      ["CVR", shortPct(s.avgCvr)],
      ["Unpaid risk", s.paymentRiskCount.toLocaleString()]
    ];
    els.metrics.innerHTML = cards.map(([label, value]) => `<div class="metric"><span>${escapeHtml(labelText(label))}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  }

  function dashboardOfferPreviewLimit() {
    return state.category === "all" ? 5 : 80;
  }

  function dashboardCategoryHeaderRow(group, previewCount) {
    const summary = group.summary;
    const remaining = Math.max(0, group.rows.length - previewCount);
    const remainingText = remaining ? ` · ${remaining.toLocaleString()} more` : "";
    return `<tr class="category-group-row">
      <td colspan="9">
        <div class="category-group-summary">
          <div>
            <strong>${escapeHtml(group.category)}</strong>
            <span>${group.rows.length.toLocaleString()} offers${escapeHtml(remainingText)}</span>
          </div>
          <dl>
            <div><dt>CVR</dt><dd>${shortPct(summary.avgCvr)}</dd></div>
            <div><dt>AOV</dt><dd>${shortMoney(summary.avgAov)}</dd></div>
            <div><dt>Revenue</dt><dd>${shortMoney(summary.totalRevenue)}</dd></div>
            <div><dt>Orders</dt><dd>${number(summary.totalOrders).toLocaleString()}</dd></div>
          </dl>
        </div>
      </td>
    </tr>`;
  }

  function dashboardOfferRow(offer) {
    const paidClass = hasPaymentRisk(offer) ? "unpaid" : hasPaidSignal(offer) ? "paid" : "neutral";
    const movedNote = offer.tierOverride ? `<p class="tier-override-note">${escapeHtml(t("move.movedFrom", "Moved from"))} ${escapeHtml(optionText(offer.originalTier || "Unknown"))}</p>` : "";
    return `<tr>
        <td><strong>${escapeHtml(offer.brand || "")}</strong><p>${escapeHtml(offer.merchantId || "")}</p><p>${escapeHtml(displayCategory(offer))}</p></td>
        <td><span class="badge tier">${escapeHtml(tierGroup(offer))}</span>${movedNote}</td>
        <td>${escapeHtml(offer.network || "")}</td>
        <td>${escapeHtml(displayCategory(offer))}</td>
        <td>${shortEpc(offer.epc)}</td>
        <td>${shortMoney(offer.aov)}</td>
        <td>${shortPct(offer.conversionRate)}</td>
        <td>${number(offer.orders).toLocaleString()}</td>
        <td><span class="badge ${paidClass}">${escapeHtml(offer.paymentStatus || "not available")}</span></td>
      </tr>`;
  }

  function renderTable(rows) {
    if (!els.table || !els.tableCount) return;
    const groups = dashboardCategoryGroups(rows);
    const previewLimit = dashboardOfferPreviewLimit();
    els.tableCount.textContent = `${rows.length.toLocaleString()} ${t("table.offerCount", "matching offers")} across ${groups.length.toLocaleString()} main categories`;
    els.table.innerHTML = groups.map((group) => {
      const previewRows = group.rows.slice(0, previewLimit);
      return dashboardCategoryHeaderRow(group, previewRows.length) +
        previewRows.map(dashboardOfferRow).join("");
    }).join("");
  }

  function categoryReportTierLabel(tier) {
    return tier === "BLACK TIER" ? "Black Tier" : tier;
  }

  function shortCategoryReportTierLabel(tier) {
    if (tier === "BLACK TIER") return "Black";
    return String(tier || "").replace("Tier ", "T");
  }

  function normalizeCategoryReportTiers(tiers) {
    const selected = new Set(tiers || []);
    return CATEGORY_REPORT_TIER_OPTIONS.filter((tier) => selected.has(tier));
  }

  function selectedCategoryReportTierSet() {
    return new Set(normalizeCategoryReportTiers(state.categoryReportTiers));
  }

  function renderDashboardCategoryTierPicker() {
    if (!els.dashboardCategoryTierPicker) return;
    const options = [
      { value: "all", label: "All Tier 1-4" },
      ...CATEGORY_REPORT_TIER_OPTIONS.map((tier) => ({ value: tier, label: categoryReportTierLabel(tier) }))
    ];
    els.dashboardCategoryTierPicker.innerHTML = options.map((option) => `<label class="checkbox-row dashboard-category-tier-option">
      <input type="checkbox" data-category-report-tier="${escapeHtml(option.value)}" />
      <span>${escapeHtml(option.label)}</span>
    </label>`).join("");
    syncDashboardCategoryTierControls();
  }

  function syncDashboardCategoryTierControls() {
    if (!els.dashboardCategoryTierPicker) return;
    const selected = selectedCategoryReportTierSet();
    const allStandardSelected = STANDARD_CATEGORY_REPORT_TIERS.every((tier) => selected.has(tier));
    const someStandardSelected = STANDARD_CATEGORY_REPORT_TIERS.some((tier) => selected.has(tier));
    els.dashboardCategoryTierPicker.querySelectorAll("[data-category-report-tier]").forEach((input) => {
      const tier = input.dataset.categoryReportTier;
      if (tier === "all") {
        input.checked = allStandardSelected;
        input.indeterminate = someStandardSelected && !allStandardSelected;
        return;
      }
      input.checked = selected.has(tier);
      input.indeterminate = false;
    });
  }

  function setDashboardCategoryReportAll(checked) {
    const selected = selectedCategoryReportTierSet();
    STANDARD_CATEGORY_REPORT_TIERS.forEach((tier) => {
      if (checked) selected.add(tier);
      else selected.delete(tier);
    });
    if (checked) selected.delete("BLACK TIER");
    state.categoryReportTiers = normalizeCategoryReportTiers(Array.from(selected));
  }

  function handleDashboardCategoryTierChange(event) {
    const input = event.target.closest("[data-category-report-tier]");
    if (!input) return;
    const tier = input.dataset.categoryReportTier;
    if (tier === "all") {
      setDashboardCategoryReportAll(input.checked);
    } else {
      const selected = selectedCategoryReportTierSet();
      if (input.checked) selected.add(tier);
      else selected.delete(tier);
      state.categoryReportTiers = normalizeCategoryReportTiers(Array.from(selected));
    }
    syncDashboardCategoryTierControls();
    state.categoryReportFocusKey = "";
    state.expandedCategoryKey = null;
    renderDashboardCategoryReport();
  }

  function dashboardCategoryReportRows() {
    return normalizeCategoryReportTiers(state.categoryReportTiers).flatMap((tierName) => {
      const sheet = sheetByName(tierName);
      return sheet && Array.isArray(sheet.rows)
        ? sheet.rows.map((row) => ({ ...row, __tierName: tierName }))
        : [];
    });
  }

  function tierBreakdownText(group) {
    return tierBreakdownEntries(group)
      .map(([tier, count]) => `${shortCategoryReportTierLabel(tier)} ${count.toLocaleString()}`)
      .join(" / ") || "-";
  }

  function tierBreakdownEntries(group) {
    const breakdown = group.tierBreakdown || {};
    return CATEGORY_REPORT_TIER_OPTIONS
      .map((tier) => [tier, number(breakdown[tier])])
      .filter(([, count]) => count > 0);
  }

  function tierMixColor(tier) {
    if (tier === "Tier 1") return "#2f80ff";
    if (tier === "Tier 2") return "#17b978";
    if (tier === "Tier 3") return "#f59e0b";
    if (tier === "Tier 4") return "#ff6b4a";
    return "#6b7280";
  }

  function dashboardCategorySortLabel(key) {
    const labels = {
      merchantCount: "Merchants",
      revenue: "Revenue",
      orders: "Orders",
      clicks: "Clicks",
      avgCvr: "CVR",
      avgEpc: "EPC",
      avgAov: "AOV",
      category: "Category"
    };
    return labels[key] || "Revenue";
  }

  function categoryPalette(category) {
    const text = String(category || "").toLowerCase();
    const palettes = [
      [/baby|kid|nursery|stroller|children|toddler/, "#ff5aa5", "#fff0f7"],
      [/electronic|cell phone|camera|audio|video games|computer|software/, "#2563eb", "#edf4ff"],
      [/beauty|personal care|skin|hair|makeup/, "#a855f7", "#f6edff"],
      [/home\s*(?:&|and)?\s*kitchen/, "#00a676", "#eafff7"],
      [/kitchen\s*(?:&|and)?\s*dining|dining|cookware|food/, "#f59e0b", "#fff7e6"],
      [/home|furniture|bedding|mattress/, "#00a676", "#eafff7"],
      [/health|household|wellness|medical|vitamin/, "#06b6d4", "#e9fbff"],
      [/clothing|shoes|jewelry|fashion|apparel/, "#ff6b35", "#fff0ea"],
      [/patio|lawn|garden|outdoor|sports|camping/, "#84cc16", "#f3ffe7"],
      [/pet|dog|cat/, "#facc15", "#fff9d8"],
      [/automotive|motorcycle|car/, "#ef4444", "#fff0f0"],
      [/tool|improvement|industrial/, "#f97316", "#fff2e8"],
      [/toy|game|craft|sewing|handmade/, "#ec4899", "#fff0f7"],
      [/grocery|gourmet/, "#14b8a6", "#ecfffb"],
      [/office|book|music|instrument/, "#6366f1", "#f0f1ff"]
    ];
    const match = palettes.find(([pattern]) => pattern.test(text));
    if (match) return { color: match[1], tint: match[2] };
    return { color: "#64748b", tint: "#f1f5f9" };
  }

  function categoryReportKey(category) {
    return safeFilePart(category || "uncategorized", "uncategorized");
  }

  function categoryReportMetricText(metricKey, value) {
    if (metricKey === "revenue" || metricKey === "avgAov") return shortMoney(value);
    if (metricKey === "avgCvr") return shortPct(value);
    if (metricKey === "avgEpc") return shortEpc(value);
    return number(value).toLocaleString();
  }

  function categoryReportTooltipText(group, metricKey, metricValue, total) {
    const share = total ? shortPct(metricValue / total) : "-";
    return [
      `${group.category}: ${categoryReportMetricText(metricKey, metricValue)} (${share})`,
      `${number(group.merchantCount).toLocaleString()} merchants`,
      `${number(group.orders).toLocaleString()} orders`,
      `Top: ${group.previewMerchants || group.topMerchant || "-"}`
    ].join(" | ");
  }

  function categoryTierMixHtml(group, variant = "") {
    const entries = tierBreakdownEntries(group);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    if (!entries.length || !total) return `<span class="category-tier-mix-empty">-</span>`;
    const className = variant ? ` category-tier-mix-${variant}` : "";
    return `<div class="category-tier-mix${className}" aria-label="${escapeHtml(tierBreakdownText(group))}">
      <div class="category-tier-mix-bar" aria-hidden="true">
        ${entries.map(([tier, count]) => `<span style="width: ${(count / total * 100).toFixed(2)}%; --tier-color: ${tierMixColor(tier)};"></span>`).join("")}
      </div>
      <div class="category-tier-mix-labels">
        ${entries.map(([tier, count]) => `<span style="--tier-color: ${tierMixColor(tier)};"><i aria-hidden="true"></i>${escapeHtml(shortCategoryReportTierLabel(tier))} ${count.toLocaleString()}</span>`).join("")}
      </div>
    </div>`;
  }

  function dashboardCategoryDefaultSortDirection(key) {
    return key === "category" ? "asc" : "desc";
  }

  function dashboardCategorySortableHeader(key, label) {
    const active = state.categoryReportSort === key;
    const direction = active ? state.categoryReportDirection : dashboardCategoryDefaultSortDirection(key);
    const indicator = active ? (direction === "asc" ? "↑" : "↓") : "↕";
    return `<th><button class="table-sort-button${active ? " active" : ""}" type="button" data-dashboard-category-sort-key="${escapeHtml(key)}" aria-label="Sort category report by ${escapeHtml(label)}">
      <span>${escapeHtml(label)}</span>
      <span class="sort-indicator" aria-hidden="true">${escapeHtml(indicator)}</span>
    </button></th>`;
  }

  function focusDashboardCategoryReport(key) {
    const nextKey = String(key || "");
    if (!nextKey || nextKey === state.categoryReportFocusKey) return;
    state.categoryReportFocusKey = nextKey;
    state.expandedCategoryKey = null;
    renderDashboardCategoryReport();
    const focusBackButton = () => els.dashboardCategoryReportBody?.querySelector("[data-category-focus-back]")?.focus({ preventScroll: true });
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(focusBackButton);
    else focusBackButton();
  }

  function clearDashboardCategoryReportFocus() {
    const previousKey = state.categoryReportFocusKey;
    if (!previousKey) return;
    state.categoryReportFocusKey = "";
    state.expandedCategoryKey = null;
    renderDashboardCategoryReport();
    const restoreCategoryFocus = () => {
      const target = Array.from(els.dashboardCategoryReportBody?.querySelectorAll("[data-category-focus]") || [])
        .find((item) => item.dataset.categoryFocus === previousKey);
      target?.focus({ preventScroll: true });
    };
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(restoreCategoryFocus);
    else restoreCategoryFocus();
  }

  function handleDashboardCategoryReportClick(event) {
    const backButton = event.target.closest("[data-category-focus-back]");
    if (backButton && els.dashboardCategoryReportBody.contains(backButton)) {
      clearDashboardCategoryReportFocus();
      return;
    }
    const focusTarget = event.target.closest("[data-category-focus]");
    if (focusTarget && els.dashboardCategoryReportBody.contains(focusTarget)) {
      focusDashboardCategoryReport(focusTarget.dataset.categoryFocus || "");
      return;
    }
    const exportButton = event.target.closest("[data-category-export]");
    if (exportButton && els.dashboardCategoryReportBody.contains(exportButton)) {
      downloadFocusedCategoryRows(exportButton);
      return;
    }
    const categoryRow = event.target.closest(".dashboard-category-row");
    if (categoryRow) {
      const key = categoryRow.dataset.categoryHighlight || "";
      state.expandedCategoryKey = state.expandedCategoryKey === key ? null : key;
      renderDashboardCategoryReport();
      return;
    }
    const button = event.target.closest("[data-dashboard-category-sort-key]");
    if (!button) return;
    const key = button.dataset.dashboardCategorySortKey || "revenue";
    if (state.categoryReportSort === key) {
      state.categoryReportDirection = state.categoryReportDirection === "asc" ? "desc" : "asc";
    } else {
      state.categoryReportSort = key;
      state.categoryReportDirection = dashboardCategoryDefaultSortDirection(key);
    }
    renderDashboardCategoryReport();
  }

  function handleDashboardCategoryReportKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const focusTarget = event.target.closest("[data-category-focus]");
    if (!focusTarget || !els.dashboardCategoryReportBody.contains(focusTarget)) return;
    event.preventDefault();
    focusDashboardCategoryReport(focusTarget.dataset.categoryFocus || "");
  }

  function dashboardCategorySortValue(group, key) {
    if (key === "category") return String(group.category || "");
    if (key === "merchantCount") return number(group.merchantCount);
    if (key === "revenue") return number(group.revenue);
    if (key === "orders") return number(group.orders);
    if (key === "clicks") return number(group.clicks);
    if (key === "avgCvr") return number(group.avgCvr);
    if (key === "avgEpc") return number(group.avgEpc);
    if (key === "avgAov") return number(group.avgAov);
    return number(group.revenue);
  }

  function compareDashboardCategoryReportGroups(a, b) {
    const key = state.categoryReportSort || "revenue";
    const direction = state.categoryReportDirection === "asc" ? 1 : -1;
    const left = dashboardCategorySortValue(a, key);
    const right = dashboardCategorySortValue(b, key);
    if (key === "category") {
      const result = String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
      return result * (state.categoryReportDirection === "desc" ? -1 : 1);
    }
    const result = number(left) - number(right);
    if (result) return result * direction;
    if (a.category === "Uncategorized" && b.category !== "Uncategorized") return 1;
    if (b.category === "Uncategorized" && a.category !== "Uncategorized") return -1;
    return String(a.category || "").localeCompare(String(b.category || ""), undefined, { numeric: true, sensitivity: "base" });
  }

  function filterDashboardCategoryReportGroups(groups) {
    const search = normalize(state.categoryReportSearch);
    const filtered = search
      ? groups.filter((group) => {
        const category = normalize(group.category);
        const merchants = normalize(`${group.previewMerchants || ""} ${group.topMerchant || ""} ${(group.rows || []).slice(0, 24).map((row) => `${tierRowMerchantName(row)} ${tierRowMerchantId(row)}`).join(" ")}`);
        return category.includes(search) || merchants.includes(search);
      })
      : groups.slice();
    return filtered.sort(compareDashboardCategoryReportGroups);
  }

  function dashboardCategoryFocusedGroups(groups, focusKey = state.categoryReportFocusKey) {
    const key = String(focusKey || "");
    if (!key) return groups;
    if (key === "other-categories") {
      const metricKey = dashboardCategoryPieMetricKey();
      const overflowKeys = new Set(groups
        .filter((group) => number(dashboardCategorySortValue(group, metricKey)) > 0)
        .slice(7)
        .map((group) => categoryReportKey(group.category)));
      return groups.filter((group) => overflowKeys.has(categoryReportKey(group.category)));
    }
    return groups.filter((group) => categoryReportKey(group.category) === key);
  }

  function dashboardCategoryReportTableRows(groups) {
    const maxRevenue = Math.max(...groups.map((group) => number(group.revenue)), 0);
    const metricKey = dashboardCategoryPieMetricKey();
    const metricTotal = groups.reduce((sum, group) => sum + number(dashboardCategorySortValue(group, metricKey)), 0);
    return groups.map((group) => {
      const revenuePct = maxRevenue ? Math.max(4, Math.round((number(group.revenue) / maxRevenue) * 100)) : 0;
      const palette = categoryPalette(group.category);
      const categoryKey = categoryReportKey(group.category);
      const metricValue = number(dashboardCategorySortValue(group, metricKey));
      const isExpanded = state.expandedCategoryKey === categoryKey;
      const summaryRow = `<tr class="dashboard-category-row${isExpanded ? " category-expanded" : ""}" data-category-highlight="${escapeHtml(categoryKey)}"
        data-category-color="${escapeHtml(palette.color)}" data-category-tint="${escapeHtml(palette.tint)}"
        data-category-title="${escapeHtml(group.category)}" data-category-value="${escapeHtml(categoryReportMetricText(metricKey, metricValue))}"
        data-category-share="${escapeHtml(metricTotal ? shortPct(metricValue / metricTotal) : "-")}"
        data-category-merchants="${escapeHtml(number(group.merchantCount).toLocaleString())}"
        data-category-orders="${escapeHtml(number(group.orders).toLocaleString())}"
        data-category-top="${escapeHtml(group.previewMerchants || group.topMerchant || "-")}" tabindex="0">
      <td>
        <span class="category-expand-chevron" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M4 2L8 6L4 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <strong class="category-name-chip" style="--category-color: ${palette.color}; --category-tint: ${palette.tint};">
          <span class="category-dot" aria-hidden="true"></span>
          ${escapeHtml(group.category)}
        </strong>
        <span class="category-rank-bar" aria-hidden="true"><span style="width: ${revenuePct}%; --category-color: ${palette.color};"></span></span>
      </td>
      <td>${number(group.merchantCount).toLocaleString()}</td>
      <td>${shortMoney(group.revenue)}</td>
      <td>${number(group.orders).toLocaleString()}</td>
      <td>${number(group.clicks).toLocaleString()}</td>
      <td>${shortPct(group.avgCvr)}</td>
      <td>${shortEpc(group.avgEpc)}</td>
      <td>${shortMoney(group.avgAov)}</td>
      <td>${escapeHtml(group.previewMerchants || group.topMerchant || "-")}</td>
      <td>${categoryTierMixHtml(group)}</td>
    </tr>`;
      if (!isExpanded) return summaryRow;
      const merchantRows = (group.rows || []).map((row) => {
        const merchantName = tierRowMerchantName(row);
        const merchantId = tierRowMerchantId(row);
        const tier = row.__tierName || "";
        const revenue = tierRowRevenue(row);
        const orders = tierRowOrders(row);
        const clicks = tierRowClicks(row);
        const epc = tierRowEpc(row);
        const cvr = clicks ? orders / clicks : null;
        const aov = orders ? revenue / orders : null;
        return `<tr class="category-detail-merchant-row">
          <td><span class="category-detail-merchant-indent"></span><strong>${escapeHtml(merchantName || "-")}</strong><br><small>${escapeHtml(merchantId || "-")}</small></td>
          <td>${escapeHtml(tier)}</td>
          <td>${shortMoney(revenue)}</td>
          <td>${number(orders).toLocaleString()}</td>
          <td>${number(clicks).toLocaleString()}</td>
          <td>${shortEpc(epc)}</td>
          <td>${shortPct(cvr)}</td>
          <td>${shortMoney(aov)}</td>
          <td></td>
          <td></td>
        </tr>`;
      }).join("");
      return summaryRow + `<tr class="category-expanded-detail">
        <td colspan="10">
          <div class="category-detail-scroll">
            <table class="category-detail-inner-table">
              <thead>
                <tr>
                  <th>Merchant / ID</th>
                  <th>Tier</th>
                  <th>Revenue</th>
                  <th>Orders</th>
                  <th>Clicks</th>
                  <th>EPC</th>
                  <th>CVR</th>
                  <th>AOV</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${merchantRows}</tbody>
            </table>
          </div>
        </td>
      </tr>`;
    }).join("");
  }

  function dashboardCategoryPieMetricKey() {
    const key = state.categoryReportSort || "revenue";
    return CATEGORY_REPORT_ADDITIVE_SORTS.has(key) ? key : "revenue";
  }

  function isDashboardCategoryGlobalOverview() {
    const selected = selectedCategoryReportTierSet();
    return selected.size === STANDARD_CATEGORY_REPORT_TIERS.length &&
      STANDARD_CATEGORY_REPORT_TIERS.every((tier) => selected.has(tier));
  }

  function dashboardCategoryPieSelectionText() {
    const selected = normalizeCategoryReportTiers(state.categoryReportTiers).map(categoryReportTierLabel);
    return selected.length ? selected.join(", ") : "No tiers selected";
  }

  function dashboardCategoryPieHtml(groups) {
    const metricKey = dashboardCategoryPieMetricKey();
    const metricLabel = dashboardCategorySortLabel(metricKey);
    const slices = groups
      .map((group) => {
        const palette = categoryPalette(group.category);
        return {
          group,
          key: categoryReportKey(group.category),
          color: palette.color,
          tint: palette.tint,
          label: group.category,
          value: number(dashboardCategorySortValue(group, metricKey))
        };
      })
      .filter((slice) => slice.value > 0);
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    if (!total) {
      return `<section class="dashboard-category-pie" aria-label="Category pie chart">
        <div class="category-pie-empty">No ${escapeHtml(metricLabel.toLowerCase())} data for the selected tiers.</div>
      </section>`;
    }

    const isFocused = Boolean(state.categoryReportFocusKey);
    const shouldGroupOverflow = isDashboardCategoryGlobalOverview() && !isFocused;
    const visibleSlices = shouldGroupOverflow ? slices.slice(0, 7) : slices.slice();
    const overflowSlices = shouldGroupOverflow ? slices.slice(7) : [];
    const otherValue = overflowSlices.reduce((sum, slice) => sum + slice.value, 0);
    if (otherValue > 0) {
      visibleSlices.push({
        group: {
          category: "Other selected categories",
          rows: overflowSlices.flatMap((slice) => slice.group.rows || []),
          merchantCount: overflowSlices.reduce((sum, slice) => sum + number(slice.group.merchantCount), 0),
          orders: overflowSlices.reduce((sum, slice) => sum + number(slice.group.orders), 0),
          previewMerchants: overflowSlices.slice(0, 3).map((slice) => slice.group.topMerchant).filter(Boolean).join(", ")
        },
        key: "other-categories",
        color: "#64748b",
        tint: "#f1f5f9",
        label: "Other selected categories",
        value: otherValue
      });
    }
    let current = 0;
    const sliceMarkup = visibleSlices.map((slice) => {
      const pct = slice.value / total;
      const dash = pct * 100;
      const dashOffset = -current;
      current += dash;
      const tooltip = categoryReportTooltipText(slice.group, metricKey, slice.value, total);
      return `<circle class="category-pie-slice" cx="50" cy="50" r="40" pathLength="100"
        stroke="${slice.color}" stroke-dasharray="${dash.toFixed(4)} ${(100 - dash).toFixed(4)}"
        stroke-dashoffset="${dashOffset.toFixed(4)}" data-category-highlight="${escapeHtml(slice.key)}" data-category-focus="${escapeHtml(slice.key)}"
        data-category-color="${escapeHtml(slice.color)}" data-category-tint="${escapeHtml(slice.tint)}"
        data-category-title="${escapeHtml(slice.label)}" data-category-value="${escapeHtml(categoryReportMetricText(metricKey, slice.value))}"
        data-category-share="${escapeHtml(shortPct(pct))}" data-category-merchants="${escapeHtml(number(slice.group.merchantCount).toLocaleString())}"
        data-category-orders="${escapeHtml(number(slice.group.orders).toLocaleString())}" data-category-top="${escapeHtml(slice.group.previewMerchants || slice.group.topMerchant || "-")}"
        data-category-tooltip="${escapeHtml(tooltip)}" tabindex="0" role="button" aria-label="${escapeHtml(`Show only ${slice.label}. ${tooltip}`)}">
        <title>${escapeHtml(tooltip)}</title>
      </circle>`;
    }).join("");
    const leader = visibleSlices[0];
    const selectionText = dashboardCategoryPieSelectionText();
    const segmentText = isFocused
      ? `${visibleSlices.length === 1 ? visibleSlices[0].label : `${visibleSlices.length.toLocaleString()} grouped categories`} from ${selectionText}.`
      : shouldGroupOverflow && otherValue > 0
        ? `${visibleSlices.length} visible segments from ${groups.length.toLocaleString()} ${selectionText} categories.`
        : `${visibleSlices.length.toLocaleString()} categories from ${selectionText}.`;
    const backButton = isFocused ? `<button class="category-focus-back" type="button" data-category-focus-back aria-label="Back to all categories">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.75 3.25 5 8l4.75 4.75M5.5 8h6"></path></svg>
      <span>All categories</span>
    </button>` : "";
    return `<section class="dashboard-category-pie${isFocused ? " category-pie-focused" : ""}" aria-label="Category pie chart">
      ${backButton}
      <div class="category-pie-visual" style="--leader-color: ${leader.color};">
        <svg class="category-pie-svg" viewBox="0 0 100 100" role="img" aria-label="${escapeHtml(metricLabel)} mix by category">
          <circle class="category-pie-track" cx="50" cy="50" r="40"></circle>
          <g transform="rotate(-90 50 50)">${sliceMarkup}</g>
        </svg>
        <div class="category-pie-spotlight" data-category-pie-spotlight>
          <strong>${escapeHtml(metricLabel)}</strong>
          <span>${escapeHtml(metricKey === "revenue" ? shortMoney(total) : total.toLocaleString())}</span>
          <small>${escapeHtml(`${leader.label} leads at ${shortPct(leader.value / total)}`)}</small>
        </div>
        <div class="category-pie-tooltip" data-category-pie-tooltip hidden></div>
      </div>
      <div class="category-pie-copy">
        <h4>${escapeHtml(metricLabel)} mix by category</h4>
        <p>${escapeHtml(segmentText)}</p>
        <ul class="category-pie-legend" aria-label="${escapeHtml(metricLabel)} category legend">
          ${visibleSlices.map((slice) => {
            const pct = total ? slice.value / total : 0;
            const value = categoryReportMetricText(metricKey, slice.value);
            return `<li data-category-highlight="${escapeHtml(slice.key)}" data-category-focus="${escapeHtml(slice.key)}" tabindex="0" role="button" aria-label="${escapeHtml(`Show only ${slice.label}`)}" style="--category-color: ${slice.color}; --category-tint: ${slice.tint};"
              data-category-color="${escapeHtml(slice.color)}" data-category-tint="${escapeHtml(slice.tint)}"
              data-category-title="${escapeHtml(slice.label)}" data-category-value="${escapeHtml(value)}"
              data-category-share="${escapeHtml(shortPct(pct))}" data-category-merchants="${escapeHtml(number(slice.group.merchantCount).toLocaleString())}"
              data-category-orders="${escapeHtml(number(slice.group.orders).toLocaleString())}" data-category-top="${escapeHtml(slice.group.previewMerchants || slice.group.topMerchant || "-")}"
              data-category-tooltip="${escapeHtml(categoryReportTooltipText(slice.group, metricKey, slice.value, total))}">
              <span class="category-pie-swatch" aria-hidden="true"></span>
              <strong>${escapeHtml(slice.label)}</strong>
              <span>${escapeHtml(value)} / ${shortPct(pct)}</span>
            </li>`;
          }).join("")}
        </ul>
        <div class="category-pie-actions" style="--category-color: ${leader.color}; --category-tint: ${leader.tint};">
          <button class="category-focus-export" type="button" data-category-export="${escapeHtml(leader.key)}" data-category-export-label="${escapeHtml(leader.label)}">Export focused category</button>
          <span data-category-export-note>${escapeHtml(`${leader.label}: ${(leader.group.rows || []).length.toLocaleString()} rows in selected tiers`)}</span>
        </div>
      </div>
    </section>`;
  }

  function dashboardCategoryOptimizationPreviewsHtml(groups) {
    if (!groups.length) return "";
    const metricKey = dashboardCategoryPieMetricKey();
    const metricKeys = ["revenue", "orders", "clicks", "merchantCount"];
    const leader = groups[0];
    const leaderPalette = categoryPalette(leader.category);
    const maxMetric = Math.max(...groups.slice(0, 4).map((group) => number(dashboardCategorySortValue(group, metricKey))), 1);
    const bars = groups.slice(0, 4).map((group) => {
      const palette = categoryPalette(group.category);
      const value = number(dashboardCategorySortValue(group, metricKey));
      return `<li style="--category-color: ${palette.color}; --category-tint: ${palette.tint};">
        <span>${escapeHtml(group.category)}</span>
        <strong>${escapeHtml(categoryReportMetricText(metricKey, value))}</strong>
        <i aria-hidden="true"><b style="width: ${Math.max(5, value / maxMetric * 100).toFixed(1)}%;"></b></i>
      </li>`;
    }).join("");
    const merchantRows = (leader.rows || []).slice(0, 4).map((row) => `<li>
      <span>${escapeHtml(tierRowMerchantName(row) || "-")}</span>
      <strong>${escapeHtml(shortMoney(tierRowRevenue(row)))}</strong>
    </li>`).join("");
    return `<section class="category-optimization-previews" aria-label="Category optimization visual examples">
      <article class="category-idea-card category-idea-card-metrics">
        <div class="category-idea-heading">
          <span>01 Metric lens</span>
          <strong>Switch the chart focus</strong>
        </div>
        <div class="category-metric-pills" aria-label="Metric preview controls">
          ${metricKeys.map((key) => `<button class="${key === metricKey ? "active" : ""}" type="button" data-dashboard-category-sort-key="${escapeHtml(key)}">${escapeHtml(dashboardCategorySortLabel(key))}</button>`).join("")}
        </div>
        <ul class="category-preview-bars">${bars}</ul>
      </article>
      <article class="category-idea-card category-idea-card-drawer" style="--category-color: ${leaderPalette.color}; --category-tint: ${leaderPalette.tint};">
        <div class="category-idea-heading">
          <span>02 Drill-down drawer</span>
          <strong>${escapeHtml(leader.category)}</strong>
        </div>
        <div class="category-drawer-preview">
          <dl>
            <div><dt>Revenue</dt><dd>${escapeHtml(shortMoney(leader.revenue))}</dd></div>
            <div><dt>CVR</dt><dd>${escapeHtml(shortPct(leader.avgCvr))}</dd></div>
            <div><dt>Orders</dt><dd>${number(leader.orders).toLocaleString()}</dd></div>
          </dl>
          <ul>${merchantRows || `<li><span>No merchants</span><strong>-</strong></li>`}</ul>
        </div>
      </article>
      <article class="category-idea-card category-idea-card-tier">
        <div class="category-idea-heading">
          <span>03 Tier mix bar</span>
          <strong>Readable distribution</strong>
        </div>
        ${categoryTierMixHtml(leader, "large")}
        <p>${escapeHtml(`${leader.category} has ${number(leader.rowCount || (leader.rows || []).length).toLocaleString()} sheet rows across the selected tiers.`)}</p>
      </article>
    </section>`;
  }

  function currentDashboardCategoryReportGroups() {
    return filterDashboardCategoryReportGroups(tierCategorySummaryRows(null, dashboardCategoryReportRows()));
  }

  function dashboardCategoryGroupForExport(key) {
    const groups = currentDashboardCategoryReportGroups();
    if (key === "other-categories") {
      const metricKey = dashboardCategoryPieMetricKey();
      const slices = groups
        .map((group) => ({
          group,
          key: categoryReportKey(group.category),
          value: number(dashboardCategorySortValue(group, metricKey))
        }))
        .filter((slice) => slice.value > 0);
      const rows = slices.slice(7).flatMap((slice) => slice.group.rows || []);
      return { label: "Other categories", rows };
    }
    const group = groups.find((item) => categoryReportKey(item.category) === key);
    return group ? { label: group.category, rows: group.rows || [] } : { label: "", rows: [] };
  }

  function updateCategoryExportAction(target) {
    const body = els.dashboardCategoryReportBody;
    if (!body || !target) return;
    const button = body.querySelector("[data-category-export]");
    const note = body.querySelector("[data-category-export-note]");
    if (!button) return;
    const key = target.dataset.categoryHighlight || "";
    const title = target.dataset.categoryTitle || "";
    button.dataset.categoryExport = key;
    button.dataset.categoryExportLabel = title;
    button.closest(".category-pie-actions")?.style.setProperty("--category-color", target.dataset.categoryColor || "#2f80ff");
    if (note) note.textContent = `${title}: ${target.dataset.categoryMerchants || "0"} merchants / ${target.dataset.categoryOrders || "0"} orders`;
  }

  function downloadFocusedCategoryRows(button) {
    const key = button.dataset.categoryExport || "";
    const result = dashboardCategoryGroupForExport(key);
    if (!result.rows.length) return;
    downloadRowsAsXlsx(result.rows, {
      downloadType: "sheet",
      filePrefix: "category_focus",
      exportScope: result.label,
      sheetName: `${result.label}`.slice(0, 31),
      downloadColumns: objectExportColumns(result.rows)
    });
  }

  function animateDashboardCategoryRefresh() {
    if (!els.dashboardCategoryReportBody) return;
    els.dashboardCategoryReportBody.classList.remove("category-report-refreshing");
    void els.dashboardCategoryReportBody.offsetWidth;
    els.dashboardCategoryReportBody.classList.add("category-report-refreshing");
  }

  function updateCategoryPieSpotlight(target) {
    const body = els.dashboardCategoryReportBody;
    if (!body || !target) return;
    const spotlight = body.querySelector("[data-category-pie-spotlight]");
    if (!spotlight) return;
    const color = target.dataset.categoryColor || "#2f80ff";
    spotlight.style.setProperty("--leader-color", color);
    spotlight.innerHTML = `<strong>${escapeHtml(target.dataset.categoryTitle || "")}</strong>
      <span>${escapeHtml(target.dataset.categoryValue || "")}</span>
      <small>${escapeHtml(`${target.dataset.categoryShare || "-"} / ${target.dataset.categoryMerchants || "0"} merchants`)}</small>`;
  }

  function setCategoryHighlight(target, event) {
    const body = els.dashboardCategoryReportBody;
    if (!body || !target) return;
    const key = target.dataset.categoryHighlight || "";
    body.querySelectorAll("[data-category-highlight]").forEach((item) => {
      item.classList.toggle("category-active", item.dataset.categoryHighlight === key);
      item.classList.toggle("category-dimmed", item.dataset.categoryHighlight !== key);
    });
    updateCategoryPieSpotlight(target);
    updateCategoryExportAction(target);
    const tooltip = body.querySelector("[data-category-pie-tooltip]");
    if (!tooltip) return;
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${escapeHtml(target.dataset.categoryTitle || "")}</strong>
      <span>${escapeHtml(`${target.dataset.categoryValue || "-"} / ${target.dataset.categoryShare || "-"}`)}</span>
      <small>${escapeHtml(`${target.dataset.categoryMerchants || "0"} merchants / ${target.dataset.categoryOrders || "0"} orders`)}</small>
      <small>${escapeHtml(`Top: ${target.dataset.categoryTop || "-"}`)}</small>`;
    const rect = body.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const x = event && Number.isFinite(event.clientX) ? event.clientX : targetRect.left + targetRect.width / 2;
    const y = event && Number.isFinite(event.clientY) ? event.clientY : targetRect.top + targetRect.height / 2;
    tooltip.style.left = `${Math.min(Math.max(x - rect.left + 14, 12), rect.width - 260)}px`;
    tooltip.style.top = `${Math.max(y - rect.top - 18, 12)}px`;
  }

  function clearCategoryHighlight() {
    const body = els.dashboardCategoryReportBody;
    if (!body) return;
    body.querySelectorAll("[data-category-highlight]").forEach((item) => {
      item.classList.remove("category-active", "category-dimmed");
    });
    const tooltip = body.querySelector("[data-category-pie-tooltip]");
    if (tooltip) tooltip.hidden = true;
  }

  function handleCategoryPointerMove(event) {
    const target = event.target.closest("[data-category-highlight]");
    if (!target || !els.dashboardCategoryReportBody.contains(target)) {
      clearCategoryHighlight();
      return;
    }
    setCategoryHighlight(target, event);
  }

  function handleCategoryFocus(event) {
    const target = event.target.closest("[data-category-highlight]");
    if (target && els.dashboardCategoryReportBody.contains(target)) setCategoryHighlight(target);
  }

  function renderDashboardCategoryReport() {
    if (!els.dashboardCategoryReportBody) return;
    const rows = dashboardCategoryReportRows();
    const allGroups = tierCategorySummaryRows(null, rows);
    const filteredGroups = filterDashboardCategoryReportGroups(allGroups);
    let groups = dashboardCategoryFocusedGroups(filteredGroups);
    if (state.categoryReportFocusKey && !groups.length) {
      state.categoryReportFocusKey = "";
      groups = filteredGroups;
    }
    const totalRevenue = groups.reduce((sum, group) => sum + number(group.revenue), 0);
    const totalOrders = groups.reduce((sum, group) => sum + number(group.orders), 0);
    const totalClicks = groups.reduce((sum, group) => sum + number(group.clicks), 0);
    const merchantCount = groups.reduce((sum, group) => sum + number(group.merchantCount), 0);
    const selectedTiers = normalizeCategoryReportTiers(state.categoryReportTiers).map(categoryReportTierLabel);
    if (els.dashboardCategoryReportSubtitle) {
      const tierText = selectedTiers.length ? selectedTiers.join(", ") : "No tiers selected";
      els.dashboardCategoryReportSubtitle.textContent = `${tierText} / ${rows.length.toLocaleString()} rows / ${groups.length.toLocaleString()} of ${allGroups.length.toLocaleString()} categories`;
    }
    if (els.dashboardCategorySearch) els.dashboardCategorySearch.value = state.categoryReportSearch;
    const prevScrollEl = els.dashboardCategoryReportBody.querySelector(".table-wrap");
    const prevTableScroll = prevScrollEl ? prevScrollEl.scrollTop : 0;
    const prevDocScroll = window.scrollY;
    els.dashboardCategoryReportBody.innerHTML = `<dl class="dashboard-category-report-totals">
      <div><dt>${escapeHtml(labelText("Merchants"))}</dt><dd>${merchantCount.toLocaleString()}</dd></div>
      <div><dt>${escapeHtml(labelText("Revenue"))}</dt><dd>${shortMoney(totalRevenue)}</dd></div>
      <div><dt>${escapeHtml(labelText("Orders"))}</dt><dd>${totalOrders.toLocaleString()}</dd></div>
      <div><dt>${escapeHtml(labelText("CVR"))}</dt><dd>${shortPct(totalClicks ? totalOrders / totalClicks : null)}</dd></div>
    </dl>
    ${dashboardCategoryPieHtml(groups)}
    ${dashboardCategoryOptimizationPreviewsHtml(groups)}
    <div class="table-wrap tier-category-table-wrap dashboard-category-table-wrap">
      <table class="sheet-table tier-category-table dashboard-category-report-table">
        <thead>
          <tr>
            ${dashboardCategorySortableHeader("category", labelText("Category"))}
            ${dashboardCategorySortableHeader("merchantCount", labelText("Merchants"))}
            ${dashboardCategorySortableHeader("revenue", labelText("Revenue"))}
            ${dashboardCategorySortableHeader("orders", labelText("Orders"))}
            ${dashboardCategorySortableHeader("clicks", labelText("Clicks"))}
            ${dashboardCategorySortableHeader("avgCvr", labelText("CVR"))}
            ${dashboardCategorySortableHeader("avgEpc", "EPC")}
            ${dashboardCategorySortableHeader("avgAov", "AOV")}
            <th>Top merchants</th>
            <th>Tier mix</th>
          </tr>
        </thead>
        <tbody>${groups.length ? dashboardCategoryReportTableRows(groups) : `<tr><td colspan="10">No category rows match the selected tiers or category search.</td></tr>`}</tbody>
      </table>
    </div>`;
    requestAnimationFrame(() => {
      const wrap = els.dashboardCategoryReportBody.querySelector(".table-wrap");
      if (wrap) wrap.scrollTop = prevTableScroll;
      window.scrollTo(0, prevDocScroll);
    });
    animateDashboardCategoryRefresh();
    syncDashboardCategoryTierControls();
  }

  function renderAll(rows = getFiltered()) {
    renderDashboardCategoryReport();
    if (state.currentContext.type === "default") {
      setContext({ type: "default", items: rows.slice(0, 120), summary: aggregateRows(rows), filters: {} });
    }
  }

  function syncControls() {
    if (els.tier) els.tier.value = state.tier;
    if (els.network) els.network.value = state.network;
    if (els.category) els.category.value = state.category;
    if (els.minEpc) els.minEpc.value = state.minEpc;
    if (els.minAov) els.minAov.value = state.minAov;
    if (els.minCvr) els.minCvr.value = state.minCvr;
    if (els.notPaidOnly) els.notPaidOnly.checked = state.notPaidOnly;
    document.querySelectorAll(".sort-button").forEach((button) => button.classList.toggle("active", button.dataset.sort === state.sort));
  }

  function resetFilters() {
    Object.assign(state, { tier: "all", network: "all", category: "all", minEpc: "", minAov: "", minCvr: "", notPaidOnly: false, sort: "epc", descending: true });
    state.currentContext = { type: "default", items: [], summary: {}, filters: {} };
    syncControls();
    renderAll();
  }

  function safeFilePart(value, fallback = "export") {
    const text = String(value || fallback).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return text || fallback;
  }

  function titleCaseFilePart(value) {
    return String(value || "")
      .replace(/[_-]+/g, " ")
      .replace(/[^\p{L}\p{N}&+ ]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .map((word) => {
        if (/^(aov|epc|cvr|asin|us|uk|fr|de)$/i.test(word)) return word.toUpperCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function categoryFilenameLabel(category) {
    const text = String(category || "").trim();
    const labels = {
      "Beauty & Personal Care": "Beauty",
      "Pet Supplies": "Pet",
      "Clothing, Shoes & Jewelry": "Shoes",
      "Patio, Lawn & Garden": "Patio Lawn Garden",
      "Sports & Outdoors": "Sports Outdoors",
      "Home & Kitchen": "Home Kitchen",
      "Health & Household": "Health Household",
      "Grocery & Gourmet Food": "Grocery",
      "Cell Phones & Accessories": "Cell Phones",
      "Tools & Home Improvement": "Tools Home Improvement"
    };
    return labels[text] || titleCaseFilePart(text.replace(/\s*&\s*/g, " "));
  }

  function chatbotOfferDescriptor(context = {}) {
    const parts = [];
    if (context.category) parts.push(categoryFilenameLabel(context.category));
    else if (context.keyword) parts.push(titleCaseFilePart(context.keyword));
    else if (context.tier) parts.push(titleCaseFilePart(context.tier));
    else if (context.paymentCycleFilter) parts.push("Payment Cycle");

    if (context.ranking && !parts.some((part) => normalize(part).includes(normalize(context.ranking)))) {
      parts.push(titleCaseFilePart(context.ranking));
    }

    const descriptor = parts
      .map((part) => titleCaseFilePart(part))
      .filter(Boolean)
      .filter((part, index, list) => list.findIndex((item) => normalize(item) === normalize(part)) === index)
      .join(" ");
    return descriptor;
  }

  function todayDownloadDateStamp() {
    const date = PAYMENT_TODAY instanceof Date && !Number.isNaN(PAYMENT_TODAY.valueOf()) ? PAYMENT_TODAY : new Date();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${month}-${day}-${date.getFullYear()}`;
  }

  function safeDownloadFilename(value) {
    return String(value || "download.xlsx")
      .replace(/[<>:"/\\|?*]+/g, "-")
      .replace(/\s+/g, " ")
      .replace(/\s+-\s+/g, "-")
      .trim();
  }

  function chatbotOfferDownloadFilename(context = {}, requestedCount = 0) {
    const count = Math.max(1, Math.floor(number(requestedCount) || number(context.exportCount) || 1));
    const descriptor = chatbotOfferDescriptor(context);
    const descriptorPart = descriptor ? `${descriptor} ` : "";
    return safeDownloadFilename(`Yeahpromos_Top ${count} ${descriptorPart}Offers ${todayDownloadDateStamp()}.xlsx`);
  }

  function safeSheetName(value) {
    const name = String(value || "Export").replace(/[\[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
    return name || "Export";
  }

  function todayFileStamp() {
    return isoDate(PAYMENT_TODAY) || new Date().toISOString().slice(0, 10);
  }

  function registerRecommendationDownload(rows, context = {}, requestedCount = rows.length) {
    const id = `recommendation-${++state.downloadSequence}`;
    const today = todayFileStamp();
    const type = context.downloadType || "offers";
    const scope = context.exportScope || context.category || context.tier || "top";
    const prefix = context.filePrefix || (type === "payments" ? "payment_records" : type === "sheet" ? "sheet_records" : "offer_recommendations");
    const rowLabel = type === "payments" ? "records" : type === "sheet" ? "rows" : "offers";
    const columns = context.downloadColumns || (type === "payments" ? paymentExportColumns() : type === "offers" ? chatbotOfferExportColumns() : recommendationExportColumns());
    const sheetName = type === "offers" ? "offer list" : context.sheetName || (type === "payments" ? "Payments" : type === "sheet" ? "Sheet Records" : "Recommendations");
    state.recommendationDownloads[id] = {
      rows,
      context: { ...context, columns, sheetName },
      requestedCount,
      columns,
      sheetName,
      filename: context.filename || (type === "offers"
        ? chatbotOfferDownloadFilename({ ...context, exportScope: scope, exportCount: rows.length }, requestedCount)
        : `${prefix}_${safeFilePart(scope)}_${rows.length}_${rowLabel}_${today}.xlsx`)
    };
    return id;
  }

  function downloadCardHtml(rows, context = {}, options = {}) {
    if (!rows || !rows.length) return "";
    const downloadId = registerRecommendationDownload(rows, context, context.requestedCount || rows.length);
    const title = options.title || "Download file";
    const description = options.description || `${rows.length.toLocaleString()} rows available for Excel download.`;
    const buttonLabel = options.buttonLabel || "Download Excel";
    return `<div class="download-card">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </div>
      <button class="download-xlsx-button" type="button" data-download-id="${escapeHtml(downloadId)}">${escapeHtml(buttonLabel)}</button>
    </div>`;
  }

  function recommendationExportColumns() {
    return [
      ["Rank", (offer, index) => index + 1],
      ["Brand", (offer) => offer.brand || ""],
      ["Merchant ID", (offer) => offer.merchantId || ""],
      ["Tier", (offer) => tierGroup(offer)],
      ["Network", (offer) => offer.network || ""],
      ["Category", (offer) => displayCategory(offer)],
      ["Main Category", (offer) => offer.mainCategory || ""],
      ["Subcategory", (offer) => offer.subCategory || ""],
      ["Main Category CN", (offer) => offer.mainCategoryCn || ""],
      ["Subcategory CN", (offer) => offer.subCategoryCn || ""],
      ["EPC", (offer) => number(offer.epc)],
      ["AOV", (offer) => number(offer.aov)],
      ["Conversion Rate", (offer) => number(offer.conversionRate)],
      ["Clicks", (offer) => number(offer.clicks)],
      ["DPV", (offer) => number(offer.dpv)],
      ["ATC", (offer) => number(offer.atc)],
      ["Orders", (offer) => number(offer.orders)],
      ["Revenue", (offer) => number(offer.salesAmount)],
      ["Commission", (offer) => number(offer.affCommission)],
      ["Commission Rate", (offer) => number(offer.commissionRate)],
      ["Payment Status", (offer) => offer.paymentStatus || ""],
      ["Payment Cycle", (offer) => offer.paymentCycle || ""],
      ["Recommended Link", (offer) => offer.recommendedLink || ""],
      ["Top ASINs", (offer) => Array.isArray(offer.topAsins) ? offer.topAsins.join(", ") : (offer.topAsins || offer.asinsText || "")],
      ["Publisher Count", (offer) => tier2PublisherCountText(offer, "en") || offer.publisherCount || ""],
      ["Publisher Success Rate", (offer) => tier2PublisherSuccessText(offer, "en") || ""],
      ["Tier 2 Optimization Idea", (offer) => tier2OptimizationIdea(offer, "en") || ""],
      ["Recommended Action", (offer, index, context) => recommendedAction(offer, context.language || state.language)],
      ["Why Recommended", (offer, index, context) => whyRecommended(offer, context)],
      ["Best Traffic Angle", (offer, index, context) => bestAngle(offer, context)],
      ["Caution", (offer, index, context) => caution(offer, context.language || state.language)]
    ];
  }

  function chatbotOfferExportColumns() {
    return [
      ["Merchant ID", (offer) => offer.merchantId || ""],
      ["Name", (offer) => offer.brand || offer.merchantName || ""],
      ["AOV", (offer) => number(offer.aov)],
      ["Commission Rate", (offer) => (Number(offer.commissionRate) || 0).toFixed(2) + "%"],
      ["Payment Cycle", (offer) => offer.paymentCycle || ""],
      ["Main Category", (offer) => offer.mainCategory || ""],
      ["Subcategory", (offer) => offer.subCategory || ""]
    ];
  }

  function paymentExportColumns() {
    return [
      ["Merchant ID", (record) => record.merchantId || ""],
      ["Merchant", (record) => record.merchantName || ""],
      ["Tier", (record) => record.tier || "Unknown"],
      ["Network", (record) => record.network || ""],
      ["Region", (record) => record.region || ""],
      ["Category", (record) => displayCategory(record)],
      ["Main Category", (record) => record.mainCategory || ""],
      ["Subcategory", (record) => record.subCategory || ""],
      ["Month", (record) => `${optionText(record.reportMonth)} ${record.reportYear || ""}`.trim()],
      ["Status", (record) => statusText(record.paymentStatus || "Unknown")],
      ["Revenue Made", (record) => paymentMoney(record, record.revenueMade)],
      ["Commission Made", (record) => paymentMoney(record, record.commissionMade)],
      ["Paid Amount", (record) => paymentMoney(record, record.paidAmount)],
      ["Remaining Amount", (record) => paymentMoney(record, record.remainingAmount)],
      ["Payment Cycle Days", (record) => number(record.paymentCycle)],
      ["Expected Payment Date", (record) => record.expectedPaymentDate || record.paymentAvailabilityDate || ""],
      ["Payment Made", (record) => paymentMadeDateText(record)]
    ];
  }

  function objectExportColumns(rows, preferredHeaders = []) {
    const headers = preferredHeaders.length
      ? preferredHeaders
      : Array.from(rows.reduce((set, row) => {
          Object.keys(row || {}).forEach((key) => set.add(key));
          return set;
        }, new Set()));
    return headers.map((header) => [header, (row) => row && row[header] != null ? row[header] : ""]);
  }

  function gridRowsForExport(grid) {
    const maxCols = grid.reduce((max, row) => Math.max(max, row.length), 0);
    const headers = Array.from({ length: maxCols }, (_, index) => columnLabel(index));
    const rows = grid.map((row) => headers.reduce((record, header, index) => {
      record[header] = row[index] || "";
      return record;
    }, {}));
    return { rows, headers };
  }

  function xmlEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]);
  }

  function columnName(index) {
    let name = "";
    let n = index + 1;
    while (n > 0) {
      const remainder = (n - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function worksheetXml(rows, context = {}) {
    const columns = context.columns || recommendationExportColumns();
    const sheetRows = [
      columns.map(([header]) => header),
      ...rows.map((offer, index) => columns.map(([, getter]) => getter(offer, index, context)))
    ];
    const rowXml = sheetRows.map((row, rowIndex) => {
      const cells = row.map((value, colIndex) => {
        const ref = `${columnName(colIndex)}${rowIndex + 1}`;
        if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"><v>${value}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    const widths = columns.map(([, , width], index) => `<col min="${index + 1}" max="${index + 1}" width="${width || (index < 6 ? 18 : 14)}" customWidth="1"/>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${widths}</cols>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
  }

  function workbookXml(sheetName = "Recommendations") {
    const sheetNames = Array.isArray(sheetName) ? sheetName : [sheetName];
    const sheets = sheetNames.map((name, index) => (
      `<sheet name="${xmlEscape(safeSheetName(name || `Sheet ${index + 1}`))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
    )).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets}</sheets>
</workbook>`;
  }

  function workbookRelsXml(sheetCount = 1) {
    const worksheetRels = Array.from({ length: sheetCount }, (_, index) => (
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
    )).join("\n  ");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRels}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  }

  function rootRelsXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  }

  function contentTypesXml(sheetCount = 1) {
    const worksheetTypes = Array.from({ length: sheetCount }, (_, index) => (
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )).join("\n  ");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${worksheetTypes}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  }

  function crc32(bytes) {
    if (!crc32.table) {
      crc32.table = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
      });
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = crc32.table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function uint16(value) {
    const bytes = new Uint8Array(2);
    new DataView(bytes.buffer).setUint16(0, value, true);
    return bytes;
  }

  function uint32(value) {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    return bytes;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  function dosTimestamp() {
    const date = new Date();
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function createZip(files) {
    const encoder = new TextEncoder();
    const { time, day } = dosTimestamp();
    const locals = [];
    const centrals = [];
    let offset = 0;
    files.forEach((file) => {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
      const checksum = crc32(dataBytes);
      const local = concatBytes([
        uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(time), uint16(day),
        uint32(checksum), uint32(dataBytes.length), uint32(dataBytes.length), uint16(nameBytes.length), uint16(0),
        nameBytes, dataBytes
      ]);
      const central = concatBytes([
        uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(time), uint16(day),
        uint32(checksum), uint32(dataBytes.length), uint32(dataBytes.length), uint16(nameBytes.length), uint16(0), uint16(0),
        uint16(0), uint16(0), uint32(0), uint32(offset), nameBytes
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });
    const centralDirectory = concatBytes(centrals);
    const end = concatBytes([
      uint32(0x06054b50), uint16(0), uint16(0), uint16(files.length), uint16(files.length),
      uint32(centralDirectory.length), uint32(offset), uint16(0)
    ]);
    return concatBytes([...locals, centralDirectory, end]);
  }

  function uniqueWorkbookSheetName(name, usedNames) {
    const base = safeSheetName(name || "Export");
    let candidate = base;
    let index = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      const suffix = ` ${index}`;
      candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
      index += 1;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  function normalizeWorkbookSheets(sheets) {
    const usedNames = new Set();
    return (sheets.length ? sheets : [{ rows: [], sheetName: "Export" }]).map((sheet, index) => {
      const rows = sheet.rows || [];
      return {
        ...sheet,
        rows,
        sheetName: uniqueWorkbookSheetName(sheet.sheetName || `Sheet ${index + 1}`, usedNames),
        columns: sheet.columns || sheet.downloadColumns || objectExportColumns(rows)
      };
    });
  }

  function createWorkbookSheets(sheets) {
    const normalizedSheets = normalizeWorkbookSheets(sheets);
    const sheetCount = normalizedSheets.length;
    return createZip([
      { name: "[Content_Types].xml", data: contentTypesXml(sheetCount) },
      { name: "_rels/.rels", data: rootRelsXml() },
      { name: "xl/workbook.xml", data: workbookXml(normalizedSheets.map((sheet) => sheet.sheetName)) },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml(sheetCount) },
      { name: "xl/styles.xml", data: stylesXml() },
      ...normalizedSheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, data: worksheetXml(sheet.rows, sheet) }))
    ]);
  }

  function createRecommendationWorkbook(rows, context = {}) {
    if (Array.isArray(context.sheets) && context.sheets.length) {
      return createWorkbookSheets(context.sheets.map((sheet) => ({ ...context, ...sheet, sheets: undefined })));
    }
    return createWorkbookSheets([{
      ...context,
      rows,
      columns: context.columns || recommendationExportColumns(),
      sheetName: context.sheetName || "Recommendations"
    }]);
  }

  function triggerWorkbookDownload(workbook, filename) {
    const blob = new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadRowsAsXlsx(rows, context = {}) {
    if (!rows || !rows.length) return;
    const type = context.downloadType || "sheet";
    const prefix = context.filePrefix || (type === "payments" ? "payment_records" : type === "offers" ? "offers" : "sheet_records");
    const scope = context.exportScope || context.sheetName || type;
    const rowLabel = type === "offers" ? "offers" : type === "payments" ? "records" : "rows";
    const filename = context.filename || `${prefix}_${safeFilePart(scope)}_${rows.length}_${rowLabel}_${todayFileStamp()}.xlsx`;
    const workbook = createRecommendationWorkbook(rows, {
      ...context,
      columns: context.downloadColumns || context.columns || (type === "payments" ? paymentExportColumns() : type === "offers" ? recommendationExportColumns() : objectExportColumns(rows)),
      sheetName: context.sheetName || "Export"
    });
    triggerWorkbookDownload(workbook, filename);
  }

  function downloadFilteredXlsx() {
    const rows = getFiltered();
    downloadRowsAsXlsx(rows, {
      downloadType: "offers",
      filePrefix: "filtered_offers",
      exportScope: "current_dashboard",
      sheetName: "Filtered Offers"
    });
  }

  function downloadPaymentsXlsx() {
    const rows = getFilteredPayments();
    downloadRowsAsXlsx(rows, {
      downloadType: "payments",
      filePrefix: "payment_records",
      exportScope: "current_filters",
      sheetName: "Payments",
      downloadColumns: paymentExportColumns()
    });
  }

  function downloadSheetTargetsXlsx() {
    const headers = ["Month", "Tier", "Brand Count", "Total Clicks", "Order Count", "Revenue", "Avg Conversion", "New Tier Entries", "Tier Exits", "Target"];
    const rows = sortReportRows(filteredTargetRecords(), state.targetSort, (row, key) => row[key]);
    downloadRowsAsXlsx(rows, {
      downloadType: "sheet",
      filePrefix: "monthly_targets",
      exportScope: state.targetFilters.month === "all" ? "all_months" : state.targetFilters.month,
      sheetName: "Monthly Targets",
      downloadColumns: objectExportColumns(rows, headers)
    });
  }

  function downloadTierSheetXlsx() {
    const sheet = sheetByName(state.selectedTierPage);
    if (!sheet) return;
    if (sheet.headers && sheet.headers.length) {
      const rows = sortReportRows(getFilteredTierSheetRows(sheet), state.tierSheetSort, (row, key) => row[key]);
      const headers = visibleHeadersForSheet(sheet, displayHeadersForSheet(sheet, sheet.headers, false));
      const categoryRows = tierCategorySummaryExportRows(sheet, rows);
      const categoryHeaders = tierCategorySummaryExportHeaders();
      const offerListRows = tierOfferListExportRows(sheet, rows);
      const offerListHeaders = tierOfferListExportHeaders();
      downloadRowsAsXlsx(rows, {
        downloadType: "sheet",
        filePrefix: "tier_records",
        exportScope: state.selectedTierPage,
        sheetName: state.selectedTierPage,
        downloadColumns: objectExportColumns(rows, headers),
        sheets: [
          {
            sheetName: state.selectedTierPage,
            rows,
            columns: objectExportColumns(rows, headers)
          },
          {
            sheetName: "Category Summary",
            rows: categoryRows,
            columns: objectExportColumns(categoryRows, categoryHeaders)
          },
          {
            sheetName: "Offer List",
            rows: offerListRows,
            columns: objectExportColumns(offerListRows, offerListHeaders)
          }
        ]
      });
      return;
    }
    const gridExport = gridRowsForExport(sheet.grid || []);
    downloadRowsAsXlsx(gridExport.rows, {
      downloadType: "sheet",
      filePrefix: "tier_records",
      exportScope: state.selectedTierPage,
      sheetName: state.selectedTierPage,
      downloadColumns: objectExportColumns(gridExport.rows, gridExport.headers)
    });
  }

  function downloadRecommendationXlsx(downloadId) {
    const item = state.recommendationDownloads[downloadId];
    if (!item || !item.rows || !item.rows.length) return;
    const workbook = createRecommendationWorkbook(item.rows, {
      ...item.context,
      columns: item.columns || item.context.columns,
      sheetName: item.sheetName || item.context.sheetName
    });
    triggerWorkbookDownload(workbook, item.filename);
  }

  function paymentStatusClass(status) {
    const text = String(status || "").toLowerCase();
    if (text === "paid") return "paid";
    if (text === "overdue") return "overdue";
    if (text === "unpaid") return "unpaid";
    if (text === "partial" || text === "pending") return "warn";
    return "neutral";
  }

  function uniquePaymentValues(key) {
    const base = paymentRecords.map((record) => record[key]).filter(Boolean);
    const values = key === "reportMonth" ? [...ACTIVE_PAYMENT_MONTHS, ...base] : base;
    return Array.from(new Set(values)).sort((a, b) => {
      if (key === "reportMonth") {
        const aIndex = PAYMENT_MONTHS.indexOf(a);
        const bIndex = PAYMENT_MONTHS.indexOf(b);
        return (aIndex < 0 ? 99 : aIndex) - (bIndex < 0 ? 99 : bIndex);
      }
      if (String(a).startsWith("Tier") && String(b).startsWith("Tier")) return String(a).localeCompare(String(b), undefined, { numeric: true });
      return String(a).localeCompare(String(b));
    });
  }

  function refreshPaymentFilterOptions() {
    replaceSelectOptions(els.paymentMonth, "All months", uniquePaymentValues("reportMonth"), state.payments.month);
    replaceSelectOptions(els.paymentNetwork, "All networks", uniquePaymentValues("network"), state.payments.network);
    replaceSelectOptions(els.paymentRegion, "All regions", uniquePaymentValues("region"), state.payments.region);
    replaceSelectOptions(els.paymentTier, "All tiers", uniquePaymentValues("tier"), state.payments.tier);
    replaceSelectOptions(els.paymentStatus, "All status", paymentStatusFilterValues(), state.payments.status);
    state.payments.month = els.paymentMonth.value;
    state.payments.network = els.paymentNetwork.value;
    state.payments.region = els.paymentRegion.value;
    state.payments.tier = els.paymentTier.value;
    state.payments.status = els.paymentStatus.value;
    refreshPaymentSortOptions();
  }

  function refreshPaymentSortOptions() {
    if (!els.paymentSort) return;
    const options = paymentSortOptions();
    const nextKey = options.some((option) => option.value === state.paymentSort.key) ? state.paymentSort.key : "";
    state.paymentSort.key = nextKey;
    state.paymentSort.direction = nextKey
      ? (state.paymentSort.direction === "desc" ? "desc" : defaultReportSortDirection(nextKey))
      : "asc";
    replaceSelectWithOptions(els.paymentSort, options, nextKey);
    syncPaymentSortControls();
  }

  function syncPaymentSortControls() {
    if (!els.paymentSort) return;
    els.paymentSort.value = state.paymentSort.key || "";
  }

  function syncPaymentControls() {
    els.paymentMonth.value = state.payments.month;
    els.paymentNetwork.value = state.payments.network;
    els.paymentRegion.value = state.payments.region;
    els.paymentTier.value = state.payments.tier;
    els.paymentStatus.value = state.payments.status;
    els.paymentSearch.value = state.payments.search;
    syncPaymentSortControls();
  }

  function getFilteredPayments() {
    const search = normalize(state.payments.search);
    const rows = getPaymentRecords()
      .filter((record) => state.payments.month === "all" || record.reportMonth === state.payments.month || record.reportMonthKey === state.payments.month)
      .filter((record) => state.payments.network === "all" || record.network === state.payments.network)
      .filter((record) => state.payments.region === "all" || record.region === state.payments.region)
      .filter((record) => state.payments.tier === "all" || record.tier === state.payments.tier)
      .filter((record) => state.payments.status === "all" || record.paymentStatus === state.payments.status)
      .filter((record) => !search || normalize(`${record.merchantName} ${record.merchantId} ${record.region || ""}`).includes(search));
    return sortPaymentRowsForTable(rows);
  }

  function latestPaymentCheckedDate(rows) {
    const dates = (rows || [])
      .map((record) => String(record.lastCheckedDate || "").slice(0, 10))
      .filter(Boolean)
      .sort();
    if (dates.length) return dates[dates.length - 1];
    return String(data.summary?.paymentLastCheckedAt || "").slice(0, 10);
  }

  function renderPaymentSummary(rows) {
    const s = updatePaymentSummary(rows);
    const cards = [
      ["Merchants", s.merchantCount.toLocaleString()],
      ["Revenue made", paymentSummaryMoney(rows, s.totalRevenueMade, state.payments.region)],
      ["Commission made", paymentSummaryMoney(rows, s.totalCommissionMade, state.payments.region)],
      ["Payment rate", shortPct(s.paymentRate)]
    ];
    const statusRow = paymentStatusSummaryItems(s)
      .map(([label, value]) => `<div class="payment-status-pill"><span>${escapeHtml(labelText(label))}</span><strong>${escapeHtml(value)}</strong></div>`)
      .join("");
    els.paymentSummary.innerHTML = cards.map(([label, value]) => `<div class="metric payment-metric"><span>${escapeHtml(labelText(label))}</span><strong>${escapeHtml(value)}</strong></div>`).join("") +
      `<div class="payment-status-row" aria-label="Payment status summary">${statusRow}</div>`;
  }

  function paymentStatusSummaryItems(summary) {
    return [
      ["Paid", summary.paidMerchantCount.toLocaleString()],
      ["Pending", summary.pendingMerchantCount.toLocaleString()],
      ["Unpaid", summary.unpaidMerchantCount.toLocaleString()],
      ["Overdue", summary.overdueMerchantCount.toLocaleString()]
    ];
  }

  function renderPaymentHead() {
    if (!els.paymentHead) return;
    els.paymentHead.innerHTML = `<tr>${paymentTableColumns.map((column) => sortableHeaderHtml(column.label, state.paymentSort, "payment")).join("")}</tr>`;
  }

  function renderPaymentRows(rows) {
    els.paymentTableCount.textContent = `${rows.length.toLocaleString()} ${t("payment.tableCount", "matching payment records")}`;
    els.paymentRows.innerHTML = rows.map((record) => (
      `<tr data-merchant-id="${escapeHtml(record.merchantId || record.merchantName)}">
        ${paymentTableColumns.map((column) => `<td>${column.render(record)}</td>`).join("")}
      </tr>`
    )).join("");
  }

  function renderPaymentsPage() {
    const rows = getFilteredPayments();
    syncPaymentSortControls();
    renderPaymentSummary(rows);
    renderPaymentHead();
    renderPaymentRows(rows);
  }

  function downloadPublishersXlsx() {
    if (!_publishersCache) return;
    var data = _publishersCache;
    var sd = state.publisherStartDate || "";
    var ed = state.publisherEndDate || "";
    var hasDateFilter = sd !== "" || ed !== "";
    if (hasDateFilter && (data.dailyRows || data.monthlyRows)) {
      data = _applyDateFilterToData(data, sd, ed);
      data.publishers = data.publishers.filter(function (pub) {
        return pub.total.clicks > 0 || pub.total.dpv > 0 || pub.total.atc > 0 ||
               pub.total.orders > 0 || pub.total.sales > 0;
      });
    }
    var filtered = getFilteredPublishers(data);
    var market = state.publisherMarket || "all";
    var rows = filtered.map(function (pub, idx) {
      var m = market && market !== "all" ? pub.markets[market] : pub.total;
      m = m || { clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0, affCommission: 0 };
      return {
        rank: idx + 1,
        userId: pub.userId,
        userName: pub.userName,
        adminName: pub.adminName || "Unknown",
        clicks: m.clicks,
        cvr: m.clicks > 0 ? (m.orders / m.clicks) : 0,
        dpv: m.dpv,
        atc: m.atc,
        orders: m.orders,
        sales: m.sales,
        allCommission: m.allCommission,
        affCommission: m.affCommission,
        grossProfit: m.allCommission - m.affCommission,
      };
    });
    var headers = [
      "Rank", "Publisher ID", "Publisher Name", "Manager",
      "Clicks", "CVR", "DPV", "ATC", "Orders",
      "Sales", "All Commission", "Aff Commission", "Gross Profit"
    ];
    downloadRowsAsXlsx(rows, {
      downloadType: "sheet",
      filePrefix: "publishers",
      exportScope: state.publisherMarket,
      sheetName: "Publishers",
      downloadColumns: objectExportColumns(rows, headers)
    });
  }

  // ===== Publisher functions =====

  var _publishersCache = null;

  function _fillPublishersSelect(selectEl, values, currentValue, defaultText) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="all">' + escapeHtml(defaultText || t("label.All", "All")) + '</option>';
    if (!values || !values.length) return;
    values.forEach(function (v) {
      var opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    });
    if (currentValue && values.indexOf(currentValue) !== -1) {
      selectEl.value = currentValue;
    } else {
      selectEl.value = "all";
    }
  }

  var _managerOptions = [];

  function _rebuildManagerOptions(publishers) {
    if (!publishers) return;
    var counts = {};
    publishers.forEach(function (pub) {
      var name = pub.adminName || "Unknown";
      counts[name] = (counts[name] || 0) + 1;
    });
    _managerOptions = Object.keys(counts).sort(function (a, b) {
      if (a === "Unknown") return 1;
      if (b === "Unknown") return -1;
      return a.localeCompare(b);
    }).map(function (name) {
      return { name: name, count: counts[name] };
    });
  }

  function _showManagerDropdown() {
    var dd = document.getElementById("publisherManagerDropdown");
    if (!dd || !els.publisherManagerSearch) return;
    var q = (els.publisherManagerSearch.value || "").toLowerCase().trim();
    var html = "";
    var matched = 0;
    _managerOptions.forEach(function (opt) {
      if (q && opt.name.toLowerCase().indexOf(q) === -1) return;
      matched++;
      html += '<div class="combobox-option" data-value="' + escapeHtml(opt.name) + '">' +
        escapeHtml(opt.name) + '<span class="opt-count">(' + opt.count + ')</span></div>';
    });
    if (!html) {
      html = '<div class="combobox-option" style="color:var(--muted);cursor:default">无匹配</div>';
    }
    dd.innerHTML = html;
    dd.classList.add("show");
  }

  function _hideManagerDropdown() {
    var dd = document.getElementById("publisherManagerDropdown");
    if (dd) dd.classList.remove("show");
  }

  function loadPublishersData(forceRefresh) {
    if (_publishersCache && !forceRefresh) return Promise.resolve(_publishersCache);
    return fetch("/api/ui/db/publishers" + (forceRefresh ? "?refresh=1" : ""))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok === false) throw new Error(data.error || "Failed to load publishers data");
        _publishersCache = data;
        return data;
      });
  }

  function getFilteredPublishers(data) {
    if (!data || !data.publishers) return [];
    var market = state.publisherMarket || "all";
    var network = state.publisherNetwork || "all";
    var linkType = state.publisherLinkType || "all";
    var merchantSearch = (state.publisherMerchantSearch || "").toLowerCase().trim();
    var productSearch = (state.publisherProductSearch || "").toLowerCase().trim();
    var manager = (state.publisherManagerSearch || "").toLowerCase().trim();
    var siteSearch = (state.publisherSiteSearch || "").toLowerCase().trim();
    var trackSearch = (state.publisherTrackSearch || "").toLowerCase().trim();
    var nameMap = data.merchantNameMap || {};

    return data.publishers.filter(function (pub) {
      // 市场筛选
      if (market !== "all" && !pub.markets[market]) return false;
      // 联盟筛选
      if (network !== "all" && (!pub.networks || pub.networks.indexOf(network) === -1)) return false;
      // 链接类型筛选
      if (linkType !== "all" && (!pub.linkTypes || !pub.linkTypes[linkType])) return false;
      // 商家搜索（匹配商家名称和 ID）
      if (merchantSearch) {
        var matched = false;
        var mIds = pub.merchantIds || [];
        for (var i = 0; i < mIds.length; i++) {
          var mid = String(mIds[i]);
          var mName = (nameMap[mid] || "").toLowerCase();
          if (mid.indexOf(merchantSearch) !== -1 || mName.indexOf(merchantSearch) !== -1) {
            matched = true;
            break;
          }
        }
        // 也搜索 publisher 本身名称/ID
        if (!matched) {
          var name = (pub.userName || "").toLowerCase();
          var id = String(pub.userId);
          if (name.indexOf(merchantSearch) !== -1 || id.indexOf(merchantSearch) !== -1) matched = true;
        }
        if (!matched) return false;
      }
      // 商品搜索（publisher 名称/ID）
      if (productSearch) {
        var name2 = (pub.userName || "").toLowerCase();
        var id2 = String(pub.userId);
        if (name2.indexOf(productSearch) === -1 && id2.indexOf(productSearch) === -1) return false;
      }
      // 经理搜索
      if (manager) {
        var adminName = (pub.adminName || "").toLowerCase();
        if (adminName.indexOf(manager) === -1) return false;
      }
      // 站点搜索（模糊匹配市场名称）
      if (siteSearch) {
        var marketKeys = Object.keys(pub.markets || {});
        var siteMatched = false;
        for (var si = 0; si < marketKeys.length; si++) {
          if (marketKeys[si].toLowerCase().indexOf(siteSearch) !== -1) {
            siteMatched = true;
            break;
          }
        }
        // 也搜索 publisher 名称/ID
        if (!siteMatched) {
          var siteName = (pub.userName || "").toLowerCase();
          var siteId = String(pub.userId);
          if (siteName.indexOf(siteSearch) !== -1 || siteId.indexOf(siteSearch) !== -1) siteMatched = true;
        }
        if (!siteMatched) return false;
      }
      // track 搜索（全局搜索 publisher 名称/ID/经理等）
      if (trackSearch) {
        var trackName = (pub.userName || "").toLowerCase();
        var trackId = String(pub.userId);
        var trackAdmin = (pub.adminName || "").toLowerCase();
        if (trackName.indexOf(trackSearch) === -1 && trackId.indexOf(trackSearch) === -1 && trackAdmin.indexOf(trackSearch) === -1) return false;
      }
      return true;
    });
  }

  function aggregatePublisherMetrics(filteredPubs, market) {
    var agg = { clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0, affCommission: 0 };
    filteredPubs.forEach(function (pub) {
      var m = market && market !== "all" ? pub.markets[market] : pub.total;
      if (!m) return;
      agg.clicks += m.clicks;
      agg.dpv += m.dpv;
      agg.atc += m.atc;
      agg.orders += m.orders;
      agg.sales += m.sales;
      agg.allCommission += m.allCommission;
      agg.affCommission += m.affCommission;
    });
    agg.grossProfit = agg.allCommission - agg.affCommission;
    agg.conversionRate = agg.clicks > 0 ? agg.orders / agg.clicks : 0;
    return agg;
  }

  var PUBLISHER_CHART_METRIC_COLORS = {
    clicks: "#66b3ff",
    dpv: "#22c55e",
    atc: "#ec4899",
    orders: "#ef4444",
    sales: "#a855f7",
    allCommission: "#f97316",
  };

  var PUBLISHER_KPI_METRICS = [
    { key: "clicks", label: "Clicks", format: function(v) { return number(v); } },
    { key: "dpv", label: "DPV", format: function(v) { return number(v); } },
    { key: "atc", label: "ATC", format: function(v) { return number(v); } },
    { key: "orders", label: "Orders", format: function(v) { return number(v); } },
    { key: "sales", label: "Sales", format: function(v) { return money(v); } },
    { key: "allCommission", label: "Commission", format: function(v) { return money(v); } },
  ];

  function renderPublishersKpi(agg) {
    var activeMetric = state.publisherChartMetric || "clicks";
    els.publishersKpiRow.innerHTML = PUBLISHER_KPI_METRICS.map(function (m) {
      var val = agg[m.key] != null ? agg[m.key] : 0;
      var activeClass = m.key === activeMetric ? ' metric-active' : '';
      return '<div class="metric' + activeClass + '" data-publisher-kpi="' + m.key + '"><span>' +
        escapeHtml(m.label) + '</span><strong>' + m.format(val) + '</strong></div>';
    }).join("");
  }

  function renderPublishersChart(filteredPubs, market) {
    var metric = state.publisherChartMetric || "clicks";
    // 更新图表标题
    if (els.publishersChartTitle) {
      var metricLabels = { clicks: "Clicks", dpv: "DPV", atc: "ATC", orders: "Orders", sales: "Sales", allCommission: "Commission" };
      els.publishersChartTitle.textContent = (metricLabels[metric] || "Clicks") + " by Publisher";
    }
    var sorted = filteredPubs.slice().sort(function (a, b) {
      var ma = market && market !== "all" ? a.markets[market] : a.total;
      var mb = market && market !== "all" ? b.markets[market] : b.total;
      var va = ma ? (ma[metric] || 0) : 0;
      var vb = mb ? (mb[metric] || 0) : 0;
      return vb - va;
    });
    var topN = sorted.slice(0, 15);
    var topPub = topN[0];
    var maxForPct = topPub && (market && market !== "all" ? topPub.markets[market] : topPub.total);
    var maxVal = maxForPct ? (maxForPct[metric] || 1) : 1;
    // Find format function for the metric
    var metricDef = null;
    for (var i = 0; i < PUBLISHER_KPI_METRICS.length; i++) {
      if (PUBLISHER_KPI_METRICS[i].key === metric) { metricDef = PUBLISHER_KPI_METRICS[i]; break; }
    }
    var formatFn = metricDef ? metricDef.format : number;
    var barColor = PUBLISHER_CHART_METRIC_COLORS[metric] || "#66b3ff";
    var html = "";
    topN.forEach(function (pub, idx) {
      var m = market && market !== "all" ? pub.markets[market] : pub.total;
      var val = m ? (m[metric] || 0) : 0;
      var pct = Math.max(2, (val / maxVal) * 100);
      var delay = idx * 30;
      html += '<div class="chart-bar-row">' +
        '<span class="chart-bar-label" title="' + escapeHtml(pub.userName) + '">' + escapeHtml(pub.userName) + '</span>' +
        '<div class="chart-bar-track"><div class="chart-bar-fill" style="width:' + pct.toFixed(1) + '%;background:' + barColor + ';animation-delay:' + delay + 'ms">' +
          (pct > 5 ? formatFn(val) : '') +
        '</div></div>' +
        '<span class="chart-bar-value">' + formatFn(val) + '</span>' +
      '</div>';
    });
    if (!html) html = '<div class="publishers-empty">' + escapeHtml(t("publishers.empty", "No data")) + '</div>';
    els.publishersChart.innerHTML = html;
  }

  var PUBLISHER_TABLE_COLUMNS = [
    { key: "rank", label: "#", render: function(r) { return String(r.rank); } },
    { key: "userId", label: "Publisher ID", render: function(r) { return String(r.userId); } },
    { key: "userName", label: "Publisher Name", render: function(r) { return escapeHtml(r.userName); } },
    { key: "adminName", label: "Manager", render: function(r) { return escapeHtml(r.adminName || (r.userName === "Total" ? "" : "Unknown")); } },
    { key: "clicks", label: "Clicks", render: function(r) { return number(r.clicks); } },
    { key: "conversionRate", label: "CVR", render: function(r) { return pct(r.conversionRate); } },
    { key: "dpv", label: "DPV", render: function(r) { return number(r.dpv); } },
    { key: "atc", label: "ATC", render: function(r) { return number(r.atc); } },
    { key: "orders", label: "Orders", render: function(r) { return number(r.orders); } },
    { key: "sales", label: "Sales", render: function(r) { return money(r.sales); } },
    { key: "allCommission", label: "All Comm", render: function(r) { return money(r.allCommission); } },
    { key: "affCommission", label: "Aff Comm", render: function(r) { return money(r.affCommission); } },
    { key: "grossProfit", label: "Gross Profit", render: function(r) { return money(r.grossProfit); } },
  ];

  function renderPublishersTable(filteredPubs, market, totals) {
    // 可排序表头
    els.publishersTableHead.innerHTML = "<tr>" + PUBLISHER_TABLE_COLUMNS.map(function (c) {
      return sortableHeaderHtml(c.key, state.publisherSort, "publisher");
    }).join("") + "</tr>";

    // 预计算每行的指标（不含合计行，合计行不参与排序）
    var sortKey = state.publisherSort.key;
    var rows = filteredPubs.map(function (pub, idx) {
      var m = market && market !== "all" ? pub.markets[market] : pub.total;
      m = m || { clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0, affCommission: 0 };
      return {
        _idx: idx,
        rank: idx + 1,
        userId: pub.userId,
        userName: pub.userName,
        adminName: pub.adminName || "Unknown",
        clicks: m.clicks,
        conversionRate: m.clicks > 0 ? m.orders / m.clicks : 0,
        dpv: m.dpv,
        atc: m.atc,
        orders: m.orders,
        sales: m.sales,
        allCommission: m.allCommission,
        affCommission: m.affCommission,
        grossProfit: m.allCommission - m.affCommission,
      };
    });

    // 排序
    if (sortKey) {
      var getter = function (row, key) { return row[key]; };
      rows = sortReportRows(rows, state.publisherSort, getter);
      // 重新编号 rank
      rows.forEach(function (r, i) { r.rank = i + 1; });
    }

    // 合计行
    var totalRow = {
      rank: "",
      userId: "",
      userName: "Total",
      adminName: "",
      clicks: totals.clicks,
      conversionRate: totals.conversionRate,
      dpv: totals.dpv,
      atc: totals.atc,
      orders: totals.orders,
      sales: totals.sales,
      allCommission: totals.allCommission,
      affCommission: totals.affCommission,
      grossProfit: totals.grossProfit,
    };

    els.publishersTableCount.textContent = "Total: " + filteredPubs.length.toLocaleString();

    var allRows = [totalRow].concat(rows);
    els.publishersTableRows.innerHTML = allRows.map(function (r, i) {
      var cls = i === 0 ? ' class="total-row"' : "";
      return "<tr" + cls + ">" + PUBLISHER_TABLE_COLUMNS.map(function (c) {
        return "<td>" + c.render(r) + "</td>";
      }).join("") + "</tr>";
    }).join("");
  }

  function renderPublishersPage() {
    els.publishersTableRows.innerHTML = '<tr><td colspan="13" class="publishers-loading">' +
      escapeHtml(t("publishers.loading", "Loading...")) + '</td></tr>';

    loadPublishersData().then(function (data) {
      // 填充联盟下拉
      _fillPublishersSelect(els.publisherNetworkFilter, data.networks || [], state.publisherNetwork, "请选择所属联盟");
      // 填充链接类型下拉
      _fillPublishersSelect(els.publisherLinkTypeFilter, data.linkTypes || [], state.publisherLinkType, "请选择链接类型");
      // 填充市场下拉
      _fillPublishersSelect(els.publisherMarketFilter, data.markets || [], state.publisherMarket, "请选择站点");
      // 重建经理选项列表（供组合框使用）
      _rebuildManagerOptions(data.publishers);
      if (els.publisherManagerSearch) {
        els.publisherManagerSearch.value = state.publisherManagerSearch || "";
      }
      // 恢复日期选择器值
      els.publisherStartDate.value = state.publisherStartDate || "";
      els.publisherEndDate.value = state.publisherEndDate || "";

      // 恢复搜索框值
      els.publisherMerchantSearch.value = state.publisherMerchantSearch || "";
      els.publisherProductSearch.value = state.publisherProductSearch || "";
      els.publisherManagerSearch.value = state.publisherManagerSearch || "";
      els.publisherSiteSearch.value = state.publisherSiteSearch || "";
      els.publisherTrackSearch.value = state.publisherTrackSearch || "";

      // 当日期范围生效时，用 dailyRows 重新计算 publisher 的数据
      var sd = state.publisherStartDate || "";
      var ed = state.publisherEndDate || "";
      var hasDateFilter = sd !== "" || ed !== "";
      if (hasDateFilter && (data.dailyRows || data.monthlyRows)) {
        data = _applyDateFilterToData(data, sd, ed);
        // 筛选后剔除在该时间范围内没有数据的 publisher
        data.publishers = data.publishers.filter(function (pub) {
          return pub.total.clicks > 0 || pub.total.dpv > 0 || pub.total.atc > 0 ||
                 pub.total.orders > 0 || pub.total.sales > 0;
        });
      }

      var filtered = getFilteredPublishers(data);
      var market = state.publisherMarket || "all";
      var agg = aggregatePublisherMetrics(filtered, market);

      // KPI
      renderPublishersKpi(agg);

      // 柱状图（按当前市场排序）
      renderPublishersChart(filtered, market);

      // 表格
      renderPublishersTable(filtered, market, agg);
    }).catch(function (err) {
      els.publishersTableRows.innerHTML = '<tr><td colspan="13" class="publishers-empty">' +
        escapeHtml(t("publishers.error", "Error: ") + err.message) + '</td></tr>';
    });
  }

  function _applyDateFilterToData(data, startDate, endDate) {
    // 从 dailyRows（或向后兼容的 monthlyRows）中筛选出目标日期范围内的行
    var rows = data.dailyRows || data.monthlyRows || {};
    var selected = [];
    Object.keys(rows).forEach(function (key) {
      // dailyRows 的 key 是 "YYYY-MM-DD"，monthlyRows 是 "YYYY-MM"
      // 两种格式都可以用字符串直接比较
      if (startDate && key < startDate) return;
      if (endDate && key > endDate) return;
      selected = selected.concat(rows[key]);
    });

    // 按 userId+market 汇总
    var sums = {};  // key: "uid|market"
    selected.forEach(function (r) {
      var key = r.userId + "|" + r.market;
      if (!sums[key]) {
        sums[key] = { userId: r.userId, market: r.market, clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0, affCommission: 0 };
      }
      sums[key].clicks += r.clicks;
      sums[key].dpv += r.dpv;
      sums[key].atc += r.atc;
      sums[key].orders += r.orders;
      sums[key].sales += r.sales;
      sums[key].allCommission += r.allCommission;
      sums[key].affCommission += r.affCommission;
    });

    // 重新计算每个 publisher 的 total 和 markets
    var newPublishers = data.publishers.map(function (pub) {
      var newPub = JSON.parse(JSON.stringify(pub));
      newPub.markets = {};
      newPub.total = { clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0, affCommission: 0 };

      Object.keys(sums).forEach(function (key) {
        if (key.startsWith(pub.userId + "|")) {
          var s = sums[key];
          var mkt = s.market;
          if (!newPub.markets[mkt]) {
            newPub.markets[mkt] = { clicks: 0, dpv: 0, atc: 0, orders: 0, sales: 0, allCommission: 0, affCommission: 0 };
          }
          newPub.markets[mkt].clicks += s.clicks;
          newPub.markets[mkt].dpv += s.dpv;
          newPub.markets[mkt].atc += s.atc;
          newPub.markets[mkt].orders += s.orders;
          newPub.markets[mkt].sales += s.sales;
          newPub.markets[mkt].allCommission += s.allCommission;
          newPub.markets[mkt].affCommission += s.affCommission;
          newPub.total.clicks += s.clicks;
          newPub.total.dpv += s.dpv;
          newPub.total.atc += s.atc;
          newPub.total.orders += s.orders;
          newPub.total.sales += s.sales;
          newPub.total.allCommission += s.allCommission;
          newPub.total.affCommission += s.affCommission;
        }
      });

      return newPub;
    });

    // 只保留有数据的 publisher，且保留 markets 中出现的 market
    var activeMarkets = new Set();
    newPublishers.forEach(function (p) {
      Object.keys(p.markets).forEach(function (m) { activeMarkets.add(m); });
    });

    return {
      publishers: newPublishers,
      summary: data.summary,
      markets: data.markets.filter(function (m) { return activeMarkets.has(m); }),
      networks: data.networks,
      linkTypes: data.linkTypes,
      merchantNameMap: data.merchantNameMap || {},
    };
  }

  // ===== End publisher functions =====

  function sheetByName(name) {
    return (sheetReport.sheets || []).find((sheet) => sheet.name === name) || null;
  }

  function storageApi() {
    try {
      if (window.localStorage) return window.localStorage;
      if (typeof localStorage !== "undefined") return localStorage;
      return null;
    } catch (error) {
      return null;
    }
  }

  function isTierMoveTarget(tierName) {
    return TIER_SHEET_MOVE_TARGETS.includes(tierName);
  }

  function isTierDataSheet(sheet) {
    return Boolean(sheet && isTierMoveTarget(sheet.name) && Array.isArray(sheet.rows));
  }

  function loadManualTierMoves() {
    const storage = storageApi();
    if (!storage) return {};
    try {
      const parsed = JSON.parse(storage.getItem(TIER_SHEET_MOVE_STORAGE_KEY) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.entries(parsed).reduce((moves, [key, record]) => {
        if (!record || typeof record !== "object") return moves;
        const sourceTier = String(record.sourceTier || "");
        const targetTier = String(record.targetTier || "");
        if (!key || !isTierMoveTarget(sourceTier) || !isTierMoveTarget(targetTier) || sourceTier === targetTier) return moves;
        moves[key] = {
          sourceTier,
          targetTier,
          merchantId: String(record.merchantId || ""),
          merchantName: String(record.merchantName || ""),
          movedAt: String(record.movedAt || "")
        };
        return moves;
      }, {});
    } catch (error) {
      return {};
    }
  }

  function persistManualTierMoves() {
    const storage = storageApi();
    if (!storage) return;
    const keys = Object.keys(state.manualTierMoves || {});
    if (!keys.length) {
      storage.removeItem(TIER_SHEET_MOVE_STORAGE_KEY);
      return;
    }
    storage.setItem(TIER_SHEET_MOVE_STORAGE_KEY, JSON.stringify(state.manualTierMoves));
  }

  function tierMoveAdminToken() {
    const storage = storageApi();
    if (!storage) return "";
    try {
      return String(storage.getItem(TIER_MOVE_ADMIN_TOKEN_KEY) || "").trim();
    } catch (error) {
      return "";
    }
  }

  function requestTierMoveAdminToken() {
    const storage = storageApi();
    if (!storage || typeof window.prompt !== "function") return "";
    const token = String(window.prompt("Enter the tier move admin token") || "").trim();
    if (token) storage.setItem(TIER_MOVE_ADMIN_TOKEN_KEY, token);
    return token;
  }

  function originalMoveKeyForRecord(record) {
    const explicitKey = String(record && (record.key || record.rowKey || record.row_key) || "").trim();
    if (explicitKey && originalTierSheetRowIndex.has(explicitKey)) return explicitKey;
    const merchantId = String(record && (record.merchantId || record.merchant_id) || "").trim().replace(/\.0$/, "");
    const sourceTier = canonicalTierName(record && (record.sourceTier || record.source_tier));
    if (!merchantId || !isTierMoveTarget(sourceTier)) return "";
    for (const [key, original] of originalTierSheetRowIndex.entries()) {
      if (original.sourceTier !== sourceTier) continue;
      if (tierRowMerchantId(original.row) === merchantId) return key;
    }
    return "";
  }

  function manualTierMovesFromRecords(records) {
    return (records || []).reduce((moves, record) => {
      const sourceTier = canonicalTierName(record && (record.sourceTier || record.source_tier));
      const targetTier = canonicalTierName(record && (record.targetTier || record.target_tier));
      const key = originalMoveKeyForRecord(record);
      if (!key || !isTierMoveTarget(sourceTier) || !isTierMoveTarget(targetTier) || sourceTier === targetTier) return moves;
      const original = originalTierSheetRowIndex.get(key);
      moves[key] = {
        sourceTier: original ? original.sourceTier : sourceTier,
        targetTier,
        merchantId: String(record.merchantId || record.merchant_id || (original && tierRowMerchantId(original.row)) || "").trim().replace(/\.0$/, ""),
        merchantName: String(record.merchantName || record.merchant_name || (original && tierRowMerchantName(original.row)) || "").trim(),
        movedAt: String(record.movedAt || record.moved_at || "")
      };
      return moves;
    }, {});
  }

  function tierMovePayload(action = "replace") {
    return {
      action,
      updatedBy: "offer-intelligence-ui",
      moves: Object.entries(state.manualTierMoves || {}).map(([key, move]) => {
        const original = originalTierSheetRowIndex.get(key);
        return {
          key,
          sourceTier: move.sourceTier || (original && original.sourceTier) || "",
          targetTier: move.targetTier || "",
          merchantId: move.merchantId || (original && tierRowMerchantId(original.row)) || "",
          merchantName: move.merchantName || (original && tierRowMerchantName(original.row)) || "",
          movedAt: move.movedAt || localDateKey(new Date())
        };
      })
    };
  }

  function renderAfterTierMoveSync(fallbackTier = state.selectedTierPage) {
    applyManualTierMoves();
    updatePaymentRowsForTierMove();
    refreshPaymentFilterOptions();
    setPaymentStamp(state.livePaymentsLoaded ? "live" : "saved");
    if (state.page === "tier") {
      renderTierPage(fallbackTier);
    } else if (state.page === "payments") {
      renderPaymentsPage();
    } else {
      renderAll();
    }
    renderDashboardCategoryReport();
  }

  async function loadSharedTierMoves({ silent = false } = {}) {
    if (typeof fetch !== "function" || state.sharedTierMovesLoading) return false;
    state.sharedTierMovesLoading = true;
    try {
      const response = await fetch(TIER_SHARED_MOVES_API, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      state.sharedTierMovesConfigured = Boolean(payload.configured);
      if (!payload.configured) {
        if (!silent) setTierMoveStatus("Shared tier moves are not configured; changes stay local in this browser.");
        return false;
      }
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      state.manualTierMoves = manualTierMovesFromRecords(payload.moves || []);
      persistManualTierMoves();
      renderAfterTierMoveSync();
      if (!silent) {
        const count = Object.keys(state.manualTierMoves).length;
        setTierMoveStatus(`Loaded ${count.toLocaleString()} shared tier move${count === 1 ? "" : "s"}`);
      }
      return true;
    } catch (error) {
      if (!silent) setTierMoveStatus(`Could not load shared tier moves; using local moves only (${error.message || error})`);
      return false;
    } finally {
      state.sharedTierMovesLoading = false;
    }
  }

  async function saveSharedTierMoves(action = "replace") {
    if (typeof fetch !== "function") return { ok: false, configured: false, error: "fetch is unavailable" };
    const buildHeaders = () => {
      const headers = { "Content-Type": "application/json; charset=utf-8" };
      const token = tierMoveAdminToken();
      if (token) headers["X-Tier-Move-Token"] = token;
      return headers;
    };
    const requestBody = JSON.stringify(tierMovePayload(action));
    try {
      let response = await fetch(TIER_SHARED_MOVES_API, {
        method: "POST",
        headers: buildHeaders(),
        body: requestBody
      });
      if (response.status === 401 && requestTierMoveAdminToken()) {
        response = await fetch(TIER_SHARED_MOVES_API, {
          method: "POST",
          headers: buildHeaders(),
          body: requestBody
        });
      }
      const payload = await response.json().catch(() => ({}));
      state.sharedTierMovesConfigured = Boolean(payload.configured);
      if (!payload.configured) {
        return { ok: false, configured: false, error: "shared tier write is not configured" };
      }
      if (!response.ok || payload.ok === false) {
        return { ok: false, configured: true, error: payload.error || `HTTP ${response.status}` };
      }
      if (Array.isArray(payload.moves)) {
        state.manualTierMoves = manualTierMovesFromRecords(payload.moves);
        persistManualTierMoves();
        renderAfterTierMoveSync();
      }
      return { ok: true, configured: true };
    } catch (error) {
      return { ok: false, configured: state.sharedTierMovesConfigured, error: error.message || String(error) };
    }
  }

  function defineTierRowMeta(row, key, sourceTier, currentTier) {
    Object.defineProperties(row, {
      __tierRowKey: { value: key, enumerable: false, configurable: true },
      __sourceTierName: { value: sourceTier, enumerable: false, configurable: true },
      __tierName: { value: currentTier, enumerable: false, configurable: true }
    });
    return row;
  }

  function tierRowBaseKey(row, tierName, index) {
    const merchantId = tierRowMerchantId(row);
    if (merchantId) return `merchant:${merchantId}:${tierName}`;
    const merchantName = normalize(tierRowMerchantName(row));
    if (merchantName) return `row:${tierName}:${merchantName}`;
    return `row:${tierName}:${index}:unknown`;
  }

  function cloneTierRow(row, key, sourceTier, currentTier) {
    return defineTierRowMeta({ ...row }, key, sourceTier, currentTier);
  }

  function cacheOriginalTierSheetRows() {
    TIER_SHEET_MOVE_TARGETS.forEach((tierName) => {
      const sheet = sheetByName(tierName);
      if (!sheet || !Array.isArray(sheet.rows)) return;
      const rows = sheet.rows.map((row, index) => {
        const key = tierRowBaseKey(row, tierName, index);
        const copy = cloneTierRow(row, key, tierName, tierName);
        originalTierSheetRowIndex.set(key, { sourceTier: tierName, row: copy });
        return copy;
      });
      originalTierSheetRows.set(tierName, rows);
    });
  }

  function tierReportRange(startDate, endDate) {
    const start = String(startDate || "").trim();
    const end = String(endDate || "").trim();
    const first = start || end;
    const last = end || start;
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!first || !last) return { ok: false, error: "Choose a date or date range." };
    if (!isoDatePattern.test(first) || !isoDatePattern.test(last)) {
      return { ok: false, error: "Use a valid date." };
    }
    const firstDate = new Date(`${first}T00:00:00`);
    const lastDate = new Date(`${last}T00:00:00`);
    if (Number.isNaN(firstDate.getTime()) || Number.isNaN(lastDate.getTime())) {
      return { ok: false, error: "Use a valid date." };
    }
    if (firstDate > lastDate) return { ok: false, error: "Start date must be before end date." };
    const days = Math.round((lastDate - firstDate) / 86400000) + 1;
    if (days > 366) return { ok: false, error: "Date range cannot exceed 366 days." };
    return { ok: true, startDate: first, endDate: last, days };
  }

  function tierReportKey(tierName, startDate = state.tierReport.startDate, endDate = state.tierReport.endDate) {
    return `${tierName}:${startDate}:${endDate}`;
  }

  function tierReportDependencyTiers(tierName, moves = state.manualTierMoves) {
    const dependencies = new Set([tierName]);
    Object.values(moves || {}).forEach((move) => {
      const sourceTier = canonicalTierName(move && move.sourceTier);
      const targetTier = canonicalTierName(move && move.targetTier);
      if (targetTier === tierName && isTierMoveTarget(sourceTier)) dependencies.add(sourceTier);
    });
    return Array.from(dependencies);
  }

  function tierReportRangeLabel(startDate, endDate) {
    return startDate === endDate ? startDate : `${startDate} – ${endDate}`;
  }

  function cacheOriginalTierSheetRowsForTier(tierName, rows) {
    Array.from(originalTierSheetRowIndex.entries()).forEach(([key, value]) => {
      if (value && value.sourceTier === tierName) originalTierSheetRowIndex.delete(key);
    });
    const cachedRows = (rows || []).map((row, index) => {
      const key = tierRowBaseKey(row, tierName, index);
      const copy = cloneTierRow(row, key, tierName, tierName);
      originalTierSheetRowIndex.set(key, { sourceTier: tierName, row: copy });
      return copy;
    });
    originalTierSheetRows.set(tierName, cachedRows);
  }

  function activateTierReportPayload(tierName, key, payload) {
    if (!payload || state.tierReport.activeKeys.get(tierName) === key) return;
    let sheet = sheetByName(tierName);
    if (!sheet) {
      sheet = { name: tierName, title: tierName, headers: [], rows: [] };
      sheetReport.sheets = sheetReport.sheets || [];
      sheetReport.sheets.push(sheet);
    }
    sheetReport.tierSheets = sheetReport.tierSheets || [];
    if (!sheetReport.tierSheets.includes(tierName)) sheetReport.tierSheets.push(tierName);
    sheet.title = tierName;
    const existingRows = originalTierSheetRows.get(tierName) || sheet.rows || [];
    const existingByMerchant = new Map(existingRows.map((row) => [tierRowMerchantId(row), row]));
    sheet.rows = Array.isArray(payload.rows)
      ? payload.rows.map((row) => ({ ...(existingByMerchant.get(tierRowMerchantId(row)) || {}), ...row }))
      : [];
    sheet.headers = Array.from(new Set([
      ...((sheet.headers || []).filter((header) => !REMOVED_TIER_REVENUE_HEADERS.has(header) && !LIVE_TIER_METRIC_HEADERS.has(header))),
      ...(payload.headers || [])
    ]));
    sheet.reportRange = { startDate: payload.startDate, endDate: payload.endDate };
    sheet.reportSource = payload.source || {};
    cacheOriginalTierSheetRowsForTier(tierName, sheet.rows);
    applyManualTierMoves();
    state.tierReport.activeKeys.set(tierName, key);
  }

  async function loadTierReport(tierName, startDate, endDate) {
    const key = tierReportKey(tierName, startDate, endDate);
    if (state.tierReport.payloads.has(key) || state.tierReport.loadingKeys.has(key)) return;
    state.tierReport.loadingKeys.add(key);
    state.tierReport.errors.delete(key);
    if (state.page === "tier" && state.selectedTierPage === tierName) renderTierPage(tierName);
    try {
      const params = new URLSearchParams({ tier: tierName, start_date: startDate, end_date: endDate, compact: "1" });
      const response = await fetch(`${DB_TIER_SHEET_UI_API}?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin"
      });
      const payload = await response.json();
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(payload && payload.error ? payload.error : `Request failed (${response.status})`);
      }
      if (payload.startDate !== startDate || payload.endDate !== endDate) {
        throw new Error("Database returned a different date range.");
      }
      state.tierReport.payloads.set(key, payload);
    } catch (error) {
      state.tierReport.errors.set(key, error && error.message ? error.message : String(error));
    } finally {
      state.tierReport.loadingKeys.delete(key);
      const selectedTier = state.selectedTierPage;
      if (
        state.page === "tier"
        && key === tierReportKey(tierName)
        && tierReportDependencyTiers(selectedTier).includes(tierName)
      ) {
        renderTierPage(selectedTier);
      }
    }
  }

  function setTierReportControls(tierName) {
    const isLiveTier = STANDARD_CATEGORY_REPORT_TIERS.includes(tierName);
    const key = tierReportKey(tierName);
    const loading = state.tierReport.loadingKeys.has(key);
    const error = state.tierReport.errors.get(key) || "";
    els.tierStartDate.value = state.tierReport.startDate;
    els.tierEndDate.value = state.tierReport.endDate;
    els.tierStartDate.disabled = !isLiveTier || loading;
    els.tierEndDate.disabled = !isLiveTier || loading;
    els.tierDateApply.disabled = !isLiveTier || loading;
    els.tierDateStatus.classList.toggle("loading", loading);
    els.tierDateStatus.classList.toggle("error", Boolean(error));
    if (!isLiveTier) {
      els.tierDateStatus.textContent = "Date range is available for Tier 1–4.";
    } else if (loading) {
      els.tierDateStatus.textContent = "Loading YeahPromos data…";
    } else if (error) {
      els.tierDateStatus.textContent = error;
    } else if (state.tierReport.payloads.has(key)) {
      els.tierDateStatus.textContent = `${tierReportRangeLabel(state.tierReport.startDate, state.tierReport.endDate)} · YeahPromos DB`;
    } else {
      els.tierDateStatus.textContent = "Choose one date or an inclusive range.";
    }
  }

  function applyTierReportDateRange() {
    const range = tierReportRange(els.tierStartDate.value, els.tierEndDate.value);
    if (!range.ok) {
      els.tierDateStatus.textContent = range.error;
      els.tierDateStatus.classList.add("error");
      return;
    }
    state.tierReport.startDate = range.startDate;
    state.tierReport.endDate = range.endDate;
    resetTierTablePage("Tier 4");
    state.tierReport.errors.delete(tierReportKey(state.selectedTierPage));
    els.tierStartDate.value = range.startDate;
    els.tierEndDate.value = range.endDate;
    state.selectedTierRowKeys.clear();
    setTierMoveStatus("");
    renderTierPage(state.selectedTierPage);
  }

  function addTierRowToBucket(rowsByTier, keysByTier, tierName, row) {
    const key = row.__tierRowKey || tierRowBaseKey(row, tierName, rowsByTier.get(tierName).length);
    const keys = keysByTier.get(tierName);
    if (keys.has(key)) return false;
    keys.add(key);
    rowsByTier.get(tierName).push(row);
    return true;
  }

  function rekeyManualTierMoves() {
    const currentMoves = state.manualTierMoves || {};
    const nextMoves = {};
    let changed = false;
    Object.entries(currentMoves).forEach(([key, move]) => {
      const resolvedKey = originalTierSheetRowIndex.has(key)
        ? key
        : originalMoveKeyForRecord({ ...move, key: "" });
      if (!resolvedKey) {
        changed = true;
        return;
      }
      const original = originalTierSheetRowIndex.get(resolvedKey);
      nextMoves[resolvedKey] = {
        ...move,
        sourceTier: original.sourceTier,
        merchantId: String(move.merchantId || tierRowMerchantId(original.row) || "").trim(),
        merchantName: String(move.merchantName || tierRowMerchantName(original.row) || "").trim()
      };
      if (resolvedKey !== key) changed = true;
    });
    state.manualTierMoves = nextMoves;
    return changed;
  }

  function applyManualTierMoves() {
    const rowsByTier = new Map(TIER_SHEET_MOVE_TARGETS.map((tierName) => [tierName, []]));
    const keysByTier = new Map(TIER_SHEET_MOVE_TARGETS.map((tierName) => [tierName, new Set()]));
    let movesChanged = rekeyManualTierMoves();

    originalTierSheetRows.forEach((rows, tierName) => {
      rows.forEach((row) => {
        const key = row.__tierRowKey;
        const move = state.manualTierMoves[key];
        if (move && isTierMoveTarget(move.targetTier) && move.targetTier !== tierName) return;
        addTierRowToBucket(rowsByTier, keysByTier, tierName, cloneTierRow(row, key, tierName, tierName));
      });
    });

    Object.entries(state.manualTierMoves).forEach(([key, move]) => {
      const original = originalTierSheetRowIndex.get(key);
      if (!original || !isTierMoveTarget(move.targetTier)) {
        delete state.manualTierMoves[key];
        movesChanged = true;
        return;
      }
      if (move.targetTier === original.sourceTier) return;
      addTierRowToBucket(rowsByTier, keysByTier, move.targetTier, cloneTierRow(original.row, key, original.sourceTier, move.targetTier));
    });

    TIER_SHEET_MOVE_TARGETS.forEach((tierName) => {
      const sheet = sheetByName(tierName);
      if (sheet) sheet.rows = rowsByTier.get(tierName) || [];
    });
    applyManualTierMovesToOffers();
    if (movesChanged) persistManualTierMoves();
  }

  function applyManualTierMovesToOffers() {
    offers.forEach((offer, index) => {
      offer.tier = originalOfferTiers[index] || "";
    });
    Object.entries(state.manualTierMoves || {}).forEach(([key, move]) => {
      if (!move || !isTierMoveTarget(move.targetTier)) return;
      const original = originalTierSheetRowIndex.get(key);
      const merchantId = move.merchantId || (original && tierRowMerchantId(original.row));
      if (!merchantId) return;
      (offerGroupsByMerchantId.get(merchantId) || []).forEach((offer) => {
        offer.tier = move.targetTier;
      });
    });
  }

  function hasManualTierMoves() {
    return Object.keys(state.manualTierMoves || {}).length > 0;
  }

  function compactUnique(values) {
    const seen = new Set();
    return values.map((value) => String(value || "").trim()).filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  }

  function tierLogicItems(sheet) {
    const rows = sheet.introRows || [];
    const textRows = rows.map((row) => compactUnique(row)).filter((row) => row.length);
    const title = textRows[0] && textRows[0][0] ? textRows[0][0] : sheet.title || sheet.name;
    const description = textRows[1] && textRows[1][0] ? textRows[1][0] : "";
    const excluded = new Set(["brand count", "total clicks", "order count", "revenue", "avg conversion", "objective", "target", "logic:", "phase:"]);
    const summaryValues = new Set((sheet.summaryCards || []).map((card) => String(card.value || "").trim().toLowerCase()).filter(Boolean));
    const details = [];
    textRows.slice(2).forEach((row) => {
      const useful = row.filter((value) => {
        const lower = value.toLowerCase();
        if (excluded.has(lower)) return false;
        if (summaryValues.has(lower)) return false;
        if (/^\$?[\d,.]+%?$/.test(value)) return false;
        return true;
      });
      if (useful.length) details.push(useful.join(" / "));
    });
    return { title, description, details: compactUnique(details).map(summarizeLogicText).slice(0, 5) };
  }

  function summarizeLogicText(value) {
    let text = String(value || "")
      .replace(/\(Steady sales made over the past 3 months\)/gi, "")
      .replace(/\(Sales is growing over the past 3 months\)/gi, "")
      .replace(/\(Sales is declining over the past 3 months\)/gi, "")
      .replace(/Newly added coming from Tier 3 -> Tier 2/gi, "New from Tier 3")
      .replace(/Newly added coming from Tier 4 -> Tier 3/gi, "New from Tier 4")
      .replace(/Newly added coming from Tier 2 -> Tier 3/gi, "Moved from Tier 2")
      .replace(/Need to add more publisher to try it out and optimize/gi, "Add publishers and optimize")
      .replace(/Need to add optimize and add more publisher to try it out since it is in declining phase \(Potentially moving to Tier 3 in the upcoming months\)/gi, "Optimize publishers; monitor Tier 3 risk")
      .replace(/Need to add optimize and add more publisher to try it out since it is in declining phase/gi, "Optimize publishers; monitor risk")
      .replace(/\s*\/\s*/g, " · ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 150 ? `${text.slice(0, 147).trim()}...` : text;
  }

  function renderTierLogicSummary(sheet) {
    const logic = tierLogicItems(sheet);
    const detailHtml = logic.details.length
      ? `<div class="logic-list">${logic.details.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
      : "";
    return `<div class="logic-summary">
      <div>
        <strong>${escapeHtml(logic.title)}</strong>
        <p>${escapeHtml(logic.description || "Tier assignments and metadata are loaded from the offer database.")}</p>
      </div>
      ${detailHtml}
    </div>`;
  }

  function renderTierSummary(sheet) {
    const rows = sheet.rows || [];
    const objective = (sheet.summaryCards || []).find((card) => String(card.label || "").toLowerCase() === "objective");
    const cards = isTierDataSheet(sheet)
      ? [
          { label: "Brand Count", value: rows.length.toLocaleString() },
          { label: "Total Clicks", value: rows.reduce((sum, row) => sum + tierRowClicks(row), 0).toLocaleString() },
          { label: "Order Count", value: rows.reduce((sum, row) => sum + tierRowOrders(row), 0).toLocaleString() },
          { label: "Revenue", value: shortMoney(rows.reduce((sum, row) => sum + tierRowRevenue(row), 0)) },
          {
            label: "Avg Conversion",
            value: shortPct(rows.reduce((sum, row) => sum + tierRowClicks(row), 0)
              ? rows.reduce((sum, row) => sum + tierRowOrders(row), 0) / rows.reduce((sum, row) => sum + tierRowClicks(row), 0)
              : 0)
          },
          ...(objective ? [objective] : [])
        ]
      : [
          { label: "Rows", value: String(rows.length) },
          { label: "Columns", value: String((sheet.headers || []).length) }
        ];
    els.tierPageSummary.innerHTML = cards.map((card) => (
      `<div class="metric"><span>${escapeHtml(labelText(card.label))}</span><strong>${escapeHtml(card.value)}</strong></div>`
    )).join("");
  }

  function columnLabel(index) {
    let label = "";
    let value = index + 1;
    while (value > 0) {
      const remainder = (value - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      value = Math.floor((value - 1) / 26);
    }
    return label;
  }

  function tierRowSelectionKey(row) {
    return row && (row.__tierRowKey || tierRowBaseKey(row, state.selectedTierPage, 0));
  }

  function pruneTierSelectionToVisible() {
    const visible = new Set(state.visibleTierRowKeys || []);
    Array.from(state.selectedTierRowKeys).forEach((key) => {
      if (!visible.has(key)) state.selectedTierRowKeys.delete(key);
    });
  }

  function tierSelectionHeaderHtml() {
    return `<th class="tier-select-cell"><input class="tier-row-checkbox" type="checkbox" data-tier-select-all aria-label="Select all visible merchants" /></th>`;
  }

  function tierSelectionCellHtml(row) {
    const key = tierRowSelectionKey(row);
    const checked = state.selectedTierRowKeys.has(key) ? " checked" : "";
    const merchantName = tierRowMerchantName(row) || tierRowMerchantId(row) || "merchant";
    return `<td class="tier-select-cell"><input class="tier-row-checkbox" type="checkbox" data-tier-select-row="${escapeHtml(key)}" aria-label="Select ${escapeHtml(merchantName)}" ${checked} /></td>`;
  }

  function setTierMoveStatus(message) {
    state.tierMoveStatus = message || "";
    if (els.tierMoveInlineStatus) els.tierMoveInlineStatus.textContent = state.tierMoveStatus;
    if (els.tierMoveStatus) els.tierMoveStatus.textContent = state.tierMoveStatus;
  }

  function syncTierBulkControls() {
    const visibleKeys = state.visibleTierRowKeys || [];
    const visibleSet = new Set(visibleKeys);
    const visibleSelectedCount = visibleKeys.filter((key) => state.selectedTierRowKeys.has(key)).length;
    const totalSelectedCount = state.selectedTierRowKeys.size;

    if (els.tierMoveSelected) {
      els.tierMoveSelected.disabled = totalSelectedCount === 0;
      els.tierMoveSelected.textContent = t("action.move", "Move");
      els.tierMoveSelected.setAttribute("aria-label", totalSelectedCount ? `Move ${totalSelectedCount.toLocaleString()} selected merchants` : "Move selected merchants");
    }
    if (els.tierResetMoves) {
      els.tierResetMoves.classList.toggle("hidden", !hasManualTierMoves());
    }
    if (els.tierSheetHead) {
      const allCheckbox = els.tierSheetHead.querySelector("[data-tier-select-all]");
      if (allCheckbox) {
        allCheckbox.checked = Boolean(visibleKeys.length && visibleSelectedCount === visibleKeys.length);
        allCheckbox.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleKeys.length;
        allCheckbox.disabled = visibleKeys.length === 0;
      }
    }
    if (els.tierSheetRows) {
      els.tierSheetRows.querySelectorAll("[data-tier-select-row]").forEach((checkbox) => {
        const key = checkbox.dataset.tierSelectRow || "";
        checkbox.checked = state.selectedTierRowKeys.has(key);
        checkbox.disabled = !visibleSet.has(key);
      });
    }
  }

  function tierTablePagination(rows, page, pageSize = TIER_TABLE_PAGE_SIZE) {
    const allRows = Array.isArray(rows) ? rows : [];
    const safePageSize = Math.max(1, Number(pageSize) || TIER_TABLE_PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(allRows.length / safePageSize));
    const currentPage = Math.min(totalPages, Math.max(1, Number(page) || 1));
    const startIndex = (currentPage - 1) * safePageSize;
    const endIndex = Math.min(allRows.length, startIndex + safePageSize);
    return {
      page: currentPage,
      pageSize: safePageSize,
      totalPages,
      totalRows: allRows.length,
      startIndex,
      endIndex,
      rows: allRows.slice(startIndex, endIndex)
    };
  }

  function renderTierPagination(tierName, pagination) {
    const visible = tierName === "Tier 4" && Boolean(pagination);
    els.tierPagination.classList.toggle("hidden", !visible);
    if (!visible) return;
    els.tierPageIndicator.textContent = `Page ${pagination.page.toLocaleString()} of ${pagination.totalPages.toLocaleString()}`;
    els.tierPagePrev.disabled = pagination.page <= 1;
    els.tierPageNext.disabled = pagination.page >= pagination.totalPages;
  }

  function changeTierTablePage(delta) {
    const tierName = state.selectedTierPage;
    if (tierName !== "Tier 4") return;
    const currentPage = Number(state.tierTablePages[tierName]) || 1;
    state.tierTablePages[tierName] = Math.max(1, currentPage + delta);
    state.selectedTierRowKeys.clear();
    setTierMoveStatus("");
    renderTierPage(tierName);
  }

  function resetTierTablePage(tierName = state.selectedTierPage) {
    state.tierTablePages[tierName] = 1;
  }

  function renderSheetTable(sheet, titleEl, countEl, headEl, rowsEl, customRows = null, paginationOptions = null) {
    const headers = sheet.headers || [];
    const allDisplayHeaders = displayHeadersForSheet(sheet, headers);
    const displayHeaders = visibleHeadersForSheet(sheet, allDisplayHeaders);
    const sourceRows = customRows || sheet.rows || [];
    const sortedRows = headers.length
      ? sortReportRows(sourceRows, state.tierSheetSort, (row, key) => row[key])
      : sourceRows;
    const pagination = paginationOptions
      ? tierTablePagination(sortedRows, paginationOptions.page, paginationOptions.pageSize)
      : null;
    const rows = pagination ? pagination.rows : sortedRows;
    const grid = sheet.grid || [];
    const selectable = isTierDataSheet(sheet);
    titleEl.textContent = `${sheet.name} ${t("sheet.targetRecords", "Sheet Records")}`;
    if (headers.length) {
      renderTierColumnPanel(sheet, allDisplayHeaders, displayHeaders);
      const table = headEl.closest("table");
      if (table) {
        table.style.minWidth = displayHeaders.length <= 8
          ? "100%"
          : `${Math.min(2600, Math.max(1200, displayHeaders.length * 130))}px`;
      }
      state.visibleTierRowKeys = selectable ? rows.map(tierRowSelectionKey) : [];
      if (selectable) pruneTierSelectionToVisible();
      if (pagination) state.tierTablePages[sheet.name] = pagination.page;
      renderTierPagination(sheet.name, pagination);
      const renderedLabel = pagination
        ? ` / showing ${pagination.totalRows ? pagination.startIndex + 1 : 0}–${pagination.endIndex} on page ${pagination.page}`
        : "";
      countEl.textContent = `${sortedRows.length.toLocaleString()} rows${renderedLabel} / ${displayHeaders.length.toLocaleString()} of ${allDisplayHeaders.length.toLocaleString()} columns`;
      headEl.innerHTML = `<tr>${selectable ? tierSelectionHeaderHtml() : ""}${displayHeaders.map((header) => sortableHeaderHtml(header, state.tierSheetSort, "tier")).join("")}</tr>`;
      rowsEl.innerHTML = rows.map((row) => (
        `<tr class="${escapeHtml(tierRowClass(sheet, row))}" data-tier-row-key="${escapeHtml(tierRowSelectionKey(row))}">${selectable ? tierSelectionCellHtml(row) : ""}${displayHeaders.map((header) => `<td>${sheetCellHtml(sheet, row, header)}</td>`).join("")}</tr>`
      )).join("");
      syncTierBulkControls();
      return;
    }

    renderTierColumnPanel(sheet, [], []);
    renderTierPagination(sheet.name, null);
    state.visibleTierRowKeys = [];
    state.selectedTierRowKeys.clear();
    renderTierColumnPanel(sheet, [], []);
    const maxCols = grid.reduce((max, row) => Math.max(max, row.length), 0);
    countEl.textContent = `${grid.length.toLocaleString()} rows / ${maxCols.toLocaleString()} columns`;
    headEl.innerHTML = maxCols
      ? `<tr>${Array.from({ length: maxCols }, (_, index) => `<th>${columnLabel(index)}</th>`).join("")}</tr>`
      : "";
    rowsEl.innerHTML = grid.map((row) => (
      `<tr>${Array.from({ length: maxCols }, (_, index) => `<td>${escapeHtml(row[index] || "")}</td>`).join("")}</tr>`
    )).join("");
    syncTierBulkControls();
  }

  function tier2PhaseKind(sheet, row) {
    if (!sheet || sheet.name !== "Tier 2") return "";
    const phase = String(row.Phase || "").trim().toLowerCase();
    if (phase.includes("growing")) return "green";
    if (phase.includes("stable")) return "yellow";
    if (phase.includes("declining")) return "red";
    return "";
  }

  function normalizeVisualStatusColor(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return null;
    if (["green", "yellow", "red"].includes(text)) return text;
    if (["none", "neutral", "no color", "no-color", "clear"].includes(text)) return "";
    return null;
  }

  function firstPresentRowValue(row, keys) {
    if (!row) return "";
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null && String(row[key]).trim() !== "") {
        return row[key];
      }
    }
    return "";
  }

  function explicitVisualStatusColor(row) {
    if (!row) return null;
    const nestedColor = row.visualStatus && typeof row.visualStatus === "object" ? row.visualStatus.color : "";
    const color = normalizeVisualStatusColor(nestedColor || firstPresentRowValue(row, TIER_VISUAL_STATUS_COLOR_KEYS));
    return color;
  }

  function tierRowRuleHighlightKind(sheet, row) {
    // Colors are stored in the database/Sheet and must not be inferred by the UI.
    return "";
  }

  function visualStatusForTierRow(sheet, row) {
    const explicitColor = explicitVisualStatusColor(row);
    if (explicitColor !== null) {
      return {
        color: explicitColor,
        code: firstPresentRowValue(row, TIER_VISUAL_STATUS_CODE_KEYS),
        reason: firstPresentRowValue(row, TIER_VISUAL_STATUS_REASON_KEYS),
        source: firstPresentRowValue(row, TIER_VISUAL_STATUS_SOURCE_KEYS) || "manual"
      };
    }
    return { color: "", code: "", reason: "", source: "" };
  }

  function displayHeadersForSheet(sheet, headers) {
    if (!sheet || !(sheetReport.tierSheets || []).includes(sheet.name)) return headers || [];
    if (sheet.name !== "Tier 1") return headers || [];
    const desired = ["Completion Rate"];
    const output = [];
    (headers || []).forEach((header) => {
      if (desired.includes(header)) return;
      output.push(header);
      if (header === "Order count") {
        desired.forEach((extra) => {
          if ((headers || []).includes(extra)) output.push(extra);
        });
      }
    });
    return output;
  }

  function selectedHeadersForTierSheet(sheetName, headers) {
    const saved = state.tierVisibleColumns[sheetName];
    if (!Array.isArray(saved)) return [];
    return saved.filter((header) => headers.includes(header));
  }

  function defaultTierHeadersForSheet(sheet, headers) {
    const allHeaders = headers || [];
    if (!sheet || !(sheetReport.tierSheets || []).includes(sheet.name)) return allHeaders;
    const available = new Set(allHeaders);
    const selected = [];
    DEFAULT_TIER_VISIBLE_COLUMNS.forEach((preferredHeader) => {
      const candidates = DEFAULT_TIER_COLUMN_ALIASES[preferredHeader] || [preferredHeader];
      const matchedHeader = candidates.find((header) => available.has(header));
      if (matchedHeader && !selected.includes(matchedHeader)) selected.push(matchedHeader);
    });
    return selected.length ? selected : allHeaders;
  }

  function visibleHeadersForSheet(sheet, headers) {
    const allHeaders = headers || [];
    if (!sheet || !(sheetReport.tierSheets || []).includes(sheet.name)) return allHeaders;
    const selected = selectedHeadersForTierSheet(sheet.name, allHeaders);
    return selected.length ? selected : defaultTierHeadersForSheet(sheet, allHeaders);
  }

  function coreHeadersForSheet(sheet, headers) {
    return defaultTierHeadersForSheet(sheet, headers);
  }

  function setTierVisibleHeaders(sheet, headers) {
    if (!sheet || !headers.length) return;
    state.tierVisibleColumns[sheet.name] = headers;
    saveTierVisibleColumns();
    renderTierPage(state.selectedTierPage);
  }

  function resetTierVisibleHeaders(sheet) {
    if (!sheet) return;
    delete state.tierVisibleColumns[sheet.name];
    saveTierVisibleColumns();
    renderTierPage(state.selectedTierPage);
  }

  function renderTierColumnPanel(sheet, allHeaders, visibleHeaders) {
    if (!els.tierColumnList || !els.tierColumnPanel || !els.tierColumnToggle) return;
    if (!sheet || !allHeaders.length) {
      els.tierColumnList.innerHTML = "";
      els.tierColumnPanel.classList.add("hidden");
      els.tierColumnToggle.setAttribute("aria-expanded", "false");
      return;
    }
    const visible = new Set(visibleHeaders);
    const pickerHeaders = [
      ...visibleHeaders,
      ...allHeaders.filter((header) => !visible.has(header))
    ];
    els.tierColumnList.innerHTML = pickerHeaders.map((header) => {
      const id = `tier-column-${safeFilePart(sheet.name)}-${safeFilePart(header)}`;
      return `<label class="column-check" for="${escapeHtml(id)}">
        <input id="${escapeHtml(id)}" type="checkbox" value="${escapeHtml(header)}"${visible.has(header) ? " checked" : ""} />
        <span>${escapeHtml(labelText(header))}</span>
      </label>`;
    }).join("");
    els.tierColumnPanel.classList.toggle("hidden", !state.tierColumnPanelOpen);
    els.tierColumnToggle.setAttribute("aria-expanded", state.tierColumnPanelOpen ? "true" : "false");
  }

  function offerForSheetRow(row) {
    return offerForMerchant(rowValue(row, ["Merchant ID", "Merchant Id", "merchantId"]), rowValue(row, ["Merchant Name", "Brand", "brand"]));
  }

  function sheetNameMatchesTier(sheetName, tier) {
    return canonicalTierName(sheetName) === canonicalTierName(tier);
  }

  function sheetRowKey(row) {
    const merchantId = String(rowValue(row, ["Merchant ID", "Merchant Id", "merchantId"]) || "").trim();
    return merchantId || normalize(rowValue(row, ["Merchant Name", "Brand", "brand"]));
  }

  function offerToTierSheetRow(offer, sheet) {
    const row = { _tierOverrideRow: true, _offerKey: offerKey(offer) };
    (sheet.headers || []).forEach((header) => {
      if (header === "Original Rank") row[header] = offer.originalRank || "";
      else if (header === "Merchant ID") row[header] = offer.merchantId || "";
      else if (header === "Merchant Name") row[header] = offer.brand || "";
      else if (header === "Agency" || header === "Network") row[header] = offer.network || "";
      else if (header === "Clicks") row[header] = number(offer.clicks).toLocaleString();
      else if (header === "Conversion") row[header] = shortPct(offer.conversionRate);
      else if (header === "DPV") row[header] = number(offer.dpv).toLocaleString();
      else if (header === "ATC") row[header] = number(offer.atc).toLocaleString();
      else if (header === "Order count") row[header] = number(offer.orders).toLocaleString();
      else if (header === "Backend EPC" || header === "EPC") row[header] = shortEpc(offer.epc);
      else if (header === "Revenue") row[header] = shortMoney(offer.salesAmount);
      else if (header === "Completion Rate") row[header] = shortPct(offer.completionRate);
      else if (header === "Payment Cycle") row[header] = offer.paymentCycle ? `${offer.paymentCycle}` : "";
      else if (header === "Asins") row[header] = offer.asinsText || (offer.topAsins || []).join(", ");
      else if (header === "COUNTRY" || header === "Country") row[header] = offer.country || "";
      else if (header === "Tier Reason" || header === "Reason") row[header] = `${t("move.movedFrom", "Moved from")} ${optionText(offer.originalTier || "Unknown")}`;
      else if (header === "Recommendation") row[header] = offer.recommendation || recommendedAction(offer);
      else if (header === "Visual Status Color") row[header] = offer.visualStatusColor || "";
      else if (header === "Visual Status Code") row[header] = offer.visualStatusCode || "";
      else if (header === "Visual Status Reason") row[header] = offer.visualStatusReason || "";
      else if (header === "Visual Status Source") row[header] = offer.visualStatusSource || "";
      else row[header] = offer[header] || "";
    });
    ["visualStatusColor", "visualStatusCode", "visualStatusReason", "visualStatusSource"].forEach((key) => {
      if (offer[key] !== undefined) row[key] = offer[key];
    });
    return row;
  }

  function tierSheetRowsForDisplay(sheet) {
    if (!sheet || !(sheet.headers || []).length) return sheet ? (sheet.rows || []) : [];
    const sheetTier = canonicalTierName(sheet.name);
    const keptRows = [];
    const rowKeys = new Set();

    (sheet.rows || []).forEach((row) => {
      const offer = offerForSheetRow(row);
      if (offer && offer.tierOverride && !sheetNameMatchesTier(sheetTier, offer.tier)) return;
      keptRows.push(row);
      const key = sheetRowKey(row);
      if (key) rowKeys.add(key);
    });

    offers
      .filter((offer) => offer.tierOverride && sheetNameMatchesTier(sheetTier, offer.tier))
      .forEach((offer) => {
        const key = String(offer.merchantId || "").trim() || normalize(offer.brand);
        if (key && rowKeys.has(key)) return;
        keptRows.push(offerToTierSheetRow(offer, sheet));
      });

    return keptRows;
  }

  function tierReasonText(row) {
    return String(row["Tier Reason"] || row.Reason || row.Recommendation || "").trim();
  }

  function tierRowHighlightKind(sheet, row) {
    return visualStatusForTierRow(sheet, row).color || "";
  }

  function tierRowClass(sheet, row) {
    if (row && row._tierOverrideRow) return "tier-highlight-row tier-highlight-green";
    const kind = tierRowHighlightKind(sheet, row);
    return kind ? `tier-highlight-row tier-highlight-${kind}` : "";
  }

  function sheetCellHtml(sheet, row, header) {
    const value = formatSheetCell(header, row[header]);
    if (header === "Visual Status Color" || header === "visualStatusColor") {
      const color = normalizeVisualStatusColor(value);
      if (!color || !value) return escapeHtml(value);
      return `<span class="phase-pill phase-${escapeHtml(color)}">${escapeHtml(value)}</span>`;
    }
    const kind = header === "Phase" ? tier2PhaseKind(sheet, row) : "";
    if (!kind || !value) return escapeHtml(value);
    return `<span class="phase-pill phase-${escapeHtml(kind)}">${escapeHtml(value)}</span>`;
  }

  function renderTierSheetTable(sheet) {
    renderSheetTable(sheet, els.tierTableTitle, els.tierTableCount, els.tierSheetHead, els.tierSheetRows, getFilteredTierSheetRows(sheet));
  }

  function canExpandTierSheet(tierName = state.selectedTierPage) {
    return TIER_SHEET_EXPANDABLE_TIERS.has(tierName);
  }

  function syncTierSheetOverlay() {
    const open = Boolean(state.expandedTierSheet) && canExpandTierSheet() && state.page === "tier";
    if (state.expandedTierSheet && !open) state.expandedTierSheet = false;
    document.body.classList.toggle("sheet-expanded-open", open);
    if (els.sheetExpandedBackdrop) {
      els.sheetExpandedBackdrop.setAttribute("aria-hidden", open ? "false" : "true");
    }
    if (els.tierTablePanel) {
      els.tierTablePanel.classList.toggle("sheet-expanded-panel", open);
      if (open) {
        els.tierTablePanel.setAttribute("role", "dialog");
        els.tierTablePanel.setAttribute("aria-modal", "true");
      } else {
        els.tierTablePanel.removeAttribute("role");
        els.tierTablePanel.removeAttribute("aria-modal");
      }
    }
    const available = canExpandTierSheet() && state.page === "tier";
    if (els.tierExpand) {
      els.tierExpand.classList.toggle("hidden", !available || open);
      els.tierExpand.disabled = !available;
      els.tierExpand.setAttribute("aria-expanded", open ? "true" : "false");
    }
    if (els.tierOverlayClose) {
      els.tierOverlayClose.classList.toggle("hidden", !open);
    }
  }

  function openTierSheetOverlay() {
    if (!canExpandTierSheet()) return;
    state.expandedTierSheet = true;
    syncTierSheetOverlay();
    window.requestAnimationFrame(() => {
      if (els.tierOverlayClose) els.tierOverlayClose.focus();
    });
  }

  function closeTierSheetOverlay({ restoreFocus = true } = {}) {
    const wasOpen = Boolean(state.expandedTierSheet);
    state.expandedTierSheet = false;
    syncTierSheetOverlay();
    if (restoreFocus && wasOpen && els.tierExpand && !els.tierExpand.classList.contains("hidden")) {
      els.tierExpand.focus();
    }
  }

  function selectedTierRows(sheet) {
    const selected = state.selectedTierRowKeys;
    return ((sheet && sheet.rows) || []).filter((row) => selected.has(tierRowSelectionKey(row)));
  }

  function defaultTierMoveTarget() {
    return TIER_SHEET_MOVE_TARGETS.find((tierName) => tierName !== state.selectedTierPage) || "";
  }

  function renderTierMoveDialog() {
    if (!els.tierMoveDialog) return;
    const selectedCount = state.selectedTierRowKeys.size;
    const sourceTier = state.selectedTierPage;
    if (!state.tierMoveTarget || state.tierMoveTarget === sourceTier) {
      state.tierMoveTarget = defaultTierMoveTarget();
    }
    if (els.tierMoveSummary) {
      els.tierMoveSummary.textContent = `${selectedCount.toLocaleString()} selected from ${sourceTier}`;
    }
    if (els.tierMoveTargets) {
      els.tierMoveTargets.innerHTML = TIER_SHEET_MOVE_TARGETS.map((tierName) => {
        const current = tierName === sourceTier;
        const active = tierName === state.tierMoveTarget;
        return `<button class="tier-move-target${active ? " active" : ""}" type="button" data-tier-move-target="${escapeHtml(tierName)}"${current ? " disabled" : ""}>
          <span>${escapeHtml(categoryReportTierLabel(tierName))}</span>
          <small>${current ? "Current tier" : `${((sheetByName(tierName) && sheetByName(tierName).rows) || []).length.toLocaleString()} rows`}</small>
        </button>`;
      }).join("");
    }
    if (els.tierMoveConfirm) {
      els.tierMoveConfirm.disabled = !selectedCount || !state.tierMoveTarget || state.tierMoveTarget === sourceTier;
      els.tierMoveConfirm.textContent = state.tierMoveTarget ? `Move to ${categoryReportTierLabel(state.tierMoveTarget)}` : "Move merchants";
    }
    if (els.tierMoveStatus) els.tierMoveStatus.textContent = state.tierMoveStatus || "";
  }

  function openTierMoveDialog() {
    if (!state.selectedTierRowKeys.size || !els.tierMoveDialog) return;
    state.tierMoveTarget = defaultTierMoveTarget();
    renderTierMoveDialog();
    els.tierMoveDialog.classList.remove("hidden");
    document.body.classList.add("tier-move-open");
    window.requestAnimationFrame(() => {
      const active = els.tierMoveTargets && els.tierMoveTargets.querySelector(".tier-move-target.active:not(:disabled)");
      if (active) active.focus();
      else if (els.tierMoveConfirm) els.tierMoveConfirm.focus();
    });
  }

  function closeTierMoveDialog() {
    if (!els.tierMoveDialog) return;
    els.tierMoveDialog.classList.add("hidden");
    document.body.classList.remove("tier-move-open");
    if (els.tierMoveSelected && !els.tierMoveSelected.disabled) els.tierMoveSelected.focus();
  }

  async function moveSelectedTierRows() {
    const sourceTier = state.selectedTierPage;
    const targetTier = state.tierMoveTarget;
    const sheet = sheetByName(sourceTier);
    if (!sheet || !isTierMoveTarget(targetTier) || targetTier === sourceTier || !state.selectedTierRowKeys.size) return;

    const selectedRows = selectedTierRows(sheet);
    let movedCount = 0;
    selectedRows.forEach((row) => {
      const key = tierRowSelectionKey(row);
      const original = originalTierSheetRowIndex.get(key);
      if (!original) return;
      if (targetTier === original.sourceTier) {
        if (state.manualTierMoves[key]) {
          delete state.manualTierMoves[key];
          movedCount += 1;
        }
        return;
      }
      state.manualTierMoves[key] = {
        sourceTier: original.sourceTier,
        targetTier,
        merchantId: tierRowMerchantId(original.row),
        merchantName: tierRowMerchantName(original.row),
        movedAt: localDateKey(new Date())
      };
      movedCount += 1;
    });

    persistManualTierMoves();
    applyManualTierMoves();
    state.selectedTierRowKeys.clear();
    const localMessage = movedCount ? `Moved ${movedCount.toLocaleString()} to ${categoryReportTierLabel(targetTier)}` : "No merchants moved";
    setTierMoveStatus(movedCount ? `${localMessage}; syncing shared data...` : localMessage);
    closeTierMoveDialog();
    renderTierPage(sourceTier);
    renderDashboardCategoryReport();
    if (!movedCount) return;
    const result = await saveSharedTierMoves("replace");
    setTierMoveStatus(result.ok ? `${localMessage}; synced for everyone` : `${localMessage}; local only (${result.error})`);
  }

  async function resetTierMoves() {
    if (!hasManualTierMoves()) return;
    state.manualTierMoves = {};
    state.selectedTierRowKeys.clear();
    persistManualTierMoves();
    applyManualTierMoves();
    setTierMoveStatus("Manual tier moves reset; syncing shared data...");
    renderTierPage(state.selectedTierPage);
    renderDashboardCategoryReport();
    const result = await saveSharedTierMoves("clear");
    setTierMoveStatus(result.ok ? "Manual tier moves reset for everyone" : `Manual tier moves reset locally only (${result.error})`);
  }

  function handleTierSelectionChange(event) {
    const checkbox = event.target.closest("[data-tier-select-all], [data-tier-select-row]");
    if (!checkbox) return;
    setTierMoveStatus("");
    if (checkbox.dataset.tierSelectAll !== undefined) {
      const visibleKeys = state.visibleTierRowKeys || [];
      visibleKeys.forEach((key) => {
        if (checkbox.checked) state.selectedTierRowKeys.add(key);
        else state.selectedTierRowKeys.delete(key);
      });
      syncTierBulkControls();
      return;
    }
    const key = checkbox.dataset.tierSelectRow || "";
    if (!key) return;
    if (checkbox.checked) state.selectedTierRowKeys.add(key);
    else state.selectedTierRowKeys.delete(key);
    syncTierBulkControls();
  }

  function sheetRowUniqueValues(rows, keys) {
    return Array.from(new Set(rows.map((row) => String(rowValue(row, keys) || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function refreshTierSheetFilters(sheet) {
    const rows = tierSheetRowsForDisplay(sheet);
    const currentNetwork = state.tierSheetFilters.network;
    const currentCountry = state.tierSheetFilters.country;
    replaceSelectOptions(els.tierSheetNetwork, "All networks", sheetRowUniqueValues(rows, ["Network", "Agency"]), currentNetwork);
    replaceSelectOptions(els.tierSheetCountry, "All countries", sheetRowUniqueValues(rows, ["COUNTRY", "Country"]), currentCountry);
    state.tierSheetFilters.network = els.tierSheetNetwork.value;
    state.tierSheetFilters.country = els.tierSheetCountry.value;
    els.tierSheetSearch.value = state.tierSheetFilters.search;
    els.tierSheetMinEpc.value = state.tierSheetFilters.minEpc;
    els.tierSheetMinRevenue.value = state.tierSheetFilters.minRevenue;
  }

  function getFilteredTierSheetRows(sheet) {
    const search = normalize(state.tierSheetFilters.search);
    const minEpc = Number(state.tierSheetFilters.minEpc || 0);
    const minRevenue = Number(state.tierSheetFilters.minRevenue || 0);
    return tierSheetRowsForDisplay(sheet)
      .filter((row) => !search || normalize(Object.values(row).join(" ")).includes(search))
      .filter((row) => state.tierSheetFilters.network === "all" || String(rowValue(row, ["Network", "Agency"])) === state.tierSheetFilters.network)
      .filter((row) => state.tierSheetFilters.country === "all" || String(rowValue(row, ["COUNTRY", "Country"])) === state.tierSheetFilters.country)
      .filter((row) => parseSheetNumber(rowValue(row, ["Backend EPC", "EPC"])) >= minEpc)
      .filter((row) => parseSheetNumber(rowValue(row, ["Revenue", "Sales Amount", "Sales"])) >= minRevenue);
  }

  function tierRowMerchantId(row) {
    return String(rowValue(row, ["Merchant ID", "MerchantID", "ID"]) || "").trim().replace(/\.0$/, "");
  }

  function tierRowMerchantName(row) {
    return String(rowValue(row, ["Merchant Name", "Brand", "Merchant"]) || "").trim();
  }

  function offerForTierRow(row) {
    const merchantId = tierRowMerchantId(row);
    return merchantId ? offersByMerchantId.get(merchantId) || null : null;
  }

  function offersForTierRow(row) {
    const merchantId = tierRowMerchantId(row);
    return merchantId ? offerGroupsByMerchantId.get(merchantId) || [] : [];
  }

  function tierRowCategory(row) {
    const offer = offerForTierRow(row);
    if (offer) return displayCategory(offer) || "Uncategorized";
    return cleanCategoryValue(rowValue(row, ["Category", "Main Category", "Main category", "Sheet Category"])) || "Uncategorized";
  }

  function tierRowNumber(row, keys) {
    return parseSheetNumber(rowValue(row, keys));
  }

  function tierRowRevenue(row) {
    return tierRowNumber(row, ["Revenue", "Sales Amount", "Sales"]);
  }

  function tierRowOrders(row) {
    return tierRowNumber(row, ["Order count", "Order Count", "Orders"]);
  }

  function tierRowClicks(row) {
    return tierRowNumber(row, ["Clicks", "Total Clicks"]);
  }

  function tierRowEpc(row) {
    return tierRowNumber(row, ["Backend EPC", "EPC"]);
  }

  function compareTierCategorySummaryRows(a, b) {
    if (a.category === "Uncategorized" && b.category !== "Uncategorized") return 1;
    if (b.category === "Uncategorized" && a.category !== "Uncategorized") return -1;
    return number(b.revenue) - number(a.revenue) ||
      number(b.orders) - number(a.orders) ||
      number(b.merchantCount) - number(a.merchantCount) ||
      String(a.category || "").localeCompare(String(b.category || ""), undefined, { numeric: true, sensitivity: "base" });
  }

  function tierCategorySummaryRows(sheet, rows) {
    const groups = new Map();
    (rows || []).forEach((row) => {
      const category = tierRowCategory(row);
      if (!groups.has(category)) {
        groups.set(category, {
          category,
          rows: [],
          merchantIds: new Set(),
          revenue: 0,
          orders: 0,
          clicks: 0,
          epcWeightedByClicks: 0,
          epcSum: 0,
          epcCount: 0,
          tierBreakdown: {}
        });
      }
      const group = groups.get(category);
      const merchantId = tierRowMerchantId(row);
      const clicks = tierRowClicks(row);
      const epc = tierRowEpc(row);
      const tierName = row.__tierName || (sheet && sheet.name) || "";
      group.rows.push(row);
      if (merchantId) group.merchantIds.add(merchantId);
      group.revenue += tierRowRevenue(row);
      group.orders += tierRowOrders(row);
      group.clicks += clicks;
      if (tierName) group.tierBreakdown[tierName] = (group.tierBreakdown[tierName] || 0) + 1;
      if (epc) {
        if (clicks) group.epcWeightedByClicks += epc * clicks;
        group.epcSum += epc;
        group.epcCount += 1;
      }
    });

    return Array.from(groups.values()).map((group) => {
      const sortedRows = group.rows.slice().sort((a, b) => tierRowRevenue(b) - tierRowRevenue(a) || tierRowOrders(b) - tierRowOrders(a) || tierRowClicks(b) - tierRowClicks(a));
      const topRow = sortedRows[0] || {};
      const previewMerchants = sortedRows.slice(0, 3).map(tierRowMerchantName).filter(Boolean).join(", ");
      return {
        category: group.category,
        rows: sortedRows,
        merchantCount: group.merchantIds.size || group.rows.length,
        rowCount: group.rows.length,
        revenue: group.revenue,
        orders: group.orders,
        clicks: group.clicks,
        avgCvr: group.clicks ? group.orders / group.clicks : null,
        avgEpc: group.clicks && group.epcWeightedByClicks ? group.epcWeightedByClicks / group.clicks : (group.epcCount ? group.epcSum / group.epcCount : null),
        avgAov: group.orders ? group.revenue / group.orders : null,
        topMerchant: tierRowMerchantName(topRow),
        previewMerchants,
        tierBreakdown: group.tierBreakdown
      };
    }).sort(compareTierCategorySummaryRows);
  }

  function tierCategorySummaryTableRows(groups) {
    return groups.map((group) => `<tr>
      <td><strong>${escapeHtml(group.category)}</strong><p>${escapeHtml(group.previewMerchants || "-")}</p></td>
      <td>${number(group.merchantCount).toLocaleString()}</td>
      <td>${shortMoney(group.revenue)}</td>
      <td>${number(group.orders).toLocaleString()}</td>
      <td>${shortPct(group.avgCvr)}</td>
      <td>${shortEpc(group.avgEpc)}</td>
      <td>${escapeHtml(group.topMerchant || "-")}</td>
    </tr>`).join("");
  }

  function renderTierCategorySummary(sheet, rows) {
    const groups = tierCategorySummaryRows(sheet, rows);
    const totalRevenue = groups.reduce((sum, group) => sum + number(group.revenue), 0);
    const totalOrders = groups.reduce((sum, group) => sum + number(group.orders), 0);
    const totalClicks = groups.reduce((sum, group) => sum + number(group.clicks), 0);
    const merchantCount = groups.reduce((sum, group) => sum + number(group.merchantCount), 0);
    els.tierCategorySummary.innerHTML = `<div class="tier-category-header">
      <div>
        <h3>Category-wise report</h3>
        <p>${number(rows.length).toLocaleString()} rows / ${number(groups.length).toLocaleString()} categories</p>
      </div>
      <dl>
        <div><dt>${escapeHtml(labelText("Merchants"))}</dt><dd>${merchantCount.toLocaleString()}</dd></div>
        <div><dt>${escapeHtml(labelText("Revenue"))}</dt><dd>${shortMoney(totalRevenue)}</dd></div>
        <div><dt>${escapeHtml(labelText("Orders"))}</dt><dd>${totalOrders.toLocaleString()}</dd></div>
        <div><dt>${escapeHtml(labelText("CVR"))}</dt><dd>${shortPct(totalClicks ? totalOrders / totalClicks : null)}</dd></div>
      </dl>
    </div>
    <div class="table-wrap tier-category-table-wrap">
      <table class="sheet-table tier-category-table">
        <thead>
          <tr>
            <th>${escapeHtml(labelText("Category"))}</th>
            <th>${escapeHtml(labelText("Merchants"))}</th>
            <th>${escapeHtml(labelText("Revenue"))}</th>
            <th>${escapeHtml(labelText("Orders"))}</th>
            <th>${escapeHtml(labelText("CVR"))}</th>
            <th>EPC</th>
            <th>Top merchant</th>
          </tr>
        </thead>
        <tbody>${groups.length ? tierCategorySummaryTableRows(groups) : `<tr><td colspan="7">No category rows match the current filters.</td></tr>`}</tbody>
      </table>
    </div>`;
  }

  function tierCategorySummaryExportHeaders() {
    return ["Category", "Merchant Count", "Row Count", "Revenue", "Orders", "Clicks", "Avg Conversion", "Avg EPC", "AOV", "Top Merchant", "Top Merchants"];
  }

  function tierCategorySummaryExportRows(sheet, rows) {
    return tierCategorySummaryRows(sheet, rows).map((group) => ({
      "Category": group.category,
      "Merchant Count": group.merchantCount,
      "Row Count": group.rowCount,
      "Revenue": group.revenue,
      "Orders": group.orders,
      "Clicks": group.clicks,
      "Avg Conversion": group.avgCvr,
      "Avg EPC": group.avgEpc,
      "AOV": group.avgAov,
      "Top Merchant": group.topMerchant,
      "Top Merchants": group.previewMerchants
    }));
  }

  function averageCommissionRateForTierRow(row) {
    const rates = offersForTierRow(row)
      .map((offer) => Number(offer.commissionRate))
      .filter((rate) => Number.isFinite(rate));
    if (!rates.length) return null;
    return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  }

  function roundedUpCommissionRateText(row) {
    const rate = averageCommissionRateForTierRow(row);
    if (rate === null) return "";
    return `${Math.ceil(rate * 100)}%`;
  }

  function tierOfferListExportHeaders() {
    return ["Merchant ID", "Merchant Name", "Category", "Avg Commission Rate"];
  }

  function tierOfferListExportRows(sheet, rows) {
    return (rows || []).map((row) => ({
      "Merchant ID": tierRowMerchantId(row),
      "Merchant Name": tierRowMerchantName(row),
      "Category": tierRowCategory(row),
      "Avg Commission Rate": roundedUpCommissionRateText(row)
    }));
  }

  function renderTierReportPending(tierName, message) {
    els.tierPageTitle.textContent = tierName;
    els.tierPageSubtitle.textContent = `${tierReportRangeLabel(state.tierReport.startDate, state.tierReport.endDate)} / YeahPromos Amazon report database`;
    els.tierPageSummary.innerHTML = "";
    els.tierPageNotes.innerHTML = `<p>${escapeHtml(message)}</p>`;
    els.tierCategorySummary.innerHTML = "";
    els.tierSheetHead.innerHTML = "";
    els.tierSheetRows.innerHTML = `<tr><td>${escapeHtml(message)}</td></tr>`;
    els.tierTableTitle.textContent = "Amazon report records";
    els.tierTableCount.textContent = "";
    renderTierPagination(tierName, null);
    renderTierColumnPanel(null, [], []);
    state.visibleTierRowKeys = [];
    state.selectedTierRowKeys.clear();
    syncTierBulkControls();
    closeTierSheetOverlay({ restoreFocus: false });
    syncTierSheetOverlay();
  }

  function renderTierPage(tierName) {
    setTierReportControls(tierName);
    if (STANDARD_CATEGORY_REPORT_TIERS.includes(tierName)) {
      const dependencies = tierReportDependencyTiers(tierName);
      const missing = dependencies.filter((dependencyTier) => (
        !state.tierReport.payloads.has(tierReportKey(dependencyTier))
      ));
      if (missing.length) {
        const failedTier = missing.find((dependencyTier) => state.tierReport.errors.has(tierReportKey(dependencyTier)));
        const error = failedTier ? state.tierReport.errors.get(tierReportKey(failedTier)) : "";
        renderTierReportPending(
          tierName,
          error
            ? `Could not load ${failedTier} for the selected range: ${error}`
            : "Loading the selected YeahPromos report range…"
        );
        missing.forEach((dependencyTier) => {
          const dependencyKey = tierReportKey(dependencyTier);
          if (!state.tierReport.errors.has(dependencyKey)) {
            loadTierReport(dependencyTier, state.tierReport.startDate, state.tierReport.endDate);
          }
        });
        return;
      }
      dependencies.forEach((dependencyTier) => {
        const dependencyKey = tierReportKey(dependencyTier);
        activateTierReportPayload(dependencyTier, dependencyKey, state.tierReport.payloads.get(dependencyKey));
      });
    }
    const sheet = sheetByName(tierName);
    els.tierPageTitle.textContent = tierName;
    els.tierPageSubtitle.textContent = sheet
      ? (STANDARD_CATEGORY_REPORT_TIERS.includes(tierName)
        ? `${tierReportRangeLabel(state.tierReport.startDate, state.tierReport.endDate)} / YeahPromos Amazon report database`
        : `${sheet.title} / database snapshot`)
      : "Tier data not found";
    if (!sheet) {
      els.tierPageSummary.innerHTML = "";
      els.tierPageNotes.innerHTML = `<p>${escapeHtml(t("tier.noMatch", "No matching tier data was found."))}</p>`;
      els.tierCategorySummary.innerHTML = "";
      els.tierSheetHead.innerHTML = "";
      els.tierSheetRows.innerHTML = "";
      els.tierTableCount.textContent = "";
      renderTierPagination(tierName, null);
      renderTierColumnPanel(null, [], []);
      state.visibleTierRowKeys = [];
      state.selectedTierRowKeys.clear();
      syncTierBulkControls();
      closeTierSheetOverlay({ restoreFocus: false });
      syncTierSheetOverlay();
      return;
    }
    refreshTierSheetFilters(sheet);
    renderTierSummary(sheet);
    els.tierPageNotes.innerHTML = renderTierLogicSummary(sheet);
    const filteredRows = getFilteredTierSheetRows(sheet);
    renderTierCategorySummary(sheet, filteredRows);
    const pagination = tierName === "Tier 4"
      ? { page: state.tierTablePages[tierName] || 1, pageSize: TIER_TABLE_PAGE_SIZE }
      : null;
    renderSheetTable(sheet, els.tierTableTitle, els.tierTableCount, els.tierSheetHead, els.tierSheetRows, filteredRows, pagination);
    syncTierSheetOverlay();
  }

  function targetOverrideKey(record) {
    return `${record.__monthKey || record.Month || "unknown"}::${record.Tier || "unknown"}`;
  }

  function applyTargetOverride(record) {
    const key = targetOverrideKey(record);
    const override = state.targetOverrides && state.targetOverrides[key];
    if (override !== undefined && String(override).trim() !== "") {
      const candidate = { ...record, Target: override };
      if (targetGoal(candidate)) {
        record.Target = override;
      } else {
        record.__invalidTargetOverride = override;
      }
    }
    record.__targetOverrideKey = key;
    return record;
  }

  function currentReportingMonthKey(referenceDate = new Date()) {
    return localDateKey(referenceDate).slice(0, 7);
  }

  function ensureReportingMonthRecord(records, monthKey = currentReportingMonthKey()) {
    const normalizedMonthKey = monthKeyFromText(monthKey);
    const normalizedRecords = Array.isArray(records) ? records.slice() : [];
    if (!normalizedMonthKey || normalizedRecords.some((record) => monthKeyFromText(record.__monthKey) === normalizedMonthKey)) {
      return normalizedRecords;
    }
    return normalizedRecords.concat(applyTargetOverride({
      Month: monthAxisLabel(normalizedMonthKey),
      __monthKey: normalizedMonthKey,
      __databaseOnly: true,
      Tier: "Total",
      "Brand Count": 0,
      "Total Clicks": 0,
      "Order Count": 0,
      Revenue: 0,
      "Avg Conversion": 0,
      "New Tier Entries": 0,
      "Tier Exits": 0,
      Target: ""
    }));
  }

  function dbTargetRecordsFromTierSummary() {
    const dbData = state.dbTierSummary && state.dbTierSummary.data;
    if (!dbData || !dbData.ok || !dbData.month || !dbData.tiers || !dbData.tiers.length) return null;
    const monthKey = dbData.month;
    const date = new Date(`${monthKey}-01T00:00:00`);
    const month = Number.isNaN(date.getTime())
      ? monthKey
      : date.toLocaleString("en-US", { month: "long", year: "numeric" });
    const records = dbData.tiers.map((t) =>
      applyTargetOverride({
        Month: month,
        __monthKey: monthKey,
        __databaseOnly: true,
        __source: "database",
        Tier: t.tier,
        "Brand Count": t.brandCount,
        "Total Clicks": t.clicks,
        "Order Count": t.orders,
        Revenue: t.revenue,
        "Avg Conversion": t.conversionRate,
        "New Tier Entries": 0,
        "Tier Exits": 0,
        Target: ""
      })
    );
    const total = dbData.total;
    if (total) {
      records.push(applyTargetOverride({
        Month: month,
        __monthKey: monthKey,
        __databaseOnly: true,
        __source: "database",
        Tier: "Total",
        "Brand Count": total.brandCount,
        "Total Clicks": total.clicks,
        "Order Count": total.orders,
        Revenue: total.revenue,
        "Avg Conversion": total.conversionRate,
        "New Tier Entries": 0,
        "Tier Exits": 0,
        Target: ""
      }));
    }
    return ensureReportingMonthRecord(records);
  }

  function targetRecords() {
    const dbRecords = dbTargetRecordsFromTierSummary();
    if (dbRecords) return dbRecords;

    const sheet = sheetByName("Tier Summary & Target");
    const grid = (sheet && sheet.grid) || [];
    const records = [];
    let headers = [];
    let currentMonth = "";
    let currentMonthKey = "";
    grid.forEach((row) => {
      const first = String(row[0] || "").trim();
      const tier = String(row[1] || "").trim();
      if (row.some((value) => String(value || "").trim() === "Tier")) {
        headers = row.map((value) => String(value || "").trim());
        return;
      }
      if (first && /^\d{4}-\d{2}-\d{2}/.test(first)) {
        const date = new Date(`${first.slice(0, 10)}T00:00:00`);
        currentMonthKey = first.slice(0, 7);
        currentMonth = Number.isNaN(date.getTime())
          ? first
          : date.toLocaleString("en-US", { month: "long", year: "numeric" });
      }
      if (!headers.length || !tier) return;
      const record = { Month: currentMonth, __monthKey: currentMonthKey };
      headers.forEach((header, index) => {
        if (!header) return;
        record[header] = row[index] || "";
      });
      record.__sourceTarget = record.Target || "";
      if (record.Tier) records.push(applyTargetOverride(record));
    });
    return ensureReportingMonthRecord(records.length ? records : derivedTargetRecordsFromTierSheets());
  }

  function derivedTargetRecordsFromTierSheets() {
    const monthKey = data.summary && data.summary.generatedAt ? String(data.summary.generatedAt).slice(0, 7) : localDateKey(new Date()).slice(0, 7);
    const date = new Date(`${monthKey}-01T00:00:00`);
    const month = Number.isNaN(date.getTime()) ? monthKey : date.toLocaleString("en-US", { month: "long", year: "numeric" });
    const records = TIER_MOVE_OPTIONS.map((tierName) => {
      const sheet = sheetByName(tierName);
      const rows = (sheet && Array.isArray(sheet.rows)) ? sheet.rows : [];
      const clicks = rows.reduce((sum, row) => sum + tierRowClicks(row), 0);
      const orders = rows.reduce((sum, row) => sum + tierRowOrders(row), 0);
      const revenue = rows.reduce((sum, row) => sum + tierRowRevenue(row), 0);
      const conversion = clicks ? orders / clicks : 0;
      return applyTargetOverride({
        Month: month,
        __monthKey: monthKey,
        __derivedFromTierSheets: true,
        Tier: tierName === "BLACK TIER" ? "Black Tier" : tierName,
        "Brand Count": rows.length,
        "Total Clicks": clicks,
        "Order Count": orders,
        Revenue: revenue,
        "Avg Conversion": conversion,
        "New Tier Entries": 0,
        "Tier Exits": 0,
        Target: ""
      });
    });
    const total = records.reduce((acc, record) => {
      acc.brands += parseSheetNumber(record["Brand Count"]);
      acc.clicks += parseSheetNumber(record["Total Clicks"]);
      acc.orders += parseSheetNumber(record["Order Count"]);
      acc.revenue += parseSheetNumber(record.Revenue);
      return acc;
    }, { brands: 0, clicks: 0, orders: 0, revenue: 0 });
    records.push(applyTargetOverride({
      Month: month,
      __monthKey: monthKey,
      __derivedFromTierSheets: true,
      Tier: "Total",
      "Brand Count": total.brands,
      "Total Clicks": total.clicks,
      "Order Count": total.orders,
      Revenue: total.revenue,
      "Avg Conversion": total.clicks ? total.orders / total.clicks : 0,
      "New Tier Entries": 0,
      "Tier Exits": 0,
      Target: ""
    }));
    return records;
  }

  function targetRecordMetricTotal(record) {
    return parseSheetNumber(record && record["Brand Count"]) +
      parseSheetNumber(record && record["Total Clicks"]) +
      parseSheetNumber(record && record["Order Count"]) +
      parseSheetNumber(record && record.Revenue);
  }

  function targetMonthHasMetrics(records, month) {
    return (records || [])
      .filter((record) => record.Month === month)
      .some((record) => targetRecordMetricTotal(record) > 0);
  }

  function preferredTargetMonth(records) {
    const months = Array.from(new Set((records || []).map((record) => record.Month).filter(Boolean)))
      .sort((a, b) => String(targetMonthSortValue(a)).localeCompare(String(targetMonthSortValue(b))));
    const monthsWithMetrics = months.filter((month) => targetMonthHasMetrics(records, month));
    return monthsWithMetrics[monthsWithMetrics.length - 1] || months[months.length - 1] || "";
  }

  function filteredTargetRecords() {
    return targetRecords()
      .filter((record) => state.targetFilters.month === "all" || record.Month === state.targetFilters.month)
      .filter((record) => state.targetFilters.tier === "all" || record.Tier === state.targetFilters.tier);
  }

  function targetMonthSortValue(month) {
    const match = targetRecords().find((record) => record.Month === month);
    return match ? match.__monthKey || month : monthKeyFromText(month) || month;
  }

  function refreshTargetFilters() {
    const records = targetRecords();
    const months = Array.from(new Set(records.map((record) => record.Month).filter(Boolean)))
      .sort((a, b) => String(targetMonthSortValue(a)).localeCompare(String(targetMonthSortValue(b))));
    const tiers = Array.from(new Set(records.map((record) => record.Tier).filter((tier) => tier && String(tier).toLowerCase() !== "total"))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const monthOptions = months.map((month) => ({ value: month, label: month }));
    if ((!state.targetFilters.month || (state.targetFilters.month !== "all" && !months.includes(state.targetFilters.month))) && monthOptions.length) {
      state.targetFilters.month = preferredTargetMonth(records);
    }
    if (!state.targetFilters.compareMonth && monthOptions.length > 1) state.targetFilters.compareMonth = monthOptions[Math.max(0, monthOptions.length - 2)].value;
    if (state.targetFilters.compareMonth === state.targetFilters.month) {
      const currentIndex = months.indexOf(state.targetFilters.month);
      state.targetFilters.compareMonth = months[currentIndex - 1] || months[currentIndex + 1] || "";
    }
    replaceSelectWithOptions(els.targetMonthSelect, [{ value: "all", label: "All months" }, ...monthOptions], state.targetFilters.month || "all");
    replaceSelectWithOptions(
      els.targetCompareMonthSelect,
      [{ value: "", label: "No comparison" }, ...monthOptions.filter((option) => option.value !== els.targetMonthSelect.value)],
      state.targetFilters.compareMonth || ""
    );
    replaceSelectOptions(els.targetTierFilter, "All tiers", tiers, state.targetFilters.tier);
    state.targetFilters.month = els.targetMonthSelect.value;
    state.targetFilters.compareMonth = els.targetCompareMonthSelect.value;
    state.targetFilters.tier = els.targetTierFilter.value;
  }

  function isTargetTotalRow(record) {
    return String(record && record.Tier || "").toLowerCase() === "total";
  }

  function targetTierSortRank(tier) {
    const text = String(tier || "").trim().toLowerCase();
    const index = TARGET_TIER_ORDER.findIndex((item) => item.toLowerCase() === text);
    if (index >= 0) return index;
    const match = text.match(/tier\s*([0-9]+)/);
    return match ? Number(match[1]) - 1 : 99;
  }

  function targetRowsForMonth(records, month, tier = state.targetFilters.tier) {
    return (records || [])
      .filter((record) => month === "all" || record.Month === month)
      .filter((record) => tier === "all" || record.Tier === tier);
  }

  function targetMetricRows(records) {
    return (records || [])
      .filter((record) => !isTargetTotalRow(record))
      .sort((a, b) => targetTierSortRank(a.Tier) - targetTierSortRank(b.Tier) || String(a.Tier).localeCompare(String(b.Tier), undefined, { numeric: true }));
  }

  function targetSummary(records) {
    const summaryRows = records.some((record) => record.Tier === "Total")
      ? records.filter((record) => record.Tier === "Total")
      : targetMetricRows(records);
    return summaryRows.reduce((acc, record) => {
      acc.brands += parseSheetNumber(record["Brand Count"]);
      acc.clicks += parseSheetNumber(record["Total Clicks"]);
      acc.orders += parseSheetNumber(record["Order Count"]);
      acc.revenue += parseSheetNumber(record.Revenue);
      const conversion = percentageNumberForHeader("Avg Conversion", record["Avg Conversion"]);
      if (conversion !== null) {
        acc.conversionWeighted += conversion * parseSheetNumber(record["Total Clicks"]);
        acc.conversionFallback += conversion;
        acc.conversionCount += 1;
      }
      acc.newEntries += parseSheetNumber(record["New Tier Entries"]);
      acc.exits += parseSheetNumber(record["Tier Exits"]);
      return acc;
    }, { brands: 0, clicks: 0, orders: 0, revenue: 0, conversionWeighted: 0, conversionFallback: 0, conversionCount: 0, newEntries: 0, exits: 0 });
  }

  function targetAvgConversion(summary) {
    if (summary.clicks && summary.orders) return summary.orders / summary.clicks;
    if (summary.clicks && summary.conversionWeighted) return (summary.conversionWeighted / summary.clicks) / 100;
    if (summary.conversionCount) return (summary.conversionFallback / summary.conversionCount) / 100;
    return 0;
  }

  function compactNumber(value) {
    const n = Number(value) || 0;
    if (Math.abs(n) >= 1000000) return `${(n / 1000000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
    if (Math.abs(n) >= 1000) return `${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
    return n.toLocaleString();
  }

  function compactMoney(value) {
    const n = Number(value) || 0;
    if (Math.abs(n) >= 1000000) return `$${(n / 1000000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
    if (Math.abs(n) >= 1000) return `$${(n / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
    return shortMoney(n);
  }

  function dateKey(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
  }

  function monthKeyFromText(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{4})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}`;
    const labelMatch = text.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (!labelMatch) return "";
    const monthIndex = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december"
    ].indexOf(labelMatch[1].toLowerCase());
    return monthIndex >= 0 ? `${labelMatch[2]}-${String(monthIndex + 1).padStart(2, "0")}` : "";
  }

  function monthLabelFromKey(value) {
    const key = monthKeyFromText(value);
    if (!key) return "Reporting";
    const date = new Date(`${key}-01T00:00:00`);
    return Number.isNaN(date.getTime()) ? key : date.toLocaleString("en-US", { month: "long" });
  }

  function dbStatusTitleForMonth(value) {
    const label = monthLabelFromKey(value);
    return label === "Reporting" ? "Reporting coverage" : `${label} reporting coverage`;
  }

  function addDaysToDateKey(value, days) {
    const key = dateKey(value);
    if (!key) return "";
    const date = new Date(`${key}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "";
    date.setDate(date.getDate() + Number(days || 0));
    return localDateKey(date);
  }

  function compareDateKeys(left, right) {
    const a = dateKey(left);
    const b = dateKey(right);
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    return a.localeCompare(b);
  }

  function shortDateLabel(value) {
    const key = dateKey(value);
    if (!key) return "-";
    const date = new Date(`${key}T00:00:00`);
    if (Number.isNaN(date.getTime())) return key;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function axisDateLabel(value) {
    const key = dateKey(value);
    if (!key) return "-";
    const date = new Date(`${key}T00:00:00`);
    if (Number.isNaN(date.getTime())) return key;
    return date.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  }

  function dateRangeLabel(start, end) {
    const startLabel = shortDateLabel(start);
    const endLabel = shortDateLabel(end);
    if (startLabel === "-" && endLabel === "-") return "-";
    if (startLabel === endLabel || endLabel === "-") return startLabel;
    if (startLabel === "-") return endLabel;
    return `${startLabel}-${endLabel}`;
  }

  function targetDbStatusMonthKey() {
    if (state.targetFilters.month && state.targetFilters.month !== "all") {
      return monthKeyFromText(targetMonthSortValue(state.targetFilters.month));
    }
    return "";
  }

  function coverageValue(item = {}) {
    const matched = Number(item.matched);
    const total = Number(item.total);
    if (Number.isFinite(matched) && Number.isFinite(total) && total > 0) {
      return `${matched.toLocaleString()} / ${total.toLocaleString()}`;
    }
    if (Number.isFinite(matched)) return matched.toLocaleString();
    return "-";
  }

  function coverageDetail(item = {}) {
    const coverage = Number(item.coverage);
    if (Number.isFinite(coverage)) return shortPct(coverage);
    return item.available === false ? "Unavailable" : "Coverage";
  }

  function dbDailyTrendRows(payload = state.dbStatus.data) {
    const trend = payload && payload.dailyTrend ? payload.dailyTrend : {};
    const rows = Array.isArray(trend.rows) ? trend.rows.slice() : [];
    const observedThrough = dateKey(trend.observedThrough || payload?.latestDates?.aggregateOrders?.latest || payload?.latestDates?.amazonOrders?.latest);
    const expectedCompleteThrough = dateKey(trend.expectedCompleteThrough);
    const normalized = rows
      .map((row) => {
        const day = dateKey(row.date || row.day);
        if (!day) return null;
        const state = row.state || (
          expectedCompleteThrough && compareDateKeys(day, expectedCompleteThrough) > 0
            ? "delay"
            : observedThrough && compareDateKeys(day, observedThrough) > 0
              ? "stale"
              : "observed"
        );
        const orders = row.orders === null || row.orders === undefined ? null : Number(row.orders) || 0;
        const revenue = row.revenue === null || row.revenue === undefined ? null : Number(row.revenue) || 0;
        const clicks = row.clicks === null || row.clicks === undefined ? null : Number(row.clicks) || 0;
        return {
          ...row,
          date: day,
          state,
          isDelay: state === "delay",
          isComplete: row.isComplete !== undefined ? Boolean(row.isComplete) : state !== "delay",
          orders,
          revenue,
          clicks
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.date.localeCompare(b.date));

    let previousObserved = null;
    normalized.forEach((row) => {
      row.ordersDelta = null;
      row.revenueDelta = null;
      row.clicksDelta = null;
      if (row.state !== "delay" && Number.isFinite(row.orders)) {
        if (previousObserved) {
          row.ordersDelta = row.orders - previousObserved.orders;
          row.revenueDelta = row.revenue - previousObserved.revenue;
          row.clicksDelta = row.clicks - previousObserved.clicks;
        }
        previousObserved = row;
      }
    });
    return normalized;
  }

  function monthAxisLabel(value, options = {}) {
    const key = monthKeyFromText(value);
    if (!key) return String(value || "-");
    const date = new Date(`${key}-01T00:00:00`);
    if (Number.isNaN(date.getTime())) return key;
    return date.toLocaleDateString("en-US", {
      month: options.short ? "short" : "long",
      year: "numeric"
    });
  }

  function dbMonthlyTrendRows(payload = state.dbStatus.data) {
    const recent = payload && payload.recentMonths ? payload.recentMonths : {};
    const aggregateRows = Array.isArray(recent.aggregateOrders) ? recent.aggregateOrders : [];
    const clickRows = Array.isArray(recent.amazonClicks) ? recent.amazonClicks : [];
    const byMonth = new Map();
    aggregateRows.forEach((row) => {
      const monthKey = monthKeyFromText(row.month);
      if (!monthKey) return;
      byMonth.set(monthKey, {
        monthKey,
        revenue: Number(row.revenue) || 0,
        orders: Number(row.orders) || 0,
        activeBrands: Number(row.activeBrands) || 0,
        aggregateRows: Number(row.aggregateRows) || 0,
        clicks: 0
      });
    });
    clickRows.forEach((row) => {
      const monthKey = monthKeyFromText(row.month);
      if (!monthKey) return;
      const target = byMonth.get(monthKey) || {
        monthKey,
        revenue: 0,
        orders: 0,
        activeBrands: 0,
        aggregateRows: 0,
        clicks: 0
      };
      target.clicks = Number(row.clicks) || 0;
      target.clickRows = Number(row.clickRows) || 0;
      byMonth.set(monthKey, target);
    });
    return Array.from(byMonth.values())
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .map((row) => ({
        ...row,
        conversionRate: row.clicks ? row.orders / row.clicks : 0,
        label: monthAxisLabel(row.monthKey),
        shortLabel: monthAxisLabel(row.monthKey, { short: true }),
        source: "database"
      }));
  }

  function dbMonthlyRowForKey(monthKey, payload = state.dbStatus.data) {
    const normalized = monthKeyFromText(monthKey);
    return dbMonthlyTrendRows(payload).find((row) => row.monthKey === normalized) || null;
  }

  function dbStatusViewModel(payload = state.dbStatus.data) {
    const trend = payload && payload.dailyTrend ? payload.dailyTrend : {};
    const latestDates = payload && payload.latestDates ? payload.latestDates : {};
    const currentDate = dateKey(trend.currentDate) || localDateKey(new Date());
    const delayDays = Number.isFinite(Number(trend.delayDays)) ? Number(trend.delayDays) : 2;
    const expectedCompleteThrough = dateKey(trend.expectedCompleteThrough) || addDaysToDateKey(currentDate, -delayDays);
    const observedThrough = dateKey(trend.observedThrough || latestDates.aggregateOrders?.latest || latestDates.amazonOrders?.latest);
    const latestDataDate = dateKey(trend.latestDataDate || latestDates.aggregateOrders?.latest || latestDates.amazonOrders?.latest);
    const trendMonthKey = monthKeyFromText(trend.month || currentDate || state.dbStatus.monthKey);
    const delayWindowStart = addDaysToDateKey(expectedCompleteThrough, 1);
    const health = !observedThrough || !expectedCompleteThrough
      ? "unknown"
      : compareDateKeys(observedThrough, expectedCompleteThrough) >= 0
        ? "fresh"
        : "stale";
    const coverage = payload && payload.coverage ? payload.coverage : {};
    const coverageCards = [
      { label: "Offer coverage", value: coverageValue(coverage.cnpscy_advert), detail: coverageDetail(coverage.cnpscy_advert), tone: "green" },
      { label: "Aggregate coverage", value: coverageValue(coverage.cnpscy_order_new_aggregate), detail: coverageDetail(coverage.cnpscy_order_new_aggregate), tone: "blue" },
      { label: "Product coverage", value: coverageValue(coverage.cnpscy_amazon_product), detail: coverageDetail(coverage.cnpscy_amazon_product), tone: "blue" },
      { label: "Snapshot IDs", value: Number(payload?.staticSnapshot?.merchantIds || coverage.staticNumericMerchantIds || 0).toLocaleString(), detail: payload?.staticSnapshot?.generatedAt ? `Built ${shortDateLabel(payload.staticSnapshot.generatedAt)}` : "Static page", tone: "slate" }
    ];
    const latestCards = [
      { label: "Offer aggregate", value: dateKey(latestDates.aggregateOrders?.latest) || "-", detail: latestDates.aggregateOrders?.table || "cnpscy_order_new_aggregate" },
      { label: "Amazon orders", value: dateKey(latestDates.amazonOrders?.latest) || "-", detail: latestDates.amazonOrders?.table || "cnpscy_amazon_order" },
      { label: "Amazon clicks", value: dateKey(latestDates.amazonClicks?.latest) || "-", detail: latestDates.amazonClicks?.table || "cnpscy_amazon_click" },
      { label: "Products", value: dateKey(latestDates.products?.latest) || "-", detail: latestDates.products?.table || "cnpscy_amazon_product" }
    ];
    return {
      title: dbStatusTitleForMonth(trendMonthKey),
      monthKey: trendMonthKey,
      health,
      delayDays,
      currentDate,
      expectedCompleteThrough,
      observedThrough,
      latestDataDate,
      delayWindowText: dateRangeLabel(delayWindowStart, currentDate),
      coverageCards,
      latestCards,
      primarySource: trend.primarySource || "cnpscy_order_new_aggregate",
      checkedAt: payload?.checkedAt || ""
    };
  }

  function dbStatusDemoEnabled() {
    const location = window.location || {};
    const host = String(location.hostname || "");
    if (host !== "localhost" && host !== "127.0.0.1") return false;
    const search = String(location.search || "");
    return new URLSearchParams(search).get("dbStatusDemo") === "1";
  }

  function demoDbStatusPayload(monthKey = "") {
    const today = localDateKey(new Date());
    const requestedMonth = monthKeyFromText(monthKey);
    const currentMonth = today.slice(0, 7);
    const trendMonth = requestedMonth || currentMonth;
    const monthParts = trendMonth.match(/^(\d{4})-(\d{2})$/);
    const monthEnd = monthParts
      ? localDateKey(new Date(Number(monthParts[1]), Number(monthParts[2]), 0))
      : today;
    const currentDate = trendMonth === currentMonth ? today : monthEnd;
    const expectedCompleteThrough = trendMonth === currentMonth ? addDaysToDateKey(currentDate, -2) : monthEnd;
    const rows = [];
    let cursor = monthParts ? `${trendMonth}-01` : addDaysToDateKey(currentDate, -8);
    let completeIndex = 0;
    while (cursor && compareDateKeys(cursor, currentDate) <= 0) {
      const day = cursor;
      const state = compareDateKeys(day, expectedCompleteThrough) > 0 ? "delay" : "observed";
      const orders = state === "delay" ? null : 72 + completeIndex * 9 + (completeIndex % 3) * 6;
      const revenue = state === "delay" ? null : 3200 + completeIndex * 420;
      const clicks = state === "delay" ? null : 820 + completeIndex * 55;
      rows.push({
        date: day,
        state,
        isComplete: state !== "delay",
        orders,
        revenue,
        clicks,
        activeBrands: state === "delay" ? null : 42 + (completeIndex % 18),
        conversionRate: clicks ? orders / clicks : 0
      });
      cursor = addDaysToDateKey(cursor, 1);
      completeIndex += 1;
    }
    const completedRows = rows.filter((row) => row.state !== "delay");
    const selectedOrders = completedRows.reduce((sum, row) => sum + (Number(row.orders) || 0), 0);
    const selectedRevenue = completedRows.reduce((sum, row) => sum + (Number(row.revenue) || 0), 0);
    const selectedClicks = completedRows.reduce((sum, row) => sum + (Number(row.clicks) || 0), 0);
    const recentAggregate = [];
    const recentClicks = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(`${trendMonth}-01T00:00:00`);
      date.setMonth(date.getMonth() - offset);
      const key = localDateKey(date).slice(0, 7);
      const factor = 0.72 + (5 - offset) * 0.056;
      recentAggregate.push({
        month: key,
        aggregateRows: Math.round(selectedOrders * factor * 0.74),
        activeBrands: Math.round((offers.length || 1280) * (0.15 + factor * 0.07)),
        orders: Math.round(selectedOrders * factor),
        revenue: Math.round(selectedRevenue * factor * 100) / 100
      });
      recentClicks.push({
        month: key,
        clickRows: Math.round(selectedClicks * factor * 0.31),
        clicks: Math.round(selectedClicks * factor)
      });
    }
    return {
      ok: true,
      demo: true,
      checkedAt: new Date().toISOString(),
      staticSnapshot: { generatedAt: new Date().toISOString(), merchantIds: offers.length },
      latestDates: {
        amazonOrders: { latest: expectedCompleteThrough, table: "cnpscy_amazon_order" },
        amazonClicks: { latest: addDaysToDateKey(expectedCompleteThrough, -1), table: "cnpscy_amazon_click" },
        aggregateOrders: { latest: expectedCompleteThrough, table: "cnpscy_order_new_aggregate" },
        products: { latest: expectedCompleteThrough, table: "cnpscy_amazon_product" }
      },
      coverage: {
        staticNumericMerchantIds: offers.length,
        cnpscy_advert: { matched: offers.length, total: offers.length, coverage: 1 },
        cnpscy_order_new_aggregate: { matched: offers.length, total: offers.length, coverage: 1 },
        cnpscy_amazon_product: { matched: Math.max(0, offers.length - 6), total: offers.length, coverage: offers.length ? (offers.length - 6) / offers.length : 0 },
        cnpscy_amazon_product_extra: { matched: Math.max(0, offers.length - 304), total: offers.length, coverage: offers.length ? (offers.length - 304) / offers.length : 0 }
      },
      dailyTrend: {
        month: trendMonth,
        delayDays: 2,
        currentDate,
        observedThrough: expectedCompleteThrough,
        expectedCompleteThrough,
        rows
      },
      recentMonths: {
        window: {
          startMonth: recentAggregate[0]?.month || trendMonth,
          endMonth: trendMonth,
          throughDate: currentDate,
          months: recentAggregate.length
        },
        aggregateOrders: recentAggregate,
        amazonClicks: recentClicks
      }
    };
  }

  function deltaText(value, formatter = compactNumber) {
    if (!Number.isFinite(Number(value))) return "No prior day";
    const number = Number(value);
    if (Math.abs(number) < 0.000001) return "0 vs previous day";
    return `${number > 0 ? "+" : "-"}${formatter(Math.abs(number))} vs previous day`;
  }

  function dbTrendPath(points) {
    if (!points.length) return "";
    return points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  }

  function dbDailyTrendChartHtml(rows, delayDays = 2) {
    if (!rows.length) {
      return `<div class="target-empty-state">DB daily trend will appear after the status API responds.</div>`;
    }
    const maxValue = Math.max(1, ...rows.map((row) => Number(row.orders) || 0));
    const width = 760;
    const height = 250;
    const pad = { left: 42, right: 18, top: 24, bottom: 48 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const step = rows.length > 1 ? innerWidth / (rows.length - 1) : innerWidth;
    const barWidth = Math.max(12, Math.min(34, step * 0.5));
    const points = [];
    const bars = rows.map((row, index) => {
      const x = pad.left + index * step;
      const value = Number(row.orders) || 0;
      const barHeight = Math.max(row.state === "delay" ? 14 : 3, (value / maxValue) * innerHeight);
      const y = pad.top + innerHeight - barHeight;
      if (row.state !== "delay" || value > 0) points.push({ x, y, row });
      const tooltipWidth = 176;
      const tooltipHeight = 70;
      const tooltipX = Math.min(width - pad.right - tooltipWidth, Math.max(pad.left, x - tooltipWidth / 2));
      const tooltipY = Math.max(8, y - tooltipHeight - 12);
      const status = row.state === "delay" ? "Partial lag window" : row.state === "stale" ? "Missing after expected date" : "Complete";
      const revenue = compactMoney(row.revenue || 0);
      const clicks = compactNumber(row.clicks || 0);
      const label = `${shortDateLabel(row.date)}: ${compactNumber(value)} orders, ${revenue}, ${clicks} clicks`;
      return `<g class="db-trend-day ${escapeHtml(row.state)}" tabindex="0" role="img" aria-label="${escapeHtml(label)}">
        <rect class="db-trend-hover-band" x="${(x - step / 2).toFixed(2)}" y="${pad.top}" width="${Math.max(step, barWidth).toFixed(2)}" height="${innerHeight}" rx="6"></rect>
        <rect class="db-trend-bar" x="${(x - barWidth / 2).toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="5"></rect>
        <text x="${x.toFixed(2)}" y="${height - 22}" text-anchor="middle">${escapeHtml(axisDateLabel(row.date))}</text>
        <g class="db-trend-tooltip" transform="translate(${tooltipX.toFixed(2)} ${tooltipY.toFixed(2)})">
          <rect width="${tooltipWidth}" height="${tooltipHeight}" rx="8"></rect>
          <text x="10" y="18">${escapeHtml(shortDateLabel(row.date))} / ${escapeHtml(status)}</text>
          <text x="10" y="36">${escapeHtml(compactNumber(value))} orders / ${escapeHtml(revenue)}</text>
          <text x="10" y="54">${escapeHtml(clicks)} clicks / CVR ${escapeHtml(shortPct(row.conversionRate || 0))}</text>
        </g>
      </g>`;
    }).join("");
    const delayStartIndex = rows.findIndex((row) => row.state === "delay");
    const delayZone = delayStartIndex >= 0
      ? `<rect class="db-delay-zone" x="${Math.max(pad.left, pad.left + delayStartIndex * step - step / 2).toFixed(2)}" y="${pad.top}" width="${(width - pad.right - Math.max(pad.left, pad.left + delayStartIndex * step - step / 2)).toFixed(2)}" height="${innerHeight}" rx="8"></rect>
         <text class="db-delay-label" x="${(width - pad.right - 8).toFixed(2)}" y="${(pad.top + 18).toFixed(2)}" text-anchor="end">${Number(delayDays) || 2}-day reporting delay</text>`
      : "";
    const observedRows = rows.filter((row) => row.state !== "delay" && Number.isFinite(row.orders));
    const latest = observedRows[observedRows.length - 1];
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily DB orders trend with reporting delay">
      ${delayZone}
      <line class="trend-axis" x1="${pad.left}" y1="${pad.top + innerHeight}" x2="${width - pad.right}" y2="${pad.top + innerHeight}"></line>
      <line class="trend-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + innerHeight}"></line>
      ${bars}
      <path class="trend-line db-trend-line" d="${escapeHtml(dbTrendPath(points))}"></path>
      ${points.map((point) => `<circle class="trend-dot db-trend-dot ${escapeHtml(point.row.state)}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="4"></circle>`).join("")}
      <text x="${pad.left}" y="16">Offer aggregate orders per day</text>
      ${latest ? `<text class="db-latest-label" x="${width - pad.right}" y="${height - 4}" text-anchor="end">Latest complete: ${escapeHtml(shortDateLabel(latest.date))}</text>` : ""}
    </svg>`;
  }

  function refreshDbStatusUi() {
    if (state.page !== "sheets" || !els.sheetPageNotes) return;
    const { allRecords, rows, comparisonRows } = currentTargetPageData();
    renderSheetSummary(rows, comparisonRows, state.targetFilters.compareMonth);
    if (!refreshTargetTrendOnly(allRecords)) renderSheetPage();
  }

  function ensureDbStatusForSelectedMonth() {
    if (window.__OFFER_INTELLIGENCE_TEST__) return;
    if (state.page !== "sheets") return;
    const desiredMonthKey = targetDbStatusMonthKey();
    if (state.dbStatus.loading) return;
    if (!desiredMonthKey && (state.dbStatus.data || state.dbStatus.error)) return;
    if (desiredMonthKey && state.dbStatus.monthKey === desiredMonthKey && (state.dbStatus.data || state.dbStatus.error)) return;
    window.setTimeout(() => loadDbStatus(desiredMonthKey), 0);
  }

  async function loadDbStatus(monthKey = targetDbStatusMonthKey()) {
    if (typeof fetch !== "function") return;
    const normalizedMonthKey = monthKeyFromText(monthKey);
    const existingMonthKey = monthKeyFromText(state.dbStatus.data?.dailyTrend?.month || state.dbStatus.monthKey);
    if (normalizedMonthKey && existingMonthKey !== normalizedMonthKey) state.dbStatus.data = null;
    state.dbStatus.loading = true;
    state.dbStatus.error = "";
    state.dbStatus.monthKey = normalizedMonthKey;
    refreshDbStatusUi();
    try {
      const url = normalizedMonthKey ? `${DB_STATUS_UI_API}?month=${encodeURIComponent(normalizedMonthKey)}` : DB_STATUS_UI_API;
      const response = await fetch(url, { cache: "no-store" });
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }
      if (!response.ok || (payload && payload.ok === false)) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`);
      }
      state.dbStatus.data = payload;
      state.dbStatus.monthKey = monthKeyFromText(payload?.dailyTrend?.month || normalizedMonthKey);
      state.dbStatus.error = "";
    } catch (error) {
      if (dbStatusDemoEnabled()) {
        state.dbStatus.data = demoDbStatusPayload(normalizedMonthKey);
        state.dbStatus.monthKey = monthKeyFromText(state.dbStatus.data?.dailyTrend?.month || normalizedMonthKey);
        state.dbStatus.error = "";
        return;
      }
      state.dbStatus.error = `DB status API unavailable; showing static snapshot data. ${error && error.message ? error.message : ""}`.trim();
    } finally {
      state.dbStatus.loading = false;
      refreshDbStatusUi();
    }
  }

  async function loadDbTierSummary(monthKey) {
    if (typeof fetch !== "function") return;
    const normalizedMonthKey = monthKeyFromText(monthKey);
    if (!normalizedMonthKey) return;
    if (state.dbTierSummary.monthKey === normalizedMonthKey && state.dbTierSummary.data) return;
    state.dbTierSummary.loading = true;
    state.dbTierSummary.monthKey = normalizedMonthKey;
    try {
      const url = `${DB_TIER_SUMMARY_API}?month=${encodeURIComponent(normalizedMonthKey)}`;
      const response = await fetch(url, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || (payload && payload.ok === false)) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`);
      }
      state.dbTierSummary.data = payload;
    } catch (error) {
      state.dbTierSummary.data = null;
    } finally {
      state.dbTierSummary.loading = false;
      renderSheetPage();
    }
  }

  function targetMetricConfig(key = state.targetMetric) {
    return TARGET_METRICS.find((metric) => metric.key === key) || TARGET_METRICS[0];
  }

  function targetRowMetricValue(record, key = state.targetMetric) {
    if (key === "orders") return parseSheetNumber(record["Order Count"]);
    if (key === "clicks") return parseSheetNumber(record["Total Clicks"]);
    if (key === "conversion") return (percentageNumberForHeader("Avg Conversion", record["Avg Conversion"]) || 0) / 100;
    if (key === "brands") return parseSheetNumber(record["Brand Count"]);
    return parseSheetNumber(record.Revenue);
  }

  function targetSummaryMetricValue(summary, key = state.targetMetric) {
    if (key === "orders") return summary.orders;
    if (key === "clicks") return summary.clicks;
    if (key === "conversion") return targetAvgConversion(summary);
    if (key === "brands") return summary.brands;
    return summary.revenue;
  }

  function formatTargetMetricValue(key, value) {
    if (key === "revenue") return compactMoney(value);
    if (key === "conversion") return shortPct(value);
    return compactNumber(value);
  }

  function targetComparisonMap(rows) {
    return new Map(targetMetricRows(rows).map((row) => [String(row.Tier || ""), row]));
  }

  function targetDeltaHtml(current, comparison, mode, comparisonLabel) {
    if (!comparisonLabel || comparison === null || comparison === undefined) return `<span class="target-delta flat">No comparison</span>`;
    const diff = Number(current || 0) - Number(comparison || 0);
    if (!Number.isFinite(diff) || Math.abs(diff) < 0.000001) return `<span class="target-delta flat">0 vs ${escapeHtml(comparisonLabel)}</span>`;
    const direction = diff > 0 ? "up" : "down";
    let text = "";
    if (mode === "rate") {
      text = `${Math.abs(diff * 100).toFixed(2)}pp vs ${comparisonLabel}`;
    } else {
      const denom = Math.abs(Number(comparison || 0));
      const pctChange = denom ? diff / denom : null;
      text = pctChange === null
        ? `${compactNumber(Math.abs(diff))} vs ${comparisonLabel}`
        : `${Math.abs(pctChange * 100).toFixed(1)}% vs ${comparisonLabel}`;
    }
    return `<span class="target-delta ${direction}">${direction === "up" ? "+" : "-"} ${escapeHtml(text)}</span>`;
  }

  function renderSheetSummary(records, comparisonRecords, comparisonLabel) {
    const selectedMonthKey = targetDbStatusMonthKey();
    const useDatabase = state.targetFilters.tier === "all" && Boolean(selectedMonthKey);
    const databaseTotals = useDatabase ? dbMonthlyRowForKey(selectedMonthKey) : null;
    const comparisonMonthKey = monthKeyFromText(targetMonthSortValue(comparisonLabel));
    const databaseComparison = useDatabase && comparisonMonthKey ? dbMonthlyRowForKey(comparisonMonthKey) : null;
    const staticTotals = targetSummary(records);
    const staticComparison = comparisonRecords && comparisonRecords.length ? targetSummary(comparisonRecords) : null;
    const totals = databaseTotals
      ? {
          revenue: databaseTotals.revenue,
          orders: databaseTotals.orders,
          clicks: databaseTotals.clicks,
          brands: databaseTotals.activeBrands
        }
      : staticTotals;
    const comparison = databaseComparison
      ? {
          revenue: databaseComparison.revenue,
          orders: databaseComparison.orders,
          clicks: databaseComparison.clicks,
          brands: databaseComparison.activeBrands
        }
      : staticComparison;
    const avgConversion = databaseTotals ? databaseTotals.conversionRate : targetAvgConversion(totals);
    const comparisonConversion = databaseComparison
      ? databaseComparison.conversionRate
      : comparison ? targetAvgConversion(comparison) : null;
    const cards = [
      { icon: "$", label: "Revenue", value: compactMoney(totals.revenue), delta: targetDeltaHtml(totals.revenue, comparison && comparison.revenue, "number", comparisonLabel), tone: "blue" },
      { icon: "#", label: "Orders", value: compactNumber(totals.orders), delta: targetDeltaHtml(totals.orders, comparison && comparison.orders, "number", comparisonLabel), tone: "green" },
      { icon: "C", label: "Clicks", value: compactNumber(totals.clicks), delta: targetDeltaHtml(totals.clicks, comparison && comparison.clicks, "number", comparisonLabel), tone: "amber" },
      { icon: "%", label: "Avg Conversion", value: shortPct(avgConversion), delta: targetDeltaHtml(avgConversion, comparisonConversion, "rate", comparisonLabel), tone: "violet" },
      { icon: "B", label: databaseTotals ? "Active Merchants" : "Active Brands", value: compactNumber(totals.brands), delta: targetDeltaHtml(totals.brands, comparison && comparison.brands, "number", comparisonLabel), tone: "slate" }
    ];
    els.sheetPageSummary.innerHTML = cards.map((card, index) => (
      `<article class="target-kpi-card target-card-enter" style="--i:${index}">
        <div class="target-kpi-icon ${escapeHtml(card.tone)}">${escapeHtml(card.icon)}</div>
        <div>
          <span>${escapeHtml(labelText(card.label))}</span>
          <strong>${escapeHtml(card.value)}</strong>
          ${card.delta}
        </div>
      </article>`
    )).join("");
  }

  function targetGoal(record) {
    const text = String(record.Target || "");
    const revenue = text.match(/Revenue Target:\s*\$?\s*([\d,.]+)\s*([KMB])?\+?/i);
    if (revenue) {
      const scale = { K: 1000, M: 1000000, B: 1000000000 }[String(revenue[2] || "").toUpperCase()] || 1;
      const target = parseSheetNumber(revenue[1]) * scale;
      return { type: "revenue", label: "Revenue target", target, actual: parseSheetNumber(record.Revenue), targetText: compactMoney(target), actualText: compactMoney(parseSheetNumber(record.Revenue)) };
    }
    const promote = text.match(/Brand Target:\s*Promote\s*([\d,.]+)\s*Brands?/i);
    if (promote) {
      const target = parseSheetNumber(promote[1]);
      const actual = parseSheetNumber(record["Tier Exits"]);
      return { type: "promotion", label: "Promotion target", target, actual, targetText: `${target.toLocaleString()} brands`, actualText: `${actual.toLocaleString()} moved` };
    }
    const brand = text.match(/Brand Target:\s*([\d,.]+)\+?/i);
    if (brand) {
      const target = parseSheetNumber(brand[1]);
      const actual = parseSheetNumber(record["Brand Count"]);
      return { type: "brand", label: "Brand target", target, actual, targetText: `${target.toLocaleString()} brands`, actualText: `${actual.toLocaleString()} active` };
    }
    return null;
  }

  function targetEditValue(record, goal) {
    const text = String(record.Target || "");
    if (goal && goal.type === "revenue") {
      const match = text.match(/Revenue Target:\s*([^;]+)/i);
      return match ? match[1].trim() : goal.targetText;
    }
    if (goal && goal.type === "promotion") {
      const match = text.match(/Brand Target:\s*Promote\s*([\d,.]+)\s*Brands?/i);
      return match ? match[1].trim().replace(/,/g, "") : String(goal.target || "");
    }
    if (goal && goal.type === "brand") {
      const match = text.match(/Brand Target:\s*([\d,.]+)/i);
      return match ? match[1].trim().replace(/,/g, "") : String(goal.target || "");
    }
    return String(record.Target || "").trim();
  }

  function targetEditInputAttributes(goal) {
    if (goal && (goal.type === "promotion" || goal.type === "brand")) {
      return `type="number" inputmode="numeric" min="0" step="1"`;
    }
    return `type="text"`;
  }

  function replaceTargetClause(text, pattern, replacement) {
    const current = String(text || "").trim();
    if (!current) return replacement;
    return pattern.test(current) ? current.replace(pattern, replacement) : `${current}; ${replacement}`;
  }

  function targetTextFromEditValue(record, value) {
    const goal = targetGoal(record);
    const clean = String(value || "").trim();
    if (!clean || !goal) return clean;
    const current = String(record.Target || "").trim();
    if (goal.type === "revenue") {
      return replaceTargetClause(current, /Revenue Target:\s*[^;]+/i, `Revenue Target: ${clean}`);
    }
    if (goal.type === "promotion") {
      const count = (clean.match(/[\d,.]+/) || [""])[0] || clean;
      const suffixMatch = current.match(/Brand Target:\s*Promote\s*[\d,.]+\s*Brands?([^;]*)/i);
      const suffix = suffixMatch && suffixMatch[1] ? suffixMatch[1].trim() : "";
      return replaceTargetClause(current, /Brand Target:\s*Promote\s*[^;]+/i, `Brand Target: Promote ${count} Brands${suffix ? ` ${suffix}` : ""}`);
    }
    if (goal.type === "brand") {
      return replaceTargetClause(current, /Brand Target:\s*(?!Promote)[^;]+/i, `Brand Target: ${clean}`);
    }
    return clean;
  }

  function targetGoalCardHtml(record, index) {
    const goal = targetGoal(record);
    if (!goal || !goal.target) return "";
    const progress = goal.actual / goal.target;
    const capped = Math.max(0, Math.min(100, progress * 100));
    const delta = goal.actual - goal.target;
    const met = delta >= 0;
    const editKey = record.__targetOverrideKey || targetOverrideKey(record);
    const targetControl = state.targetEditingKey === editKey
      ? `<form class="target-edit-form" data-target-edit-form data-target-edit-key="${escapeHtml(editKey)}">
          <input name="target" ${targetEditInputAttributes(goal)} value="${escapeHtml(targetEditValue(record, goal))}" aria-label="Target value for ${escapeHtml(record.Tier)}" />
          <button type="submit">Save</button>
          <button type="button" data-target-edit-cancel>Cancel</button>
        </form>`
      : `<span class="target-value-line">
          <strong>${escapeHtml(goal.targetText)}</strong>
          <button class="target-edit-button" type="button" data-target-edit-key="${escapeHtml(editKey)}" aria-label="Edit target for ${escapeHtml(record.Tier)}">Edit</button>
        </span>`;
    return `<article class="target-progress-card target-card-enter" style="--i:${index}">
      <div class="target-progress-card-head">
        <div>
          <strong>${escapeHtml(record.Tier)}</strong>
          <span>${escapeHtml(goal.label)}</span>
        </div>
        <span class="target-status-pill ${met ? "met" : "miss"}">${met ? "On track" : "Watch"}</span>
      </div>
      <div class="target-progress-values">
        <div>
          <span>Target</span>
          ${targetControl}
        </div>
        <div><span>Actual</span><strong>${escapeHtml(goal.actualText)}</strong></div>
      </div>
      <div class="target-progress-bar" aria-hidden="true"><span style="width:${capped.toFixed(2)}%"></span></div>
      <p class="${met ? "positive" : "negative"}">${met ? "+" : "-"} ${escapeHtml(delta >= 0 ? `${compactNumber(delta)} above target` : `${compactNumber(Math.abs(delta))} to target`)}</p>
    </article>`;
  }

  function targetProgressHtml(records) {
    const cards = targetMetricRows(records).map(targetGoalCardHtml).filter(Boolean);
    return `<section class="target-progress-section target-card-enter" style="--i:6">
      <div class="target-section-header">
        <div>
          <h3>Tier target progress</h3>
          <p>${escapeHtml(state.targetFilters.month === "all" ? "All months" : state.targetFilters.month)} targets by tier</p>
        </div>
        <span>${cards.length.toLocaleString()} active targets</span>
      </div>
      <div class="target-progress-grid">${cards.length ? cards.join("") : `<div class="target-empty-state">No written targets match the selected month and tier.</div>`}</div>
    </section>`;
  }

  function targetTrendView() {
    return state.targetTrendView === "day" ? "day" : "month";
  }

  function targetTrendSubtitle(metric = targetMetricConfig()) {
    if (targetTrendView() === "day") {
      const monthKey = targetDbStatusMonthKey() || state.dbStatus.monthKey || monthKeyFromText(state.dbStatus.data?.dailyTrend?.month || "");
      const monthLabel = monthLabelFromKey(monthKey);
      const prefix = monthLabel === "Reporting" ? "Latest daily" : `${monthLabel} daily`;
      return `${prefix} ${metric.label.toLowerCase()} by calendar day. Each bar is independent, not cumulative`;
    }
    const tier = state.targetFilters.tier;
    return tier === "all" ? `${metric.label} across the six-month window ending at the selected month` : `${tier} ${metric.label.toLowerCase()} trajectory from the tier snapshot`;
  }

  function targetTrendViewTabsHtml() {
    const view = targetTrendView();
    return TARGET_TREND_VIEWS.map((item) => (
      `<button class="target-trend-view-tab${item.key === view ? " active" : ""}" type="button" data-target-trend-view="${escapeHtml(item.key)}" aria-pressed="${item.key === view ? "true" : "false"}">${escapeHtml(item.label)}</button>`
    )).join("");
  }

  function targetMetricTabsHtml(metric = targetMetricConfig()) {
    return TARGET_METRICS.map((item) => (
      `<button class="target-metric-tab${item.key === metric.key ? " active" : ""}" type="button" data-target-metric="${escapeHtml(item.key)}" aria-pressed="${item.key === metric.key ? "true" : "false"}">${escapeHtml(item.label)}</button>`
    )).join("");
  }

  function targetMonthlyTrendRows(allRecords, metric = targetMetricConfig()) {
    const tier = state.targetFilters.tier;
    const selectedMonth = state.targetFilters.month;
    const selectedMonthKey = targetDbStatusMonthKey();
    const apiMonthKey = monthKeyFromText(state.dbStatus.data?.recentMonths?.window?.endMonth || state.dbStatus.data?.dailyTrend?.month || "");
    const liveRows = tier === "all" && state.dbStatus.data && (!selectedMonthKey || !apiMonthKey || selectedMonthKey === apiMonthKey)
      ? dbMonthlyTrendRows(state.dbStatus.data)
      : [];
    if (liveRows.length) {
      return liveRows.map((row) => {
        const value = targetDailyMetricValue(row, metric.key);
        const sourceText = state.dbStatus.data?.demo ? "local preview data" : "production database";
        return {
          ...row,
          value,
          selected: Boolean(selectedMonthKey && row.monthKey === selectedMonthKey),
          state: "month database",
          detail: `${row.label}: ${formatTargetMetricValue(metric.key, value)} from ${sourceText}`
        };
      });
    }
    const months = Array.from(new Set(allRecords.map((record) => record.Month).filter(Boolean)))
      .sort((a, b) => String(targetMonthSortValue(a)).localeCompare(String(targetMonthSortValue(b))));
    const selectedIndex = selectedMonth && selectedMonth !== "all" ? months.indexOf(selectedMonth) : months.length - 1;
    const windowEnd = selectedIndex >= 0 ? selectedIndex + 1 : months.length;
    const windowMonths = months.slice(Math.max(0, windowEnd - 6), windowEnd);
    return windowMonths
      .map((month) => {
        const summary = targetSummary(targetRowsForMonth(allRecords, month, tier));
        const value = targetSummaryMetricValue(summary, metric.key);
        return {
          label: month,
          shortLabel: monthAxisLabel(targetMonthSortValue(month), { short: true }),
          monthKey: monthKeyFromText(targetMonthSortValue(month)),
          value,
          selected: month === selectedMonth,
          state: "month snapshot",
          detail: `${month}: ${formatTargetMetricValue(metric.key, value)}`
        };
      });
  }

  function targetDailyMetricValue(row, key = state.targetMetric) {
    if (key === "orders") return Number(row.orders) || 0;
    if (key === "clicks") return Number(row.clicks) || 0;
    if (key === "conversion") return Number(row.conversionRate) || 0;
    if (key === "brands") return Number(row.activeBrands ?? row.brandCount ?? row.activeAdvertisers) || 0;
    return Number(row.revenue) || 0;
  }

  function targetDailyTrendRows(metric = targetMetricConfig()) {
    return dbDailyTrendRows(state.dbStatus.data).map((row) => {
      const rawValue = targetDailyMetricValue(row, metric.key);
      const hasPartialValue = row.state === "delay" && Math.abs(rawValue) > 0.000001;
      const hasValue = row.state !== "delay" || hasPartialValue;
      const value = hasValue ? rawValue : null;
      return {
        label: shortDateLabel(row.date),
        shortLabel: axisDateLabel(row.date),
        value,
        state: row.state || "observed",
        detail: `${shortDateLabel(row.date)}: ${hasValue ? formatTargetMetricValue(metric.key, rawValue) : "Pending"}${row.state === "delay" ? " (partial)" : ""}`
      };
    });
  }

  function targetTrendSvgHtml(trendRows, metric, viewLabel) {
    const values = trendRows.map((row) => row.value);
    const numericValues = values.filter((value) => Number.isFinite(value));
    if (!numericValues.length) {
      return `<div class="target-empty-state">${viewLabel === "Day" ? "Daily trend data is still loading." : "No trend data is available for this selection."}</div>`;
    }
    const max = Math.max(...numericValues, 1);
    const min = 0;
    const width = 760;
    const height = 240;
    const pad = { left: 68, right: 24, top: 34, bottom: 42 };
    const innerWidth = width - pad.left - pad.right;
    const innerHeight = height - pad.top - pad.bottom;
    const range = max - min || 1;
    const points = trendRows.map((row, index) => {
      const x = pad.left + (trendRows.length <= 1 ? innerWidth / 2 : (index / (trendRows.length - 1)) * innerWidth);
      const hasValue = Number.isFinite(row.value);
      const y = hasValue ? pad.top + innerHeight - ((row.value - min) / range) * innerHeight : height - pad.bottom;
      return { ...row, x, y, hasValue };
    });
    const isDaily = viewLabel === "Day";
    const polyline = points.filter((point) => point.hasValue).map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const labelEvery = viewLabel === "Day" && points.length > 14 ? Math.ceil(points.length / 9) : 1;
    const gridTicks = [0, 0.25, 0.5, 0.75, 1];
    const dailyStep = points.length > 1 ? innerWidth / (points.length - 1) : innerWidth;
    const dailyBarWidth = Math.max(5, Math.min(18, dailyStep * 0.58));
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(viewLabel)} ${escapeHtml(metric.label)} trend" data-trend-aggregation="${isDaily ? "daily-independent" : "monthly"}">
      ${gridTicks.map((ratio) => {
        const y = pad.top + innerHeight - ratio * innerHeight;
        const value = min + ratio * range;
        return `<g class="trend-grid"><line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${width - pad.right}" y2="${y.toFixed(2)}"></line><text x="${pad.left - 12}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml(formatTargetMetricValue(metric.key, value))}</text></g>`;
      }).join("")}
      ${isDaily ? "" : `<polyline points="${polyline}" class="trend-line"></polyline>`}
      ${points.map((point, index) => `<g class="target-trend-point ${escapeHtml(point.state || "")}${point.selected ? " selected" : ""}" tabindex="0" role="img" aria-label="${escapeHtml(point.detail || point.label)}">
        <title>${escapeHtml(point.detail || point.label)}</title>
        ${isDaily
          ? `<rect x="${(point.x - dailyBarWidth / 2).toFixed(2)}" y="${point.hasValue ? point.y.toFixed(2) : (height - pad.bottom - 4).toFixed(2)}" width="${dailyBarWidth.toFixed(2)}" height="${point.hasValue ? Math.max(4, height - pad.bottom - point.y).toFixed(2) : "4"}" rx="2.5" class="target-daily-bar ${point.hasValue ? "" : "muted"} ${escapeHtml(point.state || "")}"></rect>`
          : `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${point.selected ? "6" : "4.5"}" class="trend-dot ${point.hasValue ? "" : "muted"} ${escapeHtml(point.state || "")}"></circle>`}
        ${point.hasValue && (point.selected || (viewLabel === "Day" && index === points.length - 1)) ? `<text x="${point.x.toFixed(2)}" y="${Math.max(18, point.y - 14).toFixed(2)}" text-anchor="middle" class="trend-value-label">${escapeHtml(formatTargetMetricValue(metric.key, point.value))}</text>` : ""}
        ${(index === 0 || index === points.length - 1 || index % labelEvery === 0) ? `<text x="${point.x.toFixed(2)}" y="${height - 12}" text-anchor="middle" class="trend-month">${escapeHtml(point.shortLabel || point.label)}</text>` : ""}
      </g>`).join("")}
    </svg>`;
  }

  function targetTrendPlotHtml(allRecords) {
    const metric = targetMetricConfig();
    if (targetTrendView() === "day") {
      const desiredMonth = targetDbStatusMonthKey();
      const dataMonth = monthKeyFromText(state.dbStatus.data?.dailyTrend?.month || "");
      if (desiredMonth && dataMonth && dataMonth !== desiredMonth) {
        return `<div class="target-empty-state">Loading ${escapeHtml(monthLabelFromKey(desiredMonth))} daily trend data.</div>`;
      }
      if (!state.dbStatus.data && state.dbStatus.loading) {
        return `<div class="target-empty-state">Loading daily trend data.</div>`;
      }
      if (!state.dbStatus.data && state.dbStatus.error) {
        return `<div class="target-empty-state">${escapeHtml(state.dbStatus.error)}</div>`;
      }
      return targetTrendSvgHtml(targetDailyTrendRows(metric), metric, "Day");
    }
    const desiredMonth = targetDbStatusMonthKey();
    const dataMonth = monthKeyFromText(state.dbStatus.data?.recentMonths?.window?.endMonth || state.dbStatus.data?.dailyTrend?.month || "");
    if (state.targetFilters.tier === "all" && desiredMonth && state.dbStatus.loading && dataMonth !== desiredMonth) {
      return `<div class="target-empty-state">Loading the six-month database window ending ${escapeHtml(monthAxisLabel(desiredMonth))}.</div>`;
    }
    return targetTrendSvgHtml(targetMonthlyTrendRows(allRecords, metric), metric, "Monthly");
  }

  function targetTrendHeading() {
    return targetTrendView() === "day" ? "Daily trend" : "Monthly trend";
  }

  function targetTrendSourceHtml() {
    const tierIsDatabaseEligible = state.targetFilters.tier === "all";
    const desiredMonth = targetDbStatusMonthKey();
    const dataMonth = monthKeyFromText(state.dbStatus.data?.dailyTrend?.month || state.dbStatus.data?.recentMonths?.window?.endMonth || "");
    if (tierIsDatabaseEligible && state.dbStatus.data && (!desiredMonth || !dataMonth || desiredMonth === dataMonth)) {
      const model = dbStatusViewModel(state.dbStatus.data);
      const completeThrough = model.observedThrough || model.expectedCompleteThrough || state.dbStatus.data?.recentMonths?.window?.throughDate;
      const status = state.dbStatus.data.demo
        ? "Local preview"
        : model.health === "stale" ? "Database delayed" : "Production database";
      return `<span class="target-source-status ${escapeHtml(model.health)}"><i aria-hidden="true"></i>${escapeHtml(status)}</span>
        <span>Orders and revenue: cnpscy_order_new_aggregate</span>
        <span>Clicks: cnpscy_amazon_click</span>
        <span>Complete through ${escapeHtml(shortDateLabel(completeThrough))}</span>
        ${targetTrendView() === "day" ? `<span>One bar equals one calendar day</span>` : ""}`;
    }
    if (tierIsDatabaseEligible && state.dbStatus.loading) {
      return `<span class="target-source-status syncing"><i aria-hidden="true"></i>Syncing database</span><span>Loading verified monthly and daily totals</span>`;
    }
    if (tierIsDatabaseEligible && state.dbStatus.error) {
      return `<span class="target-source-status fallback"><i aria-hidden="true"></i>Sheet fallback</span><span>${escapeHtml(state.dbStatus.error)}</span>`;
    }
    return `<span class="target-source-status snapshot"><i aria-hidden="true"></i>Tier snapshot</span><span>Tier filtering uses the reporting sheet because the production tables do not contain a verified tier mapping</span>`;
  }

  function targetTrendHtml(allRecords) {
    const metric = targetMetricConfig();
    return `<section class="target-report-card target-trend-card target-card-enter" style="--i:5">
      <div class="target-section-header">
        <div>
          <h3 data-target-trend-heading>${escapeHtml(targetTrendHeading())}</h3>
          <p data-target-trend-subtitle>${escapeHtml(targetTrendSubtitle(metric))}</p>
        </div>
        <div class="target-trend-controls">
          <div class="target-trend-view-tabs" aria-label="Trend view">${targetTrendViewTabsHtml()}</div>
          <div class="target-metric-tabs" aria-label="Trend metric">${targetMetricTabsHtml(metric)}</div>
        </div>
      </div>
      <div class="target-trend-source" data-target-trend-source>${targetTrendSourceHtml()}</div>
      <div class="target-trend-plot">
        ${targetTrendPlotHtml(allRecords)}
      </div>
    </section>`;
  }

  function targetWrittenGoalForMetric(record, key = state.targetMetric) {
    const text = String(record.Target || "");
    if (key === "revenue") {
      const revenue = text.match(/Revenue Target:\s*\$?\s*([\d,.]+)\s*([KMB])?\+?/i);
      if (!revenue) return null;
      const scale = { K: 1000, M: 1000000, B: 1000000000 }[String(revenue[2] || "").toUpperCase()] || 1;
      const target = parseSheetNumber(revenue[1]) * scale;
      return { basis: "target", label: "Revenue target", target, actual: targetRowMetricValue(record, key) };
    }
    if (key === "brands") {
      const promote = text.match(/Brand Target:\s*Promote\s*([\d,.]+)\s*Brands?/i);
      if (promote) {
        const target = parseSheetNumber(promote[1]);
        return { basis: "target", label: "Promotion target", target, actual: parseSheetNumber(record["Tier Exits"]) };
      }
      const brand = text.match(/Brand Target:\s*([\d,.]+)\+?/i);
      if (!brand) return null;
      const target = parseSheetNumber(brand[1]);
      return { basis: "target", label: "Brand target", target, actual: targetRowMetricValue(record, key) };
    }
    return null;
  }

  function targetMetricComparisonScore(record, comparisonMap) {
    const metric = targetMetricConfig();
    const goal = targetWrittenGoalForMetric(record, metric.key);
    if (goal && goal.target) return goal.actual / goal.target;
    const comparison = comparisonMap && comparisonMap.get(String(record.Tier || ""));
    if (!comparison) return "";
    const current = targetRowMetricValue(record, metric.key);
    const previous = targetRowMetricValue(comparison, metric.key);
    if (!previous) return current ? 1 : 0;
    return (current - previous) / Math.abs(previous);
  }

  function targetMetricVsHtml(record, comparisonMap, comparisonLabel) {
    if (isTargetTotalRow(record)) return `<span class="target-matrix-delta total">Portfolio</span>`;
    const metric = targetMetricConfig();
    const goal = targetWrittenGoalForMetric(record, metric.key);
    if (goal && goal.target) {
      const pctValue = goal.actual / goal.target;
      const delta = goal.actual - goal.target;
      return `<span class="target-matrix-delta ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "+" : "-"} ${(pctValue * 100).toFixed(0)}% target</span>`;
    }
    const comparison = comparisonMap && comparisonMap.get(String(record.Tier || ""));
    if (!comparison || !comparisonLabel) return `<span class="target-matrix-delta flat">No benchmark</span>`;
    const current = targetRowMetricValue(record, metric.key);
    const previous = targetRowMetricValue(comparison, metric.key);
    const diff = current - previous;
    if (Math.abs(diff) < 0.000001) return `<span class="target-matrix-delta flat">0 vs ${escapeHtml(comparisonLabel)}</span>`;
    const direction = diff > 0 ? "up" : "down";
    const text = metric.key === "conversion"
      ? `${Math.abs(diff * 100).toFixed(2)}pp`
      : (previous ? `${Math.abs((diff / Math.abs(previous)) * 100).toFixed(1)}%` : formatTargetMetricValue(metric.key, Math.abs(diff)));
    return `<span class="target-matrix-delta ${direction}">${direction === "up" ? "+" : "-"} ${escapeHtml(text)} vs ${escapeHtml(comparisonLabel)}</span>`;
  }

  function targetMatrixSortHeaderHtml(key, label) {
    const active = state.targetSort.key === key;
    const direction = active ? state.targetSort.direction : "";
    const indicator = active ? (direction === "asc" ? "&#8593;" : "&#8595;") : "&#8597;";
    return `<th><button class="table-sort-button target-sort-button${active ? " active" : ""}" type="button" data-report-sort-scope="target" data-report-sort-key="${escapeHtml(key)}" aria-label="Sort by ${escapeHtml(label)}">
      <span>${escapeHtml(label)}</span>
      <span class="sort-indicator" aria-hidden="true">${indicator}</span>
    </button></th>`;
  }

  function targetMatrixSortValue(row, key, comparisonMap) {
    if (key === "Tier") return targetTierSortRank(row.Tier);
    if (key === "Active Brands") return targetRowMetricValue(row, "brands");
    if (key === "Revenue") return targetRowMetricValue(row, "revenue");
    if (key === "Orders") return targetRowMetricValue(row, "orders");
    if (key === "Clicks") return targetRowMetricValue(row, "clicks");
    if (key === "Avg Conversion") return targetRowMetricValue(row, "conversion");
    if (key === "New Entries") return parseSheetNumber(row["New Tier Entries"]);
    if (key === "Exits") return parseSheetNumber(row["Tier Exits"]);
    if (key === "vs Target") return targetMetricComparisonScore(row, comparisonMap);
    return row[key];
  }

  function sortedTargetMatrixRows(records, comparisonMap) {
    const rows = targetMetricRows(records);
    const sortState = state.targetSort && state.targetSort.key ? state.targetSort : { key: "Tier", direction: "asc" };
    const multiplier = sortState.direction === "desc" ? -1 : 1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const left = targetMatrixSortValue(a.row, sortState.key, comparisonMap);
        const right = targetMatrixSortValue(b.row, sortState.key, comparisonMap);
        const leftEmpty = String(left ?? "").trim() === "";
        const rightEmpty = String(right ?? "").trim() === "";
        if (leftEmpty || rightEmpty) {
          if (leftEmpty === rightEmpty) return a.index - b.index;
          return leftEmpty ? 1 : -1;
        }
        const result = compareReportValues(sortState.key, left, right);
        return result ? result * multiplier : a.index - b.index;
      })
      .map((item) => item.row);
  }

  function targetVsGoalHtml(record) {
    if (isTargetTotalRow(record)) return `<span class="target-matrix-delta total">Portfolio</span>`;
    const goal = targetGoal(record);
    if (!goal || !goal.target) return `<span class="target-matrix-delta flat">No target</span>`;
    const delta = goal.actual - goal.target;
    const pctValue = goal.actual / goal.target;
    return `<span class="target-matrix-delta ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "+" : "-"} ${(pctValue * 100).toFixed(0)}%</span>`;
  }

  function targetMatrixHtml(records, comparisonRows = [], options = {}) {
    const metric = targetMetricConfig();
    const comparisonMap = targetComparisonMap(comparisonRows);
    const rows = sortedTargetMatrixRows(records, comparisonMap);
    const total = targetSummary(rows);
    const enterClass = options.animate === false ? "" : " target-card-enter";
    const enterStyle = options.animate === false ? "" : ` style="--i:7"`;
    const headers = [
      ["Tier", "Tier"],
      ["Active Brands", "Active Brands"],
      ["Revenue", "Revenue"],
      ["Orders", "Orders"],
      ["Clicks", "Clicks"],
      ["Avg Conversion", "Avg Conv."],
      ["New Entries", "New Entries"],
      ["Exits", "Exits"],
      ["vs Target", "vs Target"]
    ];
    const headerMap = new Map(headers);
    const mobileSortControls = headers.map(([key, label]) => targetMatrixSortHeaderHtml(key, label).replace(/^<th>|<\/th>$/g, "")).join("");
    const cell = (key, value) => `<td data-label="${escapeHtml(headerMap.get(key) || key)}">${value}</td>`;
    return `<section class="target-report-card target-matrix-card${enterClass}"${enterStyle}>
      <div class="target-section-header">
        <div>
          <h3>Tier comparison matrix</h3>
          <p>${escapeHtml(metric.label)} comparison with target, entries and exits by tier</p>
        </div>
      </div>
      <div class="target-mobile-sort-controls" aria-label="Sort tier comparison matrix">
        ${mobileSortControls}
      </div>
      <div class="table-wrap target-matrix-wrap">
        <table class="target-matrix-table">
          <thead><tr>${headers.map(([key, label]) => targetMatrixSortHeaderHtml(key, label)).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>
              ${cell("Tier", `<span class="target-tier-label"><span class="tier-dot ${escapeHtml(String(row.Tier).toLowerCase().replace(/[^a-z0-9]+/g, "-"))}"></span><strong>${escapeHtml(row.Tier)}</strong></span>`)}
              ${cell("Active Brands", parseSheetNumber(row["Brand Count"]).toLocaleString())}
              ${cell("Revenue", compactMoney(parseSheetNumber(row.Revenue)))}
              ${cell("Orders", parseSheetNumber(row["Order Count"]).toLocaleString())}
              ${cell("Clicks", parseSheetNumber(row["Total Clicks"]).toLocaleString())}
              ${cell("Avg Conversion", escapeHtml(formatSheetCell("Avg Conversion", row["Avg Conversion"])))}
              ${cell("New Entries", parseSheetNumber(row["New Tier Entries"]).toLocaleString())}
              ${cell("Exits", parseSheetNumber(row["Tier Exits"]).toLocaleString())}
              ${cell("vs Target", targetMetricVsHtml(row, comparisonMap, state.targetFilters.compareMonth))}
            </tr>`).join("")}
            <tr class="target-matrix-total">
              ${cell("Tier", "<strong>Total</strong>")}
              ${cell("Active Brands", total.brands.toLocaleString())}
              ${cell("Revenue", compactMoney(total.revenue))}
              ${cell("Orders", total.orders.toLocaleString())}
              ${cell("Clicks", total.clicks.toLocaleString())}
              ${cell("Avg Conversion", shortPct(targetAvgConversion(total)))}
              ${cell("New Entries", total.newEntries.toLocaleString())}
              ${cell("Exits", total.exits.toLocaleString())}
              ${cell("vs Target", `<span class="target-matrix-delta total">Portfolio</span>`)}
            </tr>
          </tbody>
        </table>
      </div>
    </section>`;
  }

  function renderSheetPage() {
    refreshTargetFilters();
    const allRecords = targetRecords();
    const rows = filteredTargetRecords();
    const comparisonRows = state.targetFilters.compareMonth
      ? targetRowsForMonth(allRecords, state.targetFilters.compareMonth, state.targetFilters.tier)
      : [];
    if (!rows.length) {
      els.sheetPageTitle.textContent = "Report Overview";
      els.sheetPageSubtitle.textContent = t("sheet.noTargets", "No target rows found in the current sheet export");
      els.sheetPageSummary.innerHTML = "";
      els.sheetPageNotes.innerHTML = `<p>${escapeHtml(t("sheet.noTargetMatch", "No target data matched the selected filters."))}</p>`;
      if (els.sheetGridHead) els.sheetGridHead.innerHTML = "";
      if (els.sheetGridRows) els.sheetGridRows.innerHTML = "";
      if (els.sheetTableCount) els.sheetTableCount.textContent = "";
      return;
    }
    const monthText = state.targetFilters.month === "all" ? optionText("All months") : state.targetFilters.month;
    const tierText = state.targetFilters.tier === "all" ? "all tiers" : state.targetFilters.tier;
    els.sheetPageTitle.textContent = "Report Overview";
    els.sheetPageSubtitle.textContent = `${monthText} performance summary for ${tierText}`;
    renderSheetSummary(rows, comparisonRows, state.targetFilters.compareMonth);
    els.sheetPageNotes.innerHTML = `${targetTrendHtml(allRecords)}${targetProgressHtml(rows)}${targetMatrixHtml(rows, comparisonRows)}`;
    ensureDbStatusForSelectedMonth();
    const tierSummaryMonthKey = targetDbStatusMonthKey();
    if (tierSummaryMonthKey && !state.dbTierSummary.data && !state.dbTierSummary.loading) {
      window.setTimeout(() => loadDbTierSummary(tierSummaryMonthKey), 0);
    }
  }

  function currentTargetPageData() {
    const allRecords = targetRecords();
    const rows = filteredTargetRecords();
    const comparisonRows = state.targetFilters.compareMonth
      ? targetRowsForMonth(allRecords, state.targetFilters.compareMonth, state.targetFilters.tier)
      : [];
    return { allRecords, rows, comparisonRows };
  }

  function animateTargetTrendPlot(plot) {
    if (!plot || !window.gsap || typeof window.gsap.fromTo !== "function") return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    window.gsap.fromTo(
      plot,
      { autoAlpha: 0.35, y: 8 },
      { autoAlpha: 1, y: 0, duration: 0.32, ease: "power2.out", overwrite: "auto", clearProps: "transform,opacity,visibility" }
    );
  }

  function refreshTargetTrendOnly(allRecords) {
    const trendCard = els.sheetPageNotes && els.sheetPageNotes.querySelector(".target-trend-card");
    if (!trendCard) return false;
    const metric = targetMetricConfig();
    const heading = trendCard.querySelector("[data-target-trend-heading]");
    const subtitle = trendCard.querySelector("[data-target-trend-subtitle]");
    const source = trendCard.querySelector("[data-target-trend-source]");
    const plot = trendCard.querySelector(".target-trend-plot");
    if (heading) heading.textContent = targetTrendHeading();
    if (subtitle) subtitle.textContent = targetTrendSubtitle(metric);
    if (source) source.innerHTML = targetTrendSourceHtml();
    if (plot) plot.innerHTML = targetTrendPlotHtml(allRecords);
    trendCard.querySelectorAll("[data-target-trend-view]").forEach((button) => {
      const active = button.dataset.targetTrendView === targetTrendView();
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    trendCard.querySelectorAll("[data-target-metric]").forEach((button) => {
      const active = button.dataset.targetMetric === metric.key;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    animateTargetTrendPlot(plot);
    return true;
  }

  function refreshTargetMatrixOnly(rows, comparisonRows) {
    const matrixCard = els.sheetPageNotes && els.sheetPageNotes.querySelector(".target-matrix-card");
    if (!matrixCard) return false;
    matrixCard.outerHTML = targetMatrixHtml(rows, comparisonRows, { animate: false });
    return true;
  }

  function refreshTargetMetricViews() {
    const { allRecords, rows, comparisonRows } = currentTargetPageData();
    const trendUpdated = refreshTargetTrendOnly(allRecords);
    const matrixUpdated = refreshTargetMatrixOnly(rows, comparisonRows);
    if (!trendUpdated || !matrixUpdated) renderSheetPage();
  }

  function focusTargetEditField() {
    window.requestAnimationFrame(() => {
      const input = els.sheetPageNotes && els.sheetPageNotes.querySelector(".target-edit-form input");
      if (input) input.focus();
    });
  }

  function handleTargetReportClick(event) {
    const cancelButton = event.target.closest("[data-target-edit-cancel]");
    if (cancelButton) {
      state.targetEditingKey = "";
      renderSheetPage();
      return;
    }
    const metricButton = event.target.closest("[data-target-metric]");
    if (metricButton) {
      state.targetMetric = metricButton.dataset.targetMetric || "revenue";
      refreshTargetMetricViews();
      return;
    }
    const trendViewButton = event.target.closest("[data-target-trend-view]");
    if (trendViewButton) {
      state.targetTrendView = trendViewButton.dataset.targetTrendView === "day" ? "day" : "month";
      const { allRecords } = currentTargetPageData();
      refreshTargetTrendOnly(allRecords);
      ensureDbStatusForSelectedMonth();
      return;
    }
    const editButton = event.target.closest(".target-edit-button[data-target-edit-key]");
    if (editButton) {
      state.targetEditingKey = editButton.dataset.targetEditKey || "";
      renderSheetPage();
      focusTargetEditField();
      return;
    }
    if (event.target.closest("[data-report-sort-key]")) handleReportSortClick(event);
  }

  function handleTargetReportSubmit(event) {
    const form = event.target.closest("[data-target-edit-form]");
    if (!form) return;
    event.preventDefault();
    const key = form.dataset.targetEditKey || "";
    const input = form.querySelector("input[name='target']");
    if (!key || !input) return;
    const value = input.value.trim();
    const currentRecord = targetRecords().find((record) => record.__targetOverrideKey === key);
    const targetText = currentRecord ? targetTextFromEditValue(currentRecord, value) : value;
    if (value) {
      const candidate = currentRecord ? { ...currentRecord, Target: targetText } : { Target: targetText };
      if (!targetGoal(candidate)) {
        input.setCustomValidity("Enter a valid target value.");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
    }
    if (value) {
      state.targetOverrides[key] = targetText;
    } else {
      delete state.targetOverrides[key];
    }
    saveTargetOverrides();
    state.targetEditingKey = "";
    renderSheetPage();
  }

  function updateReportsNavState() {
    if (els.sheetsNav) els.sheetsNav.setAttribute("aria-expanded", state.reportsOpen ? "true" : "false");
    if (els.reportsSubnav) els.reportsSubnav.classList.toggle("collapsed", !state.reportsOpen);
  }

  function updatePageModeClass(page = state.page) {
    if (!document.body) return;
    document.body.classList.toggle("dashboard-mode", page === "dashboard");
    document.body.classList.toggle("tier-scroll-mode", page === "tier");
  }

  function switchPage(page) {
    state.page = page;
    updatePageModeClass(page);
    if (page !== "tier") {
      state.selectedTierRowKeys.clear();
      closeTierSheetOverlay({ restoreFocus: false });
      closeTierMoveDialog();
    }
    const isTier = page === "tier";
    const isSheets = page === "sheets";
    const isCategory = page === "category";
    if (isSheets || isCategory || isTier) state.reportsOpen = true;
    document.querySelectorAll(".dashboard-page").forEach((el) => el.classList.toggle("hidden", page !== "dashboard"));
    els.paymentsPage.classList.toggle("hidden", page !== "payments");
    els.publishersPage.classList.toggle("hidden", page !== "publishers");
    els.sheetPage.classList.toggle("hidden", !isSheets);
    els.categoryPage.classList.toggle("hidden", !isCategory);
    els.tierPage.classList.toggle("hidden", !isTier);
    els.dashboardNav.classList.toggle("active", page === "dashboard");
    els.paymentsNav.classList.toggle("active", page === "payments");
    els.publishersNav.classList.toggle("active", page === "publishers");
    els.sheetsNav.classList.toggle("active", isSheets || isCategory || isTier);
    els.targetNav.classList.toggle("active", isSheets);
    els.categoryNav.classList.toggle("active", isCategory);
    els.tierNavButtons.forEach((button) => {
      button.classList.toggle("active", isTier && button.dataset.tierPage === state.selectedTierPage);
    });
    updateReportsNavState();
    // 切换页面时自动最小化所有非推理中的深度分析浮窗
    _deepPanels.forEach(function (p) {
      if (!p.minimized && !p.abortController) {
        _minimizeDeepPanel(p.id);
      }
    });
    // 浮动深度分析按钮只在 dashboard 页面显示
    els.deepAnalysisFab?.classList.toggle("hidden", page !== "dashboard");
    if (page === "payments") {
      renderPaymentsPage();
      if (!state.livePaymentsLoaded) refreshLevantaPayments({ silent: true });
    }
    if (page === "publishers") {
      renderPublishersPage();
    }
    if (isSheets) renderSheetPage();
    if (isCategory) renderDashboardCategoryReport();
    if (isTier) renderTierPage(state.selectedTierPage);
  }

  function init() {
    state.llmEnabled = window.__OI_LLM_ENABLED !== false;

    // 浮动深度分析按钮 & 模式切换
    els.deepAnalysisFab = document.getElementById("deepAnalysisFab");
    els.chatModeToggle = document.getElementById("chatModeToggle");
    els.modeFastBtn = els.chatModeToggle?.querySelector('[data-mode="fast"]');
    els.modeDeepBtn = els.chatModeToggle?.querySelector('[data-mode="deep"]');

    if (els.tier) fillSelect(els.tier, uniqueValues("tier"));
    if (els.network) fillSelect(els.network, uniqueValues("network"));
    if (els.category) fillSelect(els.category, uniqueCategoryValues());
    refreshPaymentFilterOptions();
    refreshTargetFilters();
    setDatasetStamp();
    setPaymentStamp("saved", isoDate(PAYMENT_TODAY));
    renderDashboardCategoryTierPicker();
    updateReportsNavState();
    updatePageModeClass();
    quickPrompts.forEach(({ key, prompt }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.promptKey = key;
      button.dataset.prompt = prompt;
      button.textContent = t(key, prompt);
      button.addEventListener("click", () => applyPrompt(prompt));
      els.quickActions.appendChild(button);
    });

    [els.tier, els.network, els.category].filter(Boolean).forEach((select) => {
      select.addEventListener("change", () => {
        state[select.id.replace("Filter", "")] = select.value;
        renderAll();
      });
    });
    if (els.minEpc) els.minEpc.addEventListener("input", () => { state.minEpc = els.minEpc.value; renderAll(); });
    if (els.minAov) els.minAov.addEventListener("input", () => { state.minAov = els.minAov.value; renderAll(); });
    if (els.minCvr) els.minCvr.addEventListener("input", () => { state.minCvr = els.minCvr.value; renderAll(); });
    if (els.notPaidOnly) els.notPaidOnly.addEventListener("change", () => { state.notPaidOnly = els.notPaidOnly.checked; renderAll(); });
    els.dashboardCategoryTierPicker.addEventListener("change", handleDashboardCategoryTierChange);
    els.dashboardCategorySearch.addEventListener("input", () => {
      state.categoryReportSearch = els.dashboardCategorySearch.value;
      state.categoryReportFocusKey = "";
      state.expandedCategoryKey = null;
      renderDashboardCategoryReport();
    });
    els.dashboardCategoryReportBody.addEventListener("click", handleDashboardCategoryReportClick);
    els.dashboardCategoryReportBody.addEventListener("keydown", handleDashboardCategoryReportKeydown);
    els.dashboardCategoryReportBody.addEventListener("pointermove", handleCategoryPointerMove);
    els.dashboardCategoryReportBody.addEventListener("pointerleave", clearCategoryHighlight);
    els.dashboardCategoryReportBody.addEventListener("focusin", handleCategoryFocus);
    els.dashboardCategoryReportBody.addEventListener("focusout", clearCategoryHighlight);
    els.dashboardNav.addEventListener("click", () => switchPage("dashboard"));
    els.paymentsNav.addEventListener("click", () => switchPage("payments"));
    els.publishersNav.addEventListener("click", () => switchPage("publishers"));
    els.sheetsNav.addEventListener("click", () => {
      state.reportsOpen = !state.reportsOpen;
      updateReportsNavState();
    });
    els.targetNav.addEventListener("click", () => switchPage("sheets"));
    els.categoryNav.addEventListener("click", () => switchPage("category"));
    els.targetMonthSelect.addEventListener("change", () => {
      state.targetFilters.month = els.targetMonthSelect.value;
      renderSheetPage();
    });
    els.targetCompareMonthSelect.addEventListener("change", () => {
      state.targetFilters.compareMonth = els.targetCompareMonthSelect.value;
      renderSheetPage();
    });
    els.targetTierFilter.addEventListener("change", () => {
      state.targetFilters.tier = els.targetTierFilter.value;
      renderSheetPage();
    });
    els.tierNavButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedTierPage = button.dataset.tierPage;
        state.selectedTierRowKeys.clear();
        setTierMoveStatus("");
        switchPage("tier");
      });
    });
    els.tierSheetSearch.addEventListener("input", () => { state.tierSheetFilters.search = els.tierSheetSearch.value; resetTierTablePage(); renderTierPage(state.selectedTierPage); });
    els.tierDateApply.addEventListener("click", applyTierReportDateRange);
    [els.tierStartDate, els.tierEndDate].forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") applyTierReportDateRange();
      });
    });
    els.tierSheetNetwork.addEventListener("change", () => { state.tierSheetFilters.network = els.tierSheetNetwork.value; resetTierTablePage(); renderTierPage(state.selectedTierPage); });
    els.tierSheetCountry.addEventListener("change", () => { state.tierSheetFilters.country = els.tierSheetCountry.value; resetTierTablePage(); renderTierPage(state.selectedTierPage); });
    els.tierSheetMinEpc.addEventListener("input", () => { state.tierSheetFilters.minEpc = els.tierSheetMinEpc.value; resetTierTablePage(); renderTierPage(state.selectedTierPage); });
    els.tierSheetMinRevenue.addEventListener("input", () => { state.tierSheetFilters.minRevenue = els.tierSheetMinRevenue.value; resetTierTablePage(); renderTierPage(state.selectedTierPage); });
    els.tierPagePrev.addEventListener("click", () => changeTierTablePage(-1));
    els.tierPageNext.addEventListener("click", () => changeTierTablePage(1));
    els.tierColumnToggle.addEventListener("click", () => {
      state.tierColumnPanelOpen = !state.tierColumnPanelOpen;
      renderTierPage(state.selectedTierPage);
    });
    els.tierColumnList.addEventListener("change", (event) => {
      const input = event.target.closest("input[type='checkbox']");
      const sheet = sheetByName(state.selectedTierPage);
      if (!input || !sheet) return;
      const allHeaders = displayHeadersForSheet(sheet, sheet.headers || []);
      const selected = Array.from(els.tierColumnList.querySelectorAll("input[type='checkbox']:checked"))
        .map((checkbox) => checkbox.value)
        .filter((header) => allHeaders.includes(header));
      if (!selected.length) {
        input.checked = true;
        return;
      }
      setTierVisibleHeaders(sheet, selected);
    });
    els.tierColumnCore.addEventListener("click", () => {
      const sheet = sheetByName(state.selectedTierPage);
      if (!sheet) return;
      const allHeaders = displayHeadersForSheet(sheet, sheet.headers || []);
      setTierVisibleHeaders(sheet, coreHeadersForSheet(sheet, allHeaders));
    });
    els.tierColumnAll.addEventListener("click", () => {
      const sheet = sheetByName(state.selectedTierPage);
      if (!sheet) return;
      setTierVisibleHeaders(sheet, displayHeadersForSheet(sheet, sheet.headers || []));
    });
    els.sheetPageNotes.addEventListener("click", handleTargetReportClick);
    els.sheetPageNotes.addEventListener("submit", handleTargetReportSubmit);
    if (els.sheetGridHead) els.sheetGridHead.addEventListener("click", handleReportSortClick);
    els.tierSheetHead.addEventListener("click", handleReportSortClick);
    els.publishersTableHead.addEventListener("click", handleReportSortClick);
    els.tierSheetHead.addEventListener("change", handleTierSelectionChange);
    els.tierSheetRows.addEventListener("change", handleTierSelectionChange);
    els.tierMoveSelected.addEventListener("click", openTierMoveDialog);
    els.tierResetMoves.addEventListener("click", resetTierMoves);
    els.tierMoveTargets.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tier-move-target]");
      if (!button || button.disabled) return;
      state.tierMoveTarget = button.dataset.tierMoveTarget;
      renderTierMoveDialog();
    });
    els.tierMoveConfirm.addEventListener("click", moveSelectedTierRows);
    els.tierMoveCancel.addEventListener("click", closeTierMoveDialog);
    els.tierMoveClose.addEventListener("click", closeTierMoveDialog);
    els.tierMoveDialog.addEventListener("click", (event) => {
      if (event.target === els.tierMoveDialog) closeTierMoveDialog();
    });
    els.tierExpand.addEventListener("click", openTierSheetOverlay);
    els.tierOverlayClose.addEventListener("click", () => closeTierSheetOverlay());
    els.sheetExpandedBackdrop.addEventListener("click", () => closeTierSheetOverlay());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && els.tierMoveDialog && !els.tierMoveDialog.classList.contains("hidden")) {
        closeTierMoveDialog();
        return;
      }
      if (event.key === "Escape" && state.expandedTierSheet) closeTierSheetOverlay();
    });
    els.paymentMonth.addEventListener("change", () => { state.payments.month = els.paymentMonth.value; renderPaymentsPage(); });
    els.paymentNetwork.addEventListener("change", () => { state.payments.network = els.paymentNetwork.value; renderPaymentsPage(); });
    els.paymentRegion.addEventListener("change", () => { state.payments.region = els.paymentRegion.value; renderPaymentsPage(); });
    els.paymentTier.addEventListener("change", () => { state.payments.tier = els.paymentTier.value; renderPaymentsPage(); });
    els.paymentStatus.addEventListener("change", () => { state.payments.status = els.paymentStatus.value; renderPaymentsPage(); });
    els.paymentSort.addEventListener("change", () => {
      state.paymentSort.key = els.paymentSort.value;
      state.paymentSort.direction = state.paymentSort.key ? defaultReportSortDirection(state.paymentSort.key) : "asc";
      renderPaymentsPage();
    });
    els.paymentSearch.addEventListener("input", () => { state.payments.search = els.paymentSearch.value; renderPaymentsPage(); });
    if (els.paymentHead) els.paymentHead.addEventListener("click", handleReportSortClick);
    els.paymentSync.addEventListener("click", () => refreshLevantaPayments());
    els.languageToggle.addEventListener("click", toggleLanguage);
    if (els.reset) els.reset.addEventListener("click", resetFilters);
    els.download.addEventListener("click", downloadFilteredXlsx);
    els.publisherNetworkFilter.addEventListener("change", function () {
      state.publisherNetwork = els.publisherNetworkFilter.value;
      renderPublishersPage();
    });
    els.publisherLinkTypeFilter.addEventListener("change", function () {
      state.publisherLinkType = els.publisherLinkTypeFilter.value;
      renderPublishersPage();
    });
    els.publisherStartDate.addEventListener("change", function () {
      state.publisherStartDate = els.publisherStartDate.value;
      renderPublishersPage();
    });
    els.publisherEndDate.addEventListener("change", function () {
      state.publisherEndDate = els.publisherEndDate.value;
      renderPublishersPage();
    });
    els.publisherMarketFilter.addEventListener("change", function () {
      state.publisherMarket = els.publisherMarketFilter.value;
      renderPublishersPage();
    });
    // 经理组合框：输入过滤 + 即时渲染
    els.publisherManagerSearch.addEventListener("input", function () {
      state.publisherManagerSearch = els.publisherManagerSearch.value;
      _showManagerDropdown();
      renderPublishersPage();
    });
    els.publisherManagerSearch.addEventListener("focus", function () {
      _rebuildManagerOptions((_publishersCache || {}).publishers);
      _showManagerDropdown();
    });
    els.publisherManagerSearch.addEventListener("blur", function () {
      setTimeout(_hideManagerDropdown, 200);
    });
    // 经理下拉选项点击
    document.getElementById("publisherManagerDropdown").addEventListener("click", function (e) {
      var opt = e.target.closest(".combobox-option");
      if (!opt || !opt.getAttribute("data-value")) return;
      var val = opt.getAttribute("data-value");
      state.publisherManagerSearch = val;
      els.publisherManagerSearch.value = val;
      _hideManagerDropdown();
      renderPublishersPage();
    });
    // 文本输入框仅同步 state，不触发渲染（点击搜索按钮才渲染）
    els.publisherMerchantSearch.addEventListener("input", function () {
      state.publisherMerchantSearch = els.publisherMerchantSearch.value;
    });
    els.publisherProductSearch.addEventListener("input", function () {
      state.publisherProductSearch = els.publisherProductSearch.value;
    });
    els.publisherManagerSearch.addEventListener("change", function () {
      state.publisherManagerSearch = els.publisherManagerSearch.value;
    });
    els.publisherSiteSearch.addEventListener("input", function () {
      state.publisherSiteSearch = els.publisherSiteSearch.value;
    });
    els.publisherTrackSearch.addEventListener("input", function () {
      state.publisherTrackSearch = els.publisherTrackSearch.value;
    });
    els.publisherSearchBtn.addEventListener("click", function () {
      renderPublishersPage();
    });
    // 日期快捷按钮
    document.getElementById("publisherDateQuickBtns").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-quick]");
      if (!btn) return;
      var mode = btn.getAttribute("data-quick");
      var now = new Date();
      var y = now.getFullYear();
      var m = now.getMonth(); // 0=Jan
      var d = now.getDate();
      var sd, ed;
      switch (mode) {
        case "lastMonth":
          sd = new Date(y, m - 1, 1);
          ed = new Date(y, m, 0);
          break;
        case "past30":
          sd = new Date(y, m, d - 30);
          ed = now;
          break;
        case "past3m":
          sd = new Date(y, m - 3, d);
          ed = now;
          break;
        case "past6m":
          sd = new Date(y, m - 6, d);
          ed = now;
          break;
      }
      function pad(n) { return n < 10 ? "0" + n : "" + n; }
      state.publisherStartDate = sd.getFullYear() + "-" + pad(sd.getMonth() + 1) + "-" + pad(sd.getDate());
      state.publisherEndDate = ed.getFullYear() + "-" + pad(ed.getMonth() + 1) + "-" + pad(ed.getDate());
      els.publisherStartDate.value = state.publisherStartDate;
      els.publisherEndDate.value = state.publisherEndDate;
      renderPublishersPage();
    });
    els.publisherResetBtn.addEventListener("click", function () {
      state.publisherMarket = "all";
      state.publisherNetwork = "all";
      state.publisherLinkType = "all";
      state.publisherStartDate = "";
      state.publisherEndDate = "";
      state.publisherMerchantSearch = "";
      state.publisherProductSearch = "";
      state.publisherManagerSearch = "";
      state.publisherSiteSearch = "";
      state.publisherTrackSearch = "";
      els.publisherMarketFilter.value = "all";
      els.publisherNetworkFilter.value = "all";
      els.publisherLinkTypeFilter.value = "all";
      els.publisherStartDate.value = "";
      els.publisherEndDate.value = "";
      els.publisherMerchantSearch.value = "";
      els.publisherProductSearch.value = "";
      els.publisherManagerSearch.value = "";
      els.publisherSiteSearch.value = "";
      els.publisherTrackSearch.value = "";
      renderPublishersPage();
    });
    els.publisherExportBtn.addEventListener("click", downloadPublishersXlsx);
    // KPI 卡片点击切换图表指标
    els.publishersKpiRow.addEventListener("click", function (event) {
      var card = event.target.closest("[data-publisher-kpi]");
      if (!card) return;
      var metric = card.getAttribute("data-publisher-kpi");
      if (metric && metric !== state.publisherChartMetric) {
        state.publisherChartMetric = metric;
        renderPublishersPage();
      }
    });
    els.paymentDownload.addEventListener("click", downloadPaymentsXlsx);
    if (els.sheetDownload) els.sheetDownload.addEventListener("click", downloadSheetTargetsXlsx);
    els.tierDownload.addEventListener("click", downloadTierSheetXlsx);
    document.querySelectorAll(".sort-button").forEach((button) => {
      button.addEventListener("click", () => {
        state.sort = button.dataset.sort;
        state.descending = true;
        syncControls();
        renderAll();
      });
    });
    els.chatForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const prompt = els.chatInput.value.trim();
      if (!prompt) return;
      els.chatInput.value = "";
      applyPrompt(prompt);
    });
    els.chatLog.addEventListener("click", (event) => {
      const button = event.target.closest("[data-download-id]");
      if (!button) return;
      downloadRecommendationXlsx(button.dataset.downloadId);
    });

    // 模式切换
    els.modeFastBtn?.addEventListener("click", () => {
      state.deepMode = false;
      els.modeFastBtn.classList.add("active");
      els.modeDeepBtn.classList.remove("active");
      els.chatInput.placeholder = t("chat.placeholder", "Ask about EPC, tiers, AOV, conversion, unpaid offers...");
    });

    els.modeDeepBtn?.addEventListener("click", () => {
      state.deepMode = true;
      els.modeDeepBtn.classList.add("active");
      els.modeFastBtn.classList.remove("active");
      els.chatInput.placeholder = t("deep.placeholder", "Enter complex analysis queries (comparison, trends, multi-dimensional analysis…)");
    });

    // 浮动深度分析按钮——聚焦最上层面板或切换深度模式
    els.deepAnalysisFab?.addEventListener("click", () => {
      if (_deepPanels.length > 0) {
        var topPanel = _deepPanels[_deepPanels.length - 1];
        _bringPanelToFront(topPanel);
        // 如果是最小化状态，展开它
        if (topPanel.minimized) {
          _expandDeepPanel(topPanel.id);
        }
        return;
      }
      // 无面板时切换到深度模式准备提问
      if (!state.deepMode) {
        state.deepMode = true;
        els.modeDeepBtn?.classList.add("active");
        els.modeFastBtn?.classList.remove("active");
        els.chatInput.placeholder = t("deep.placeholder", "Enter complex analysis queries (comparison, trends, multi-dimensional analysis…)");
      }
      els.chatInput?.focus();
      els.chatInput?.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    // Escape 最小化最上层非推理中的面板
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        for (var i = _deepPanels.length - 1; i >= 0; i--) {
          var p = _deepPanels[i];
          if (!p.minimized && !p.abortController) {
            _minimizeDeepPanel(p.id);
            break;
          }
        }
      }
    });

    // 监听聊天摘要中的展开事件（支持重建已关闭的面板）
    document.addEventListener("deep-expand-panel", function (e) {
      var key = e.detail.key;
      if (!key) return;
      // 先找现有面板
      var panel = _deepPanels.find(function (p) { return p._cardKey === key; });
      if (panel) {
        if (panel.minimized) {
          _expandDeepPanel(panel.id);
        } else {
          _bringPanelToFront(panel);
        }
        return;
      }
      // 面板已关闭，尝试从缓存重建
      var cached = _deepReportCache[key];
      if (cached) {
        var newPanel = _createDeepPanel(cached.prompt);
        newPanel._cardKey = key;
        _renderPanelReport(newPanel, cached.report);
        _bringPanelToFront(newPanel);
      }
    });

    addMessage("assistant", `Loaded <strong>${offers.length.toLocaleString()}</strong> internal offers. Search merchant name, merchant ID, ASIN, category, payment status, or ask for recommendations.`);
    state.currentContext = { type: "default", items: [], summary: {}, filters: {} };
    syncPaymentControls();
    renderAll();
    // 初始页面为 dashboard，显示浮动深度分析按钮
    if (state.page === "dashboard") els.deepAnalysisFab?.classList.remove("hidden");
    renderPaymentsPage();
    rerenderForLanguage();
    document.body.classList.remove("app-loading");
    loadSharedTierMoves({ silent: true });
    maybeAutoSyncLevantaPayments();
    window.setInterval(maybeAutoSyncLevantaPayments, AUTO_PAYMENT_SYNC_INTERVAL_MS);
    window.setInterval(() => {
      if (state.page !== "sheets" || state.dbStatus.loading) return;
      if (document.visibilityState && document.visibilityState !== "visible") return;
      loadDbStatus(targetDbStatusMonthKey());
    }, DB_STATUS_AUTO_REFRESH_MS);
  }

  cacheOriginalTierSheetRows();
  applyManualTierMoves();

  if (window.__OFFER_INTELLIGENCE_TEST__) {
    window.OFFER_INTELLIGENCE_TEST_HOOKS = {
      categoryForPrompt,
      detectQueryIntent,
      cleanedMerchantLookupPhrase,
      hasStrongMerchantLookup,
      extractMetricFilters,
      extractMetricSortIntent,
      extractPaymentCycleFilter,
      paymentCycleFilterText,
      normalizeRegion,
      paymentCurrencySymbol,
      paymentMoney,
      paymentSummaryMoney,
      paymentStatusSummaryItems,
      paymentStatusFilterValues,
      paymentSortOptions,
      sortPaymentRowsForTable,
      paymentTableSortValue,
      keywordSearchRequest,
      keywordSearchMatches,
      getPaymentRecords,
      withPendingPaymentPlaceholders,
      requestedRecommendationCount,
      parseTierOfferRequest,
      answerPrompt,
      currentContext: () => state.currentContext,
      currentRecommendationBundle: () => state.activeRecommendationBundle,
      recommendationDownloads: () => state.recommendationDownloads,
      excludedRecommendationKeys: () => Array.from(state.excludedRecommendationKeys),
      rankedRecommendations,
      chatOverviewColumnLabels: () => chatOverviewColumns.map((column) => column.label),
      contextColumnLabels: () => contextColumnsFor().map((column) => column.label),
      formatSheetCell,
      displayCategory,
      dashboardCategoryGroups,
      dashboardCategoryFocusedGroups,
      dashboardCategoryPieHtml,
      setCategoryReportFocusKey: (key) => { state.categoryReportFocusKey = String(key || ""); },
      categoryReportFocusKey: () => state.categoryReportFocusKey,
      tierSheetRowsForDisplay: (sheetName) => tierSheetRowsForDisplay(sheetByName(sheetName)),
      tierReportRange,
      tierReportDependencyTiers,
      tierRowBaseKey,
      tierTablePagination,
      defaultTierHeadersForSheet: (sheetName, headers) => defaultTierHeadersForSheet(
        sheetByName(sheetName) || { name: sheetName },
        headers
      ),
      visibleTierHeadersForSheet: (sheetName, headers) => visibleHeadersForSheet(
        sheetByName(sheetName) || { name: sheetName },
        headers
      ),
      rekeyManualTierMovesForTest: (moves) => {
        const previousMoves = state.manualTierMoves;
        state.manualTierMoves = { ...(moves || {}) };
        const changed = rekeyManualTierMoves();
        const normalizedMoves = JSON.parse(JSON.stringify(state.manualTierMoves));
        state.manualTierMoves = previousMoves;
        return { changed, moves: normalizedMoves };
      },
      tierRowHighlightKind: (sheetName, row) => tierRowHighlightKind(sheetByName(sheetName) || { name: sheetName }, row || {}),
      visualStatusForTierRow: (sheetName, row) => visualStatusForTierRow(sheetByName(sheetName) || { name: sheetName }, row || {}),
      targetRecords,
      preferredTargetMonth,
      currentReportingMonthKey,
      ensureReportingMonthRecord,
      targetDbStatusMonthKey,
      targetMonthHasMetrics: (month) => targetMonthHasMetrics(targetRecords(), month),
      targetTrendHtml,
      targetTrendPlotHtml,
      targetMonthlyTrendRows,
      targetDailyTrendRows,
      dbMonthlyTrendRows,
      dbMonthlyRowForKey,
      setTargetFilters: (filters = {}) => { state.targetFilters = { ...state.targetFilters, ...filters }; },
      setTargetTrendView: (view) => { state.targetTrendView = view === "day" ? "day" : "month"; },
      setDbStatusData: (payload) => { state.dbStatus.data = payload; state.dbStatus.error = ""; state.dbStatus.loading = false; state.dbStatus.monthKey = monthKeyFromText(payload?.dailyTrend?.month || ""); },
      demoDbStatusPayload,
      dbStatusViewModel,
      dbDailyTrendRows,
      dbDailyTrendChartHtml
    };
  } else {
    init();
  }

  // Register callback for lazy-loaded keyword data (from auth.js)
  window.__onOfferKeywordsLoaded = function (kwResp) {
    if (!kwResp || !Array.isArray(kwResp.merchants)) return;
    mergeProductKeywordsIntoOffers(offers, kwResp);
  };
})();
