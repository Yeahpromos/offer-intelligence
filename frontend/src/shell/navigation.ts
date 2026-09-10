import type { ModernPageName, UiLanguage } from "../runtime/contracts";

export type NavigationGroupKey = "workspace" | "merchants" | "media" | "products";
export type NavigationLocation = NavigationGroupKey | "google-ads";
export type NavigationIconName =
  | "agent"
  | "chatbot"
  | "targets"
  | "calendar"
  | "payments"
  | "tier"
  | "publishers"
  | "brand-media"
  | "revenue-flow"
  | "google-ads"
  | "products"
  | "category";

export interface LocalizedText {
  readonly zh: string;
  readonly en: string;
}

export interface NavigationItem {
  readonly page: ModernPageName;
  readonly label: LocalizedText;
  readonly hint: LocalizedText;
  readonly icon: NavigationIconName;
}

export interface NavigationGroup {
  readonly key: NavigationGroupKey;
  readonly label: LocalizedText;
  readonly hint: LocalizedText;
  readonly items: readonly NavigationItem[];
}

function text(zh: string, en: string): LocalizedText {
  return { zh, en };
}

export const NAVIGATION_GROUPS: readonly NavigationGroup[] = [
  {
    key: "workspace",
    label: text("工作台", "Workspace"),
    hint: text("智能工具", "AI tools"),
    items: [
      { page: "agent", label: text("Agent", "Agent"), hint: text("执行与记忆", "Execution & memory"), icon: "agent" },
      { page: "dashboard", label: text("Chatbot", "Chatbot"), hint: text("报告与对话", "Reports & chat"), icon: "chatbot" }
    ]
  },
  {
    key: "merchants",
    label: text("商家经营", "Merchants"),
    hint: text("运营与分层", "Operations & tiers"),
    items: [
      { page: "sheets", label: text("目标", "Targets"), hint: text("目标与趋势", "Goals & trends"), icon: "targets" },
      { page: "monthly-new-merchants", label: text("上新商家", "New merchants"), hint: text("月度商家", "Monthly records"), icon: "calendar" },
      { page: "payments", label: text("付款", "Payments"), hint: text("周期与状态", "Cycles & status"), icon: "payments" },
      { page: "tier", label: text("Tier", "Tier"), hint: text("商家分层", "Merchant tiers"), icon: "tier" }
    ]
  },
  {
    key: "media",
    label: text("媒体洞察", "Media"),
    hint: text("Publisher 表现", "Publisher performance"),
    items: [
      { page: "publishers", label: text("Publishers", "Publishers"), hint: text("媒体组合", "Publisher portfolio"), icon: "publishers" },
      { page: "brand-media", label: text("品牌媒体", "Brand media"), hint: text("点击趋势", "Click trends"), icon: "brand-media" },
      { page: "revenue-flow", label: text("营收流", "Revenue flow"), hint: text("商家到媒体", "Merchant to media"), icon: "revenue-flow" }
    ]
  },
  {
    key: "products",
    label: text("产品与 Offer", "Products & offers"),
    hint: text("目录与获客", "Catalog & acquisition"),
    items: [
      { page: "offer-list-tracker", label: text("Offer Tracker", "Offer Tracker"), hint: text("跟踪与筛选", "Track & filter"), icon: "products" },
      { page: "offer-performance", label: text("推广追踪", "Promotion tracking"), hint: text("推送前后对比", "Before & after"), icon: "brand-media" },
      { page: "category", label: text("分类", "Category"), hint: text("分类报表", "Category report"), icon: "category" }
    ]
  }
] as const;

export const GOOGLE_ADS_NAVIGATION_ITEM: NavigationItem = {
  page: "google-ads",
  label: text("Google Ads", "Google Ads"),
  hint: text("付费获客", "Paid acquisition"),
  icon: "google-ads"
};

const PAGE_LABELS: Readonly<Record<ModernPageName, LocalizedText>> = {
  agent: text("Agent", "Agent"),
  dashboard: text("Chatbot", "Chatbot"),
  payments: text("付款", "Payments"),
  publishers: text("Publishers", "Publishers"),
  "monthly-new-merchants": text("上新商家", "New merchants"),
  "brand-media": text("品牌媒体", "Brand media"),
  "revenue-flow": text("营收流", "Revenue flow"),
  "google-ads": text("Google Ads", "Google Ads"),
  sheets: text("目标", "Targets"),
  category: text("分类", "Category"),
  tier: text("Tier", "Tier"),
  "offer-performance": text("推广追踪", "Promotion tracking"),
  "offer-list-tracker": text("Offer Tracker", "Offer Tracker")
};

export function navigationGroupForPage(page: ModernPageName): NavigationLocation {
  if (page === "dashboard" || page === "agent") return "workspace";
  if (["payments", "sheets", "monthly-new-merchants", "tier"].includes(page)) return "merchants";
  if (["publishers", "brand-media", "revenue-flow"].includes(page)) return "media";
  if (page === "google-ads") return "google-ads";
  return "products";
}

export function navigationItemForPage(page: ModernPageName): NavigationItem | undefined {
  if (page === GOOGLE_ADS_NAVIGATION_ITEM.page) return GOOGLE_ADS_NAVIGATION_ITEM;
  return NAVIGATION_GROUPS.flatMap((group) => group.items).find((item) => item.page === page);
}

export function pageLabel(page: ModernPageName, language: UiLanguage): string {
  return PAGE_LABELS[page][language];
}

export function pageTitle(page: ModernPageName, language: UiLanguage): string {
  return `${pageLabel(page, language)} · YeahPromos`;
}
