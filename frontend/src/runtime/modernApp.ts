import { readonly, shallowRef } from "vue";

import { canAccessPage, defaultPageForLevel, normalizeUser, pageAccessRuntime } from "../shared/pageAccess";

import type {
  AppBootstrapData,
  ModernAppApi,
  ModernPageController,
  ModernPageFactory,
  ModernPageName,
  ModernShellController,
  ModernShellFactory,
  UiLanguage
} from "./contracts";

const EMPTY_BOOTSTRAP_DATA: AppBootstrapData = Object.freeze({
  user: {
    id: null,
    username: "local",
    displayName: "Local",
    email: "",
    level: 0 as const,
    authDisabled: true
  },
  chatbotData: {},
  sheetReportData: {},
  productKeywords: {},
  language: "zh",
  llmEnabled: false,
  agentEnabled: false
});

const appSnapshot = shallowRef<AppBootstrapData>(EMPTY_BOOTSTRAP_DATA);
const readonlyAppSnapshot = readonly(appSnapshot);

export function getAppSnapshot() {
  return readonlyAppSnapshot;
}

function assertLanguage(language: unknown): asserts language is UiLanguage {
  if (language !== "zh" && language !== "en") {
    throw new TypeError("Application language must be zh or en");
  }
}

function assertBootstrapData(data: AppBootstrapData): void {
  if (typeof data !== "object" || data === null) {
    throw new TypeError("Application bootstrap data must be an object");
  }
  for (const key of ["chatbotData", "sheetReportData", "productKeywords"] as const) {
    if (!(key in data)) {
      throw new TypeError(`Application bootstrap is missing ${key}`);
    }
  }
  assertLanguage(data.language);
  if (typeof data.llmEnabled !== "boolean" || typeof data.agentEnabled !== "boolean") {
    throw new TypeError("Application bootstrap feature flags must be boolean");
  }
  if (!pageAccessRuntime()) {
    throw new TypeError("Page access runtime is unavailable");
  }
  if (!normalizeUser(data.user)) {
    throw new TypeError("Application bootstrap user is invalid");
  }
}

export function createModernAppApi(
  definitions: Partial<Record<ModernPageName, ModernPageFactory>> = {},
  shellFactory?: ModernShellFactory
): ModernAppApi {
  let activePage: { name: ModernPageName; controller: ModernPageController } | null = null;
  let activeShell: ModernShellController | null = null;
  let standalonePageHost: HTMLElement | null = null;
  let bootstrapReady = false;

  function unmountActivePage(): void {
    if (!activePage) return;
    const current = activePage;
    activePage = null;
    current.controller.unmount();
  }

  function unmountActiveShell(): void {
    if (!activeShell) return;
    const current = activeShell;
    activeShell = null;
    current.unmount();
  }

  function createStandaloneHost(element: HTMLElement): HTMLElement {
    const layout = document.createElement("div");
    layout.className = "modern-application";
    layout.setAttribute("data-modern-application", "true");

    const shellHost = document.createElement("div");
    shellHost.className = "modern-application-shell";
    shellHost.setAttribute("data-modern-shell-host", "true");

    const workspace = document.createElement("main");
    workspace.className = "modern-application-workspace";
    workspace.setAttribute("data-modern-workspace", "true");
    workspace.setAttribute("aria-live", "polite");

    const pageHost = document.createElement("div");
    pageHost.className = "modern-application-page";
    pageHost.setAttribute("data-modern-page-host", "true");
    pageHost.setAttribute("data-modern-root", "standalone");

    workspace.appendChild(pageHost);
    layout.append(shellHost, workspace);
    element.replaceChildren(layout);
    return pageHost;
  }

  function mountPageInternal(page: ModernPageName, element: HTMLElement): boolean {
    const factory = definitions[page];
    if (!factory) return false;
    unmountActivePage();
    const controller = factory(element);
    activePage = { name: page, controller };
    return true;
  }

  function pageIsAllowed(page: ModernPageName): boolean {
    return bootstrapReady && Boolean(pageAccessRuntime()) && canAccessPage(appSnapshot.value.user.level, page);
  }

  function defaultAllowedPage(): ModernPageName | null {
    const page = defaultPageForLevel(appSnapshot.value.user.level);
    return page && pageIsAllowed(page) ? page : null;
  }

  function mountShellInternal(element: HTMLElement): boolean {
    if (!shellFactory) return false;
    unmountActiveShell();
    activeShell = shellFactory(element);
    return true;
  }

  return {
    bootstrap(data) {
      assertBootstrapData(data);
      const user = normalizeUser(data.user);
      if (!user) throw new TypeError("Application bootstrap user is invalid");
      appSnapshot.value = Object.freeze({ ...data, user: Object.freeze(user) });
      bootstrapReady = true;
    },

    mountApplication(element, initialPage = "agent") {
      const resolvedPage = pageIsAllowed(initialPage) && definitions[initialPage]
        ? initialPage
        : defaultAllowedPage();
      if (!(element instanceof HTMLElement) || !shellFactory || !resolvedPage || !definitions[resolvedPage]) return false;
      unmountActivePage();
      unmountActiveShell();
      standalonePageHost = createStandaloneHost(element);
      const shellHost = element.querySelector<HTMLElement>("[data-modern-shell-host]");
      if (!shellHost || !mountShellInternal(shellHost)) {
        standalonePageHost = null;
        element.replaceChildren();
        return false;
      }
      return mountPageInternal(resolvedPage, standalonePageHost);
    },

    mountPage(page, element) {
      if (!pageIsAllowed(page)) return false;
      return mountPageInternal(page, element);
    },

    unmountPage(page) {
      if (!activePage || activePage.name !== page) return;
      unmountActivePage();
    },

    mountShell(element) {
      if (!bootstrapReady) return false;
      return mountShellInternal(element);
    },

    unmountShell() {
      unmountActiveShell();
    },

    setPage(page) {
      const targetPage = pageIsAllowed(page) ? page : defaultAllowedPage();
      if (!targetPage) return;
      activeShell?.setPage?.(targetPage);
      if (standalonePageHost && activePage?.name !== targetPage) {
        mountPageInternal(targetPage, standalonePageHost);
      }
    },

    setLanguage(language) {
      assertLanguage(language);
      appSnapshot.value = Object.freeze({ ...appSnapshot.value, language });
      activePage?.controller.setLanguage?.(language);
      activeShell?.setLanguage?.(language);
    },

    hasPage(page) {
      return Boolean(definitions[page]);
    }
  };
}
