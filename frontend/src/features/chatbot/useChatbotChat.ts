import { consumeSseResponse } from "../../shared/stream/sse";
import { notifyAuthFailure } from "../../shared/api/client";
import type {
  ChatbotChatRequest,
  ChatbotChatResult,
  ChatbotChatRunner
} from "./chatbotViewTypes";

interface StreamPayload {
  readonly token?: unknown;
  readonly type?: unknown;
  readonly usageAvailable?: unknown;
  readonly outputTokens?: unknown;
  readonly outputChunks?: unknown;
  readonly errorCode?: unknown;
  readonly error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function stoppedError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted || (isRecord(error) && error.name === "AbortError"));
}

/** Chat Mode default SSE runner for the modern application. */
export const streamChatbotReply: ChatbotChatRunner = async (request, onToken) => {
  if (request.signal?.aborted) return { ok: false, stopped: true, response: "" };

  let response: Response;
  try {
    response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        prompt: request.prompt,
        language: request.language,
        memory: request.memoryText || null,
        history: request.history.slice(-12)
      }),
      signal: request.signal
    });
  } catch (error) {
    return stoppedError(error, request.signal)
      ? { ok: false, stopped: true, response: "" }
      : { ok: false, response: "", errorCode: "network_error" };
  }
  if (response.status === 401 || response.status === 403) notifyAuthFailure(response.status);

  let responseText = "";
  let outputChunks = 0;
  let usage: ChatbotChatResult["usage"] = null;
  let streamError = "";

  try {
    await consumeSseResponse(response, {
      signal: request.signal,
      onEvent(event) {
        if (event.event === "done" || event.data === "[DONE]") return;
        let payload: StreamPayload;
        try {
          const parsed: unknown = JSON.parse(event.data);
          payload = isRecord(parsed) ? parsed : {};
        } catch {
          return;
        }
        if (payload.type === "usage" || event.event === "usage") {
          usage = {
            usageAvailable: payload.usageAvailable === true,
            outputTokens: payload.usageAvailable === true ? numberOrNull(payload.outputTokens) : null,
            outputChunks: numberOrNull(payload.outputChunks),
            errorCode: typeof payload.errorCode === "string" ? payload.errorCode : null
          };
          return;
        }
        if (typeof payload.errorCode === "string") streamError = payload.errorCode;
        if (typeof payload.error === "string") streamError = streamError || "stream_error";
        if (typeof payload.token !== "string" || !payload.token) return;
        responseText += payload.token;
        outputChunks += 1;
        onToken?.(payload.token);
      }
    });
  } catch (error) {
    if (stoppedError(error, request.signal)) return { ok: false, stopped: true, response: responseText, usage };
    return { ok: false, response: responseText, usage, errorCode: streamError || "stream_error" };
  }

  if (streamError) return { ok: false, response: responseText, usage, errorCode: streamError };
  return {
    ok: Boolean(responseText.trim()),
    response: responseText,
    usage: usage || { usageAvailable: false, outputTokens: null, outputChunks }
  };
};
