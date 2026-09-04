import { consumeSseResponse, type SseEvent } from "../../shared/stream/sse";
import { notifyAuthFailure } from "../../shared/api/client";
import {
  normalizeAgentResultView,
  normalizeAgentResultViews,
  type AgentResultView
} from "../../shared/contracts/agentResult";
import { normalizeAgentTimelineStep, type AgentMemoryEvent, type AgentTimelineStep } from "./agentModel";
import type { AgentRunRequest, AgentRunResult, AgentRunner } from "./AgentPage.vue";

/**
 * Headless transport seam for an OI-owned CopilotKit Runtime endpoint.
 *
 * The endpoint is expected to run the existing Python registry/proof flow and
 * emit only the events below.  This module intentionally has no CopilotKit UI
 * dependency: the existing YeahPromos Vue surface remains the renderer.
 */
export interface CopilotKitRuntimeOptions {
  readonly endpoint?: string;
  readonly fetcher?: typeof fetch;
}

export interface CopilotKitRuntimeRequest {
  readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly context: {
    readonly language: AgentRunRequest["language"];
    readonly memoryText: string;
  };
}

type RuntimeEnvelope = Record<string, unknown>;

function safeText(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function safeMemoryEvents(value: unknown): AgentMemoryEvent[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const event = item as Record<string, unknown>;
    if (event.kind !== "tool_success" && event.kind !== "candidates") return [];
    return [{ ...event, kind: event.kind } as AgentMemoryEvent];
  }).slice(0, 20);
}

function runtimePayload(request: AgentRunRequest): CopilotKitRuntimeRequest {
  const history = request.history.slice(-40).map((message) => ({
    role: message.role === "assistant" ? "assistant" as const : "user" as const,
    content: safeText(message.content, 12_000)
  }));
  return {
    messages: [...history, { role: "user", content: safeText(request.prompt, 20_000) }],
    context: {
      language: request.language,
      memoryText: safeText(request.memoryText, 4_000)
    }
  };
}

function envelope(event: SseEvent): RuntimeEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(event.data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as RuntimeEnvelope : null;
  } catch {
    return null;
  }
}

function eventType(event: SseEvent, payload: RuntimeEnvelope | null): string {
  return safeText(payload?.type || event.event, 32).toLowerCase();
}

function canonicalEventType(type: string): string {
  return type.replace(/[.\-]/g, "_");
}

function appendUniqueStep(steps: AgentTimelineStep[], step: AgentTimelineStep): void {
  const index = steps.findIndex((item) => item.id === step.id);
  if (index < 0) steps.push(step);
  else steps[index] = step;
}

/**
 * Build an optional AgentRunner backed by a CopilotKit-compatible SSE
 * endpoint.  The result channel is structured and bounded; no raw provider
 * response, proof, or tool arguments are ever passed to Vue.  The authority
 * header is only a routing/capability hint; the server must enforce auth and
 * Python-registry execution independently.
 */
export function createCopilotKitAgentRunner(options: CopilotKitRuntimeOptions = {}): AgentRunner {
  const endpoint = options.endpoint || "/api/copilotkit";
  const fetcher = options.fetcher || globalThis.fetch.bind(globalThis);
  return async (request): Promise<AgentRunResult> => {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "X-OI-Agent-Transport": "copilotkit",
          "X-OI-Agent-Authority": "python-registry"
        },
        body: JSON.stringify(runtimePayload(request)),
        signal: request.signal
      });
    } catch (error) {
      if (request.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return { ok: false, status: "stopped", response: "", steps: [], resultViews: [], memoryEvents: [] };
      }
      return { ok: false, status: "error", response: "", steps: [], resultViews: [], memoryEvents: [], errorCode: "copilotkit_runtime_error" };
    }
    if (response.status === 401 || response.status === 403) notifyAuthFailure(response.status);
    const steps: AgentTimelineStep[] = [];
    const resultViews: AgentResultView[] = [];
    const memoryEvents: AgentMemoryEvent[] = [];
    let text = "";
    let status: AgentRunResult["status"] = "done";
    let errorCode = "";

    try {
      await consumeSseResponse(response, {
        signal: request.signal,
        onEvent: (event) => {
          const payload = envelope(event);
          const type = eventType(event, payload);
          const canonical = canonicalEventType(type);
          if (canonical === "token" || canonical === "message" || canonical === "text_message_content" || canonical === "text_content") {
            const token = safeText(payload?.token ?? payload?.delta ?? (payload?.content as unknown), 20_000);
            if (token) {
              text += token;
              request.onToken?.(token);
            }
            return;
          }
          if (canonical === "timeline" || canonical === "step" || canonical === "agent_step" || canonical === "replan") {
            const step = normalizeAgentTimelineStep(payload?.step || payload);
            appendUniqueStep(steps, step);
            request.onTimeline?.(step);
            return;
          }
          if (canonical === "tool_call_start" || canonical === "tool_call_end") {
            const toolCallId = safeText(payload?.toolCallId || payload?.tool_call_id || payload?.id, 120) || `tool-${steps.length + 1}`;
            const step = normalizeAgentTimelineStep({
              id: toolCallId,
              phase: "tool",
              status: canonical === "tool_call_end" ? (payload?.status === "error" ? "error" : "done") : "running",
              label: safeText(payload?.toolName || payload?.tool_name || payload?.name, 120) || "Data tool",
              detail: safeText(payload?.detail || payload?.message, 240),
              dataSource: payload?.dataSource,
              dataAsOf: payload?.dataAsOf,
              estimated: payload?.estimated
            });
            appendUniqueStep(steps, step);
            request.onTimeline?.(step);
            return;
          }
          if (canonical === "result_view" || canonical === "component") {
            const view = normalizeAgentResultView(payload?.view || payload);
            if (!view) return;
            const existing = resultViews.findIndex((item) => item.id === view.id);
            if (existing < 0 && resultViews.length < 8) resultViews.push(view);
            else if (existing >= 0) resultViews[existing] = view;
            request.onResultView?.(view);
            return;
          }
          if (type === "memory" || type === "memory_events" || type === "memory-events") {
            memoryEvents.push(...safeMemoryEvents(payload?.events));
            return;
          }
          if (canonical === "error" || canonical === "run_error") {
            status = "error";
            errorCode = safeText(payload?.errorCode || payload?.code, 80) || "copilotkit_runtime_error";
            return;
          }
          if (canonical === "done" || canonical === "complete" || canonical === "completed" || canonical === "run_finished") {
            const finalText = safeText(payload?.response, 120_000);
            if (finalText) text = finalText;
            if (payload?.status === "stopped") status = "stopped";
            if (payload?.status === "error") status = "error";
            return;
          }
          // A CopilotKit adapter may wrap events as { type, data }.
          const nested = payload?.data && typeof payload.data === "object" && !Array.isArray(payload.data)
            ? payload.data as RuntimeEnvelope : null;
          if (nested && nested !== payload) {
            const nestedEvent: SseEvent = { event: type, data: JSON.stringify(nested) };
            const nestedPayload = envelope(nestedEvent);
            const nestedType = eventType(nestedEvent, nestedPayload);
            if (nestedType === "token") {
              const token = safeText(nestedPayload?.token, 20_000);
              if (token) {
                text += token;
                request.onToken?.(token);
              }
            }
          }
        }
      });
    } catch (error) {
      if (request.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return { ok: false, status: "stopped", response: text, steps, resultViews, memoryEvents };
      }
      return {
        ok: false,
        status: "error",
        response: text,
        steps,
        resultViews,
        memoryEvents,
        errorCode: "copilotkit_runtime_error"
      };
    }
    return {
      ok: status === "done",
      status,
      response: text,
      steps,
      resultViews: normalizeAgentResultViews(resultViews),
      memoryEvents,
      ...(errorCode ? { errorCode } : {})
    };
  };
}
