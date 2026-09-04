import { describe, expect, it } from "vitest";

import { createModernAppApi, getAppSnapshot } from "../src/runtime/modernApp";
import type {
  AppBootstrapData,
  ModernPageFactory,
  ModernShellFactory
} from "../src/runtime/contracts";

function bootstrapData(): AppBootstrapData {
  return {
    user: {
      id: 7,
      username: "ypadmin",
      displayName: "Admin",
      email: "admin@example.test",
      level: 0
    },
    chatbotData: { offers: [{ merchantId: "merchant-1" }] },
    sheetReportData: { sheets: [] },
    productKeywords: { merchants: [] },
    language: "zh",
    llmEnabled: true,
    agentEnabled: false
  };
}

describe("Modern Runtime 构建契约", () => {
  it("接收现代入口的结构化启动数据，但不提前注册业务页面", () => {
    const modernApp = createModernAppApi();

    modernApp.bootstrap(bootstrapData());

    expect(getAppSnapshot().value.language).toBe("zh");
    expect(getAppSnapshot().value.agentEnabled).toBe(false);
    expect(modernApp.hasPage("offer-list-tracker")).toBe(false);
  });

  it("未注册页面应返回 false，让现代页面继续渲染", () => {
    const modernApp = createModernAppApi();
    const root = document.createElement("section");

    expect(modernApp.mountPage("offer-list-tracker", root)).toBe(false);
    expect(root.childElementCount).toBe(0);
  });

  it("未完成用户 bootstrap 时拒绝挂载任何现代页面或 Shell", () => {
    const modernApp = createModernAppApi({ agent: () => ({ unmount() {} }) }, () => ({
      unmount() {}
    }));
    const root = document.createElement("section");

    expect(modernApp.mountApplication(root, "agent")).toBe(false);
    expect(modernApp.mountPage("agent", root)).toBe(false);
    expect(modernApp.mountShell(root)).toBe(false);
  });

  it("语言切换只更新应用状态，不直接操作旧 DOM", () => {
    const modernApp = createModernAppApi();
    modernApp.bootstrap(bootstrapData());

    modernApp.setLanguage("en");

    expect(getAppSnapshot().value.language).toBe("en");
  });

  it("拒绝来自认证入口的无效启动数据", () => {
    const modernApp = createModernAppApi();
    const invalidData = {
      ...bootstrapData(),
      language: "fr"
    } as unknown as AppBootstrapData;

    expect(() => modernApp.bootstrap(invalidData)).toThrow("language");
  });

  it("保存浅冻结副本，避免调用方改写应用顶层状态", () => {
    const modernApp = createModernAppApi();
    const data = bootstrapData();

    modernApp.bootstrap(data);

    expect(Object.isFrozen(getAppSnapshot().value)).toBe(true);
    expect(getAppSnapshot().value).not.toBe(data);
  });

  it("注册页面后支持挂载、重复挂载先卸载旧实例并安全卸载当前实例", () => {
    const calls: string[] = [];
    const factory: ModernPageFactory = () => ({
      unmount: () => calls.push("unmount")
    });
    const modernApp = createModernAppApi({ "offer-list-tracker": factory });
    modernApp.bootstrap(bootstrapData());
    const root = document.createElement("section");

    expect(modernApp.hasPage("offer-list-tracker")).toBe(true);
    expect(modernApp.mountPage("offer-list-tracker", root)).toBe(true);
    expect(modernApp.mountPage("offer-list-tracker", root)).toBe(true);
    expect(calls).toEqual(["unmount"]);
    modernApp.unmountPage("offer-list-tracker");
    expect(calls).toEqual(["unmount", "unmount"]);
    modernApp.unmountPage("offer-list-tracker");
    expect(calls).toEqual(["unmount", "unmount"]);
  });

  it("注册共享 Shell 后支持页面/语言同步和安全卸载", () => {
    const calls: string[] = [];
    const shellFactory: ModernShellFactory = () => ({
      setPage: (page) => calls.push(`page:${page}`),
      setLanguage: (language) => calls.push(`language:${language}`),
      unmount: () => calls.push("unmount")
    });
    const modernApp = createModernAppApi({}, shellFactory);
    modernApp.bootstrap(bootstrapData());
    const root = document.createElement("section");

    expect(modernApp.mountShell(root)).toBe(true);
    modernApp.setPage("payments");
    modernApp.setLanguage("en");
    modernApp.unmountShell();

    expect(calls).toEqual(["page:payments", "language:en", "unmount"]);
  });

  it("level 2 的现代 runtime 不卸载当前页，也不能挂载非 Google Ads 页面", () => {
    const calls: string[] = [];
    const factory = (page: string) => () => ({
      unmount: () => calls.push(`unmount:${page}`)
    });
    const modernApp = createModernAppApi({
      agent: factory("agent"),
      "google-ads": factory("google-ads"),
      payments: factory("payments")
    }, () => ({
      setPage: (page) => calls.push(`shell:${page}`),
      unmount: () => calls.push("shell:unmount")
    }));
    modernApp.bootstrap({ ...bootstrapData(), user: { ...bootstrapData().user, level: 2 } });
    const root = document.createElement("section");

    expect(modernApp.mountApplication(root, "agent")).toBe(true);
    modernApp.setPage("agent");
    expect(modernApp.mountPage("payments", root)).toBe(false);
    expect(calls).toEqual(["shell:google-ads"]);
  });

  it("缺少页面权限全局契约时拒绝启动", () => {
    const globalWindow = window as unknown as { OI_PAGE_ACCESS?: unknown };
    const runtime = globalWindow.OI_PAGE_ACCESS;
    delete globalWindow.OI_PAGE_ACCESS;
    try {
      const modernApp = createModernAppApi();
      expect(() => modernApp.bootstrap(bootstrapData())).toThrow(/page access/i);
    } finally {
      globalWindow.OI_PAGE_ACCESS = runtime;
    }
  });
});
