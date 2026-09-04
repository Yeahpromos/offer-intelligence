import type { AccessLevel, AuthUser } from "./contracts/auth";

export const PAGE_NAMES = [
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

export type PageName = (typeof PAGE_NAMES)[number];

export interface PageAccessRuntime {
  readonly PAGE_NAMES?: readonly string[];
  readonly normalizeLevel: (value: unknown) => AccessLevel | null;
  readonly normalizeUser: (value: unknown) => AuthUser | null;
  readonly allowedPages: (level: unknown) => readonly string[];
  readonly canAccessPage: (level: unknown, page: unknown) => boolean;
  readonly defaultPageForLevel: (level: unknown) => string;
}

type WindowWithPageAccess = Window & { OI_PAGE_ACCESS?: PageAccessRuntime };

function isPageName(value: unknown): value is PageName {
  return typeof value === "string" && (PAGE_NAMES as readonly string[]).includes(value);
}

export function normalizeLevel(value: unknown): AccessLevel | null {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  const text = typeof value === "string" ? value.trim() : value;
  if (text === "") return null;
  try {
    const level = Number(text);
    return Number.isInteger(level) && level >= 0 && level <= 2 ? level as AccessLevel : null;
  } catch {
    return null;
  }
}

export function normalizeUser(value: unknown): AuthUser | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (["password_hash", "passwordHash", "role"].some((key) => Object.prototype.hasOwnProperty.call(record, key))) {
    return null;
  }
  const level = normalizeLevel(record.level);
  const username = typeof record.username === "string" ? record.username.trim() : "";
  if (level === null || !username) return null;
  const id = typeof record.id === "number" || typeof record.id === "string" ? record.id : null;
  const displayName = typeof record.displayName === "string" ? record.displayName : "";
  const email = typeof record.email === "string" ? record.email : "";
  const expiresAt = typeof record.expiresAt === "number" && Number.isFinite(record.expiresAt)
    ? record.expiresAt
    : undefined;
  return {
    id,
    username,
    displayName,
    email,
    level,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(record.authDisabled === true ? { authDisabled: true } : {})
  };
}

export function pureCanAccessPage(level: unknown, page: unknown): page is PageName {
  if (!isPageName(page)) return false;
  const normalized = normalizeLevel(level);
  if (normalized === 0) return true;
  if (normalized === 1) return page !== "google-ads";
  if (normalized === 2) return page === "google-ads";
  return false;
}

export function pureAllowedPages(level: unknown): readonly PageName[] {
  return PAGE_NAMES.filter((page) => pureCanAccessPage(level, page));
}

export function pureDefaultPageForLevel(level: unknown): PageName {
  return normalizeLevel(level) === 2 ? "google-ads" : "agent";
}

export function pageAccessRuntime(): PageAccessRuntime | null {
  if (typeof window === "undefined") return null;
  const runtime = (window as WindowWithPageAccess).OI_PAGE_ACCESS;
  if (!runtime || typeof runtime !== "object") return null;
  if (typeof runtime.normalizeLevel !== "function"
    || typeof runtime.normalizeUser !== "function"
    || typeof runtime.allowedPages !== "function"
    || typeof runtime.canAccessPage !== "function"
    || typeof runtime.defaultPageForLevel !== "function") {
    return null;
  }
  return runtime;
}

export function canAccessPage(level: unknown, page: unknown): page is PageName {
  const runtime = pageAccessRuntime();
  try {
    return Boolean(runtime?.canAccessPage(level, page));
  } catch {
    return false;
  }
}

export function allowedPages(level: unknown): readonly PageName[] {
  const runtime = pageAccessRuntime();
  if (!runtime) return [];
  try {
    const pages = runtime.allowedPages(level);
    return Array.isArray(pages) ? pages.filter(isPageName) : [];
  } catch {
    return [];
  }
}

export function defaultPageForLevel(level: unknown): PageName | null {
  const runtime = pageAccessRuntime();
  try {
    const page = runtime?.defaultPageForLevel(level);
    return isPageName(page) ? page : null;
  } catch {
    return null;
  }
}
