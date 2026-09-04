import { ApiError, apiErrorFromPayload } from "./errors";

export interface ApiRequestOptions extends RequestInit {
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function requestHeaders(headers: HeadersInit | undefined): Headers {
  const result = new Headers(headers);
  if (!result.has("Accept")) result.set("Accept", "application/json");
  return result;
}

export function notifyAuthFailure(status: number): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent("oi-auth-failure", { detail: { status } }));
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: callerSignal,
    headers,
    ...requestInit
  } = options;
  const timeoutEnabled = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const controller = timeoutEnabled ? new AbortController() : null;
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeCallerAbortListener: (() => void) | undefined;

  if (controller && callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      const abortCallerRequest = () => controller.abort(callerSignal.reason);
      callerSignal.addEventListener("abort", abortCallerRequest, { once: true });
      removeCallerAbortListener = () => callerSignal.removeEventListener("abort", abortCallerRequest);
    }
  }

  const signal = controller?.signal ?? callerSignal;
  const init: RequestInit = {
    credentials: "same-origin",
    cache: "no-store",
    ...requestInit,
    headers: requestHeaders(headers),
    ...(signal ? { signal } : {})
  };

  try {
    if (controller) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    let response: Response;
    try {
      response = await fetch(path, init);
    } catch (error) {
      if (timedOut) {
        throw new ApiError("API 请求超时", 0, "timeout", null, error);
      }
      if (isAbortError(error) && callerSignal?.aborted) throw error;
      throw new ApiError("API 请求失败", 0, "network_error", null, error);
    }

    if (response.status === 401 || response.status === 403) notifyAuthFailure(response.status);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ApiError("API 响应不是有效 JSON", response.status, "invalid_json", null, error);
    }

    if (!response.ok) throw apiErrorFromPayload(response.status, payload);
    if (isRecord(payload) && payload.ok === false) {
      throw apiErrorFromPayload(response.status, payload, "api_error");
    }
    return payload as T;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    removeCallerAbortListener?.();
  }
}
