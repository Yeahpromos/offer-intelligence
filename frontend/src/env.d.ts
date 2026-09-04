/// <reference types="vite/client" />

import type { Component } from "vue";
import type { ModernAppApi, ModernPageName, UiLanguage } from "./runtime/contracts";
import type { PageAccessRuntime } from "./shared/pageAccess";

export interface CopilotKitRuntimeConfig {
  /** Server-issued production default; false disables the CopilotKit transport. */
  readonly enabled?: boolean;
  /** Same-origin endpoint backed by the Python registry/proof adapter. */
  readonly endpoint?: string;
  /** Required capability marker for the safe opt-in path. */
  readonly authority?: "python-registry";
  /** Modern local Agent remains available if the CopilotKit bundle cannot load. */
  readonly fallback?: "modern";
}

export interface ModernRuntimeHost {
  readonly navigate?: (page: ModernPageName) => void;
  readonly setLanguage?: (language: UiLanguage) => void;
  readonly download?: (type: string, payload: unknown) => boolean;
  readonly createAgentActivity?: () => {
    begin(prompt: string, language: UiLanguage): void;
    finish(result: { ok: boolean; status: string; response: string }): void;
    clear(): void;
    feedback?: { isAvailable(): boolean; submit(reasonCode: string, reasonDetail?: string): Promise<{ ok: boolean; alreadyExists?: boolean; errorCode?: string }> };
    downloadLogs?(kind: "questions" | "feedback", format: "csv" | "jsonl"): boolean;
  };
  readonly runAgentPublisher?: (request: {
    kind: "publisher" | "publisherprofile";
    query: string;
    language: UiLanguage;
    signal: AbortSignal;
  }) => Promise<{ html: string; text: string; source: "cache" | "db" | "unavailable" }>;
}

declare global {
  interface Window {
    OI_MODERN_RUNTIME?: ModernRuntimeHost;
    OI_COPILOTKIT_RUNTIME?: CopilotKitRuntimeConfig;
    OI_COPILOTKIT_AGENT_COMPONENT?: Component;
    OI_VUE_RUNTIME: typeof import("vue");
    OI_MODERN_APP: ModernAppApi;
    OI_PAGE_ACCESS?: PageAccessRuntime;
  }
}

export {};
