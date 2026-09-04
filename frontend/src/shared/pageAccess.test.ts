import { afterEach, describe, expect, it } from "vitest";

import {
  PAGE_NAMES,
  allowedPages,
  canAccessPage,
  defaultPageForLevel,
  normalizeLevel,
  normalizeUser,
  pureAllowedPages,
  pureCanAccessPage,
  pureDefaultPageForLevel
} from "./pageAccess";

const globalWindow = window as unknown as { OI_PAGE_ACCESS?: unknown };

describe("共享页面权限契约", () => {
  afterEach(() => {
    globalWindow.OI_PAGE_ACCESS = {
      PAGE_NAMES,
      normalizeLevel,
      normalizeUser,
      allowedPages: pureAllowedPages,
      canAccessPage: pureCanAccessPage,
      defaultPageForLevel: pureDefaultPageForLevel
    };
  });

  it("按固定 0/1/2 矩阵返回允许页面", () => {
    expect(pureAllowedPages(0)).toEqual(PAGE_NAMES);
    expect(pureAllowedPages(1)).not.toContain("google-ads");
    expect(pureAllowedPages(1)).toHaveLength(PAGE_NAMES.length - 1);
    expect(pureAllowedPages(2)).toEqual(["google-ads"]);
    expect(pureCanAccessPage(3, "agent")).toBe(false);
    expect(pureCanAccessPage(0, "unknown")).toBe(false);
    expect(pureDefaultPageForLevel(2)).toBe("google-ads");
    expect(pureDefaultPageForLevel(1)).toBe("agent");
  });

  it("适配生产全局契约，并在契约缺失时 fail closed", () => {
    expect(normalizeLevel(" 2 ")).toBe(2);
    expect(normalizeLevel("3")).toBeNull();
    expect(canAccessPage(2, "google-ads")).toBe(true);
    expect(allowedPages(2)).toEqual(["google-ads"]);
    expect(defaultPageForLevel(2)).toBe("google-ads");

    const runtime = globalWindow.OI_PAGE_ACCESS;
    delete globalWindow.OI_PAGE_ACCESS;
    expect(canAccessPage(0, "agent")).toBe(false);
    expect(allowedPages(0)).toEqual([]);
    expect(defaultPageForLevel(0)).toBeNull();
    globalWindow.OI_PAGE_ACCESS = runtime;
  });

  it("只接受不含密码、role 的用户字段", () => {
    expect(normalizeUser({
      id: 7,
      username: "ypadmin",
      displayName: "Admin",
      email: "admin@example.test",
      level: 0,
      expiresAt: 123
    })).toEqual({
      id: 7,
      username: "ypadmin",
      displayName: "Admin",
      email: "admin@example.test",
      level: 0,
      expiresAt: 123
    });
    expect(normalizeUser({ username: "ypadmin", displayName: "Admin", email: "", level: 0, role: "admin" })).toBeNull();
    expect(normalizeUser({ username: "ypadmin", displayName: "Admin", email: "", level: 0, password_hash: "redacted" })).toBeNull();
  });
});
