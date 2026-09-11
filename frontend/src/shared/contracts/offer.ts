export type OfferRecord = Readonly<Record<string, unknown>>;

export type { UiLanguage } from "../i18n";
export type OfferTrackerView = "offers" | "products";
export type OfferTrackerBbPolicy = "all" | "mind" | "open" | "unknown";
export type OfferTrackerRevenueStatus = "all" | "positive" | "none";
export type OfferTrackerRevenueSort = "priority" | "revenue-desc" | "revenue-asc";
export type OfferTrackerAovType = "actual" | "estimated" | "unavailable";
export type OfferTrackerPriorityKey = "high" | "recommended" | "low-aov";

export interface OfferTrackerDateRange {
  readonly startDate: string;
  readonly endDate: string;
}

export interface OfferTrackerFilters {
  readonly tiers: readonly string[];
  readonly categories: readonly string[];
  readonly startDate: string;
  readonly endDate: string;
  readonly minAov: string;
  readonly maxAov: string;
  readonly minCommission: string;
  readonly maxCommission: string;
  readonly networks: readonly string[];
  readonly bbPolicies: readonly Exclude<OfferTrackerBbPolicy, "all">[];
  readonly revenueStatus: OfferTrackerRevenueStatus;
  readonly revenueSort: OfferTrackerRevenueSort;
}

export type OfferTrackerFilterInput = Partial<OfferTrackerFilters> & {
  readonly bbPolicy?: OfferTrackerBbPolicy;
  readonly tier?: string;
  readonly category?: string;
  readonly network?: string;
};

export interface OfferTrackerRules {
  readonly highScore: number;
  readonly lowAovMax: number;
}

export interface OfferTrackerPriority {
  readonly key: OfferTrackerPriorityKey;
  readonly score: number;
  readonly order: number;
}

export interface OfferTrackerRow {
  readonly key: string;
  readonly source: OfferRecord;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly tier: string;
  readonly network: string;
  readonly category: string;
  readonly commissionRate: number;
  readonly aov: number;
  readonly aovType: OfferTrackerAovType;
  readonly revenue: number;
  readonly bbPolicy: Exclude<OfferTrackerBbPolicy, "all">;
  readonly asins: readonly string[];
  readonly score: number;
  readonly priority: OfferTrackerPriority;
}

export interface OfferTrackerPage {
  readonly rows: readonly OfferTrackerRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalRows: number;
  readonly totalPages: number;
}

export interface OfferTrackerSelectionSummary {
  readonly selectedCount: number;
  readonly currentPageSelectedCount: number;
  readonly allFilteredSelected: boolean;
  readonly allPageSelected: boolean;
}

export interface OfferTrackerExportColumn {
  readonly label: string;
  readonly key: string;
}

export interface OfferTrackerExportPayload {
  readonly rows: readonly OfferRecord[];
  readonly view: OfferTrackerView;
  readonly selectedOnly: boolean;
}
