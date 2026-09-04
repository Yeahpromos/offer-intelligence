import { describe, expect, it, vi } from "vitest";

import { usePageState } from "./usePageState";

describe("共享 Shell 页面状态", () => {
  it("根据当前页面保持活动分组，并在导航后关闭移动菜单", () => {
    const state = usePageState("agent");

    expect(state.currentPage.value).toBe("agent");
    expect(state.openGroup.value).toBe("workspace");

    state.setCompact(true);
    state.openMenu();
    state.setPage("brand-media");

    expect(state.currentPage.value).toBe("brand-media");
    expect(state.openGroup.value).toBe("media");
    expect(state.isMenuOpen.value).toBe(false);
  });

  it("只允许一个分组展开，并保持当前页面分组可用", () => {
    const state = usePageState("payments");

    expect(state.openGroup.value).toBe("merchants");
    state.toggleGroup("media");
    expect(state.openGroup.value).toBe("media");
    state.toggleGroup("media");
    expect(state.openGroup.value).toBeNull();
    state.toggleGroup("merchants");
    state.toggleGroup("merchants");
    expect(state.openGroup.value).toBe("merchants");
  });

  it("在移动端处理 Escape 和 Tab 焦点循环", () => {
    const state = usePageState("agent");
    const trigger = document.createElement("button");
    const first = document.createElement("button");
    const last = document.createElement("button");
    document.body.append(trigger, first, last);
    const focusables = [first, last];

    state.setCompact(true);
    state.openMenu();
    last.focus();
    const tabEvent = new KeyboardEvent("keydown", { key: "Tab", cancelable: true });
    expect(state.handleKeydown(tabEvent, focusables, trigger)).toBe(true);
    expect(tabEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const escapeEvent = new KeyboardEvent("keydown", { key: "Escape" });
    expect(state.handleKeydown(escapeEvent, focusables, trigger)).toBe(true);
    expect(state.isMenuOpen.value).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("没有焦点目标时仍阻止 Tab 离开抽屉", () => {
    const state = usePageState("agent");
    state.setCompact(true);
    state.openMenu();
    const event = new KeyboardEvent("keydown", { key: "Tab" });
    const preventDefault = vi.spyOn(event, "preventDefault");

    expect(state.handleKeydown(event, [], null)).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
  });

  it("level 2 的非法初始页和后续越权页面都回到 Google Ads", () => {
    const state = usePageState("agent", 2);

    expect(state.currentPage.value).toBe("google-ads");
    state.setPage("payments");
    expect(state.currentPage.value).toBe("google-ads");
  });
});
