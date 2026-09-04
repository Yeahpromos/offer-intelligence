import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "./client";
import { ApiError } from "./errors";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("apiRequest", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it("解析 JSON，并保留浏览器安全请求的默认选项", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ offers: [] }));

    await expect(apiRequest<{ offers: readonly unknown[] }>("/api/ui/db/offers"))
      .resolves.toEqual({ offers: [] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("Accept")).toBe("application/json");
  });

  it("非 2xx 时抛出保留 HTTP 状态和后端错误码的 ApiError", async () => {
    const payload = { ok: false, errorCode: "auth_required", error: "登录已过期" };
    fetchMock.mockResolvedValue(jsonResponse(payload, 401));

    const result = apiRequest("/api/ui/db/offers");

    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({
      status: 401,
      code: "auth_required",
      payload,
      message: "登录已过期"
    });
  });

  it("401/403 先派发只含状态的统一认证失败事件", async () => {
    const events: number[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent<{ status: number }>).detail.status);
      expect((event as CustomEvent).detail).toEqual({ status: events.at(-1) });
    };
    window.addEventListener("oi-auth-failure", listener);
    try {
      for (const status of [401, 403]) {
        fetchMock.mockResolvedValueOnce(jsonResponse({ ok: false, error: "private body" }, status));
        await expect(apiRequest("/api/private")).rejects.toMatchObject({ status });
      }
      expect(events).toEqual([401, 403]);
    } finally {
      window.removeEventListener("oi-auth-failure", listener);
    }
  });

  it("HTTP 成功但业务返回 ok:false 时仍抛出受控错误", async () => {
    const payload = { ok: false, errorCode: "upstream_unavailable", error: "数据源暂不可用" };
    fetchMock.mockResolvedValue(jsonResponse(payload));

    await expect(apiRequest("/api/ui/db/offers")).rejects.toMatchObject({
      status: 200,
      code: "upstream_unavailable",
      payload
    });
  });

  it("成功状态返回无效 JSON 时抛出 invalid_json", async () => {
    fetchMock.mockResolvedValue(new Response("not-json", { status: 200 }));

    await expect(apiRequest("/api/ui/db/offers")).rejects.toMatchObject({
      status: 200,
      code: "invalid_json"
    });
  });

  it("超时会中止请求并抛出 timeout 错误", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_path: string, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    }));

    const result = apiRequest("/api/ui/db/offers", { timeoutMs: 25 });
    const rejection = expect(result).rejects.toMatchObject({
      status: 0,
      code: "timeout"
    });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
  });
});
