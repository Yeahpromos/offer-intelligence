import type { UiLanguage } from "../shared/i18n";
import type { AuthUser } from "../shared/contracts/auth";

export const MODERN_PAGE_NAMES = [
  "offer-list-tracker",
  "payments",
  "publishers",
  "monthly-new-merchants",
  "brand-media",
  "revenue-flow",
  "google-ads",
  "sheets",
  "category",
  "tier",
  "dashboard",
  "agent"
] as const;

export type ModernPageName = (typeof MODERN_PAGE_NAMES)[number];
export type { UiLanguage } from "../shared/i18n";

export interface AppBootstrapData {
  readonly user: AuthUser;
  readonly chatbotData: unknown;
  readonly sheetReportData: unknown;
  readonly productKeywords: unknown;
  readonly language: UiLanguage;
  readonly llmEnabled: boolean;
  readonly agentEnabled: boolean;
}

export interface ModernAppApi {
  bootstrap(data: AppBootstrapData): void;
  mountApplication(element: HTMLElement, initialPage?: ModernPageName): boolean;
  mountPage(page: ModernPageName, element: HTMLElement): boolean;
  unmountPage(page: ModernPageName): void;
  mountShell(element: HTMLElement): boolean;
  unmountShell(): void;
  setPage(page: ModernPageName): void;
  setLanguage(language: UiLanguage): void;
  hasPage(page: ModernPageName): boolean;
}

export interface ModernPageController {
  unmount(): void;
  setLanguage?(language: UiLanguage): void;
}

export type ModernPageFactory = (element: HTMLElement) => ModernPageController;

export interface ModernShellController {
  unmount(): void;
  setPage?(page: ModernPageName): void;
  setLanguage?(language: UiLanguage): void;
}

export type ModernShellFactory = (element: HTMLElement) => ModernShellController;
