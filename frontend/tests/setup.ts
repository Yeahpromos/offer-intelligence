import { afterEach, beforeEach } from "vitest";

const PAGE_NAMES = [
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
];

beforeEach(() => {
  (window as unknown as { OI_PAGE_ACCESS?: unknown }).OI_PAGE_ACCESS = {
    PAGE_NAMES,
    normalizeLevel(value: unknown) {
      const level = Number(value);
      return Number.isInteger(level) && [0, 1, 2].includes(level) ? level : null;
    },
    normalizeUser(value: unknown) {
      return value;
    },
    allowedPages(level: number) {
      return PAGE_NAMES.filter((page) => level === 0 || (level === 1 && page !== "google-ads") || (level === 2 && page === "google-ads"));
    },
    canAccessPage(level: number, page: string) {
      return PAGE_NAMES.includes(page) && (level === 0 || (level === 1 && page !== "google-ads") || (level === 2 && page === "google-ads"));
    },
    defaultPageForLevel(level: number) {
      return level === 2 ? "google-ads" : "agent";
    }
  };
});

afterEach(() => {
  document.body.replaceChildren();
});
