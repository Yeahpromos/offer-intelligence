import { nextTick } from "vue";
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";

import AppShell from "./AppShell.vue";
import type { AppShellController } from "./appShellContracts";

function storageFixture(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; }
  } as Storage;
}

describe("AppShell", () => {
  it("渲染统一导航、语言/主题/退出入口并委托页面切换", async () => {
    const navigate = vi.fn();
    const setLanguage = vi.fn();
    const ready = vi.fn();
    const wrapper = mount(AppShell, {
      props: {
        initialPage: "agent",
        userLevel: 0,
        language: "zh",
        navigate,
        setLanguage,
        onReady: ready,
        storage: storageFixture()
      }
    });

    expect(wrapper.find(".modern-shell-sidebar").exists()).toBe(true);
    expect(wrapper.find('[data-shell-nav-page="tier"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-shell-nav-page="tier"]')).toHaveLength(1);
    expect(wrapper.find("#modernLogoutButton").exists()).toBe(true);
    expect(document.title).toBe("Agent · YeahPromos");
    expect(document.documentElement.lang).toBe("zh-Hans");

    await wrapper.find('[data-shell-nav-page="payments"]').trigger("click");
    expect(navigate).toHaveBeenCalledWith("payments");
    await wrapper.find("[data-shell-language]").trigger("click");
    expect(setLanguage).toHaveBeenCalledWith("en");
  });

  it("通过 Shell controller 同步页面标题，并切换持久化主题", async () => {
    const ready = vi.fn();
    const wrapper = mount(AppShell, {
      props: {
        initialPage: "agent",
        userLevel: 0,
        language: "en",
        navigate: vi.fn(),
        onReady: ready,
        storage: storageFixture()
      }
    });
    const controller = ready.mock.calls[0]?.[0] as AppShellController;

    controller.setPage("category");
    await nextTick();
    expect(document.title).toBe("Category · YeahPromos");

    await wrapper.find("[data-shell-theme]").trigger("click");
    expect(document.body.dataset.oiTheme).toBe("dark");
    expect(wrapper.find(".modern-shell").attributes("data-theme")).toBe("dark");
  });

  it("按 level 2 只展示 Google Ads，并将非法初始页纠正到默认页", () => {
    const navigate = vi.fn();
    const wrapper = mount(AppShell, {
      props: {
        initialPage: "agent",
        userLevel: 2,
        language: "zh",
        navigate,
        storage: storageFixture()
      }
    });

    expect(wrapper.find('[data-shell-nav-page="google-ads"]').exists()).toBe(true);
    expect(wrapper.find('[data-shell-nav-page="agent"]').exists()).toBe(false);
    expect(wrapper.find('[data-shell-nav-page="payments"]').exists()).toBe(false);
    expect(wrapper.find(".modern-shell").attributes("data-page")).toBe("google-ads");
    expect(navigate).not.toHaveBeenCalled();
  });
});
