<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { ModernPageName, UiLanguage } from "../runtime/contracts";
import { canAccessPage } from "../shared/pageAccess";
import {
  GOOGLE_ADS_NAVIGATION_ITEM,
  NAVIGATION_GROUPS,
  navigationGroupForPage,
  pageLabel,
  pageTitle,
  type NavigationGroupKey,
  type NavigationIconName,
  type NavigationLocation
} from "./navigation";
import { usePageState } from "./usePageState";
import { applyTheme, readStoredTheme, writeStoredTheme, type ShellTheme } from "./theme";
import type { AppShellController, AppShellProps } from "./appShellContracts";

const props = defineProps<AppShellProps>();

const copy = {
  zh: {
    brandSubtitle: "Amazon Tier 分析",
    navigation: "主导航",
    sidebarControls: "侧边栏控制",
    openMenu: "打开导航",
    closeMenu: "关闭导航",
    language: "切换到英文",
    languageShort: "EN",
    languageEnglish: "English",
    languageChinese: "中文",
    lightTheme: "浅色主题",
    darkTheme: "深色主题",
    switchToLight: "切换到浅色主题",
    switchToDark: "切换到深色主题",
    signOut: "退出登录",
    shellLabel: "YeahPromos Offer Intelligence"
  },
  en: {
    brandSubtitle: "Amazon tier analysis",
    navigation: "Primary navigation",
    sidebarControls: "Sidebar controls",
    openMenu: "Open navigation",
    closeMenu: "Close navigation",
    language: "切换到中文",
    languageShort: "中文",
    languageEnglish: "English",
    languageChinese: "中文",
    lightTheme: "Light theme",
    darkTheme: "Dark theme",
    switchToLight: "Switch to light theme",
    switchToDark: "Switch to dark theme",
    signOut: "Sign out",
    shellLabel: "YeahPromos Offer Intelligence"
  }
} as const;

type CopyKey = keyof typeof copy.zh;

const iconPaths: Record<NavigationIconName, readonly string[]> = {
  agent: [
    "M12 3a7 7 0 0 0-7 7v2a7 7 0 0 0 7 7 7 7 0 0 0 7-7v-2a7 7 0 0 0-7-7z",
    "M9 11h.01M15 11h.01M9 15c1.8 1.2 4.2 1.2 6 0",
    "M5 12H3M21 12h-2"
  ],
  chatbot: [
    "M5 6h14v10H9l-4 3z",
    "M8 10h.01M12 10h.01M16 10h.01"
  ],
  targets: ["M5 5h14v14H5z", "M9 5v14", "M5 10h14"],
  calendar: ["M5 4h14v16H5z", "M8 2v4M16 2v4M5 9h14", "M12 12v5M9.5 14.5h5"],
  payments: ["M4 7h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M4 9h16", "M8 14h4"],
  tier: ["M5 19h14", "M8 16v-5", "M12 16V7", "M16 16v-8"],
  publishers: [
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z",
    "M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9S14.4 18.5 12 21M12 3C9.6 5.5 8.4 8.5 8.4 12S9.6 18.5 12 21"
  ],
  "brand-media": ["M4 19V5m0 14h16", "M7 15l3-4 3 2 5-7", "M15 6h3v3"],
  "revenue-flow": ["M4 6h5v12H4zM15 6h5v12h-5z", "M9 9h6M9 15h6", "m12 7 3 2-3 2M12 13l3 2-3 2"],
  "google-ads": ["M8.5 5 3 15.5A3 3 0 0 0 5.6 20h.2a3 3 0 0 0 2.7-1.7L14 7.8", "m12.2 5 5.5 10.5", "M18.3 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  products: ["m4 7 8-4 8 4-8 4z", "m4 7 8 4 8-4v10l-8 4-8-4z", "M12 11v10"],
  category: ["M4 7h16", "M4 12h16", "M4 17h10"]
};

const state = usePageState(props.initialPage, props.userLevel);
const currentPage = state.currentPage;
const isCompact = state.isCompact;
const isMenuOpen = state.isMenuOpen;
const currentLanguage = ref<UiLanguage>(props.language);
const theme = ref<ShellTheme>(readStoredTheme(props.storage ?? getBrowserStorage()));
const sidebarRef = ref<HTMLElement | null>(null);
const menuTriggerRef = ref<HTMLButtonElement | null>(null);
const closeButtonRef = ref<HTMLButtonElement | null>(null);
let mediaQuery: MediaQueryList | null = null;

function getBrowserStorage(): Storage | undefined {
  try {
    return document.defaultView?.localStorage;
  } catch {
    return undefined;
  }
}

function translate(key: CopyKey): string {
  return copy[currentLanguage.value][key];
}

function localized(value: { readonly zh: string; readonly en: string }): string {
  return value[currentLanguage.value];
}

const currentPageLabel = computed(() => pageLabel(state.currentPage.value, currentLanguage.value));
const activeLocation = computed(() => navigationGroupForPage(state.currentPage.value));
const themeActionLabel = computed(() => theme.value === "light" ? translate("switchToDark") : translate("switchToLight"));
const languageActionLabel = computed(() => translate("language"));
const languageButtonLabel = computed(() => currentLanguage.value === "zh" ? translate("languageShort") : translate("languageChinese"));
const visibleNavigationGroups = computed(() => NAVIGATION_GROUPS
  .map((group) => ({ ...group, items: group.items.filter((item) => canAccessPage(props.userLevel, item.page)) }))
  .filter((group) => group.items.length > 0));

function isPageAllowed(page: ModernPageName): boolean {
  return canAccessPage(props.userLevel, page);
}

function isGroupOpen(group: NavigationGroupKey): boolean {
  return state.openGroup.value === group;
}

function isPageActive(page: ModernPageName): boolean {
  return state.currentPage.value === page;
}

function selectPage(page: ModernPageName): void {
  if (!isPageAllowed(page)) return;
  state.setPage(page);
  props.navigate(page);
}

function toggleGroup(group: NavigationGroupKey): void {
  state.toggleGroup(group);
}

function toggleLanguage(): void {
  const nextLanguage: UiLanguage = currentLanguage.value === "zh" ? "en" : "zh";
  currentLanguage.value = nextLanguage;
  props.setLanguage?.(nextLanguage);
}

function toggleTheme(): void {
  theme.value = theme.value === "light" ? "dark" : "light";
}

function focusableSidebarElements(): HTMLElement[] {
  const sidebar = sidebarRef.value;
  if (!sidebar) return [];
  return Array.from(sidebar.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => element.getAttribute("aria-hidden") !== "true" && !element.closest('[aria-hidden="true"]'));
}

function closeMenu(restoreFocus = false): void {
  state.closeMenu();
  if (restoreFocus) {
    nextTick(() => menuTriggerRef.value?.focus({ preventScroll: true }));
  }
}

function toggleMenu(): void {
  if (state.isMenuOpen.value) {
    closeMenu(true);
  } else {
    state.openMenu();
  }
}

function setWorkspaceInert(): void {
  const workspace = document.querySelector<HTMLElement>(
    "#appShell > .workspace, [data-modern-workspace]"
  );
  if (!workspace) return;
  const shouldInert = state.isCompact.value && state.isMenuOpen.value;
  workspace.inert = shouldInert;
  if (shouldInert) {
    workspace.setAttribute("aria-hidden", "true");
  } else {
    workspace.removeAttribute("aria-hidden");
  }
}

function syncViewport(): void {
  state.setCompact(Boolean(mediaQuery?.matches));
}

function handleShellKeydown(event: KeyboardEvent): void {
  state.handleKeydown(event, focusableSidebarElements(), menuTriggerRef.value);
}

function updateDocumentMetadata(): void {
  document.title = pageTitle(state.currentPage.value, currentLanguage.value);
  document.documentElement.lang = currentLanguage.value === "zh" ? "zh-Hans" : "en";
}

function updateTheme(nextTheme: ShellTheme): void {
  applyTheme(document, nextTheme);
  writeStoredTheme(props.storage ?? getBrowserStorage(), nextTheme);
}

watch(() => props.language, (nextLanguage) => {
  currentLanguage.value = nextLanguage;
});
watch([state.currentPage, currentLanguage], updateDocumentMetadata, { immediate: true });
watch(theme, updateTheme, { immediate: true });
watch([state.isCompact, state.isMenuOpen], setWorkspaceInert, { immediate: true });
watch(state.isMenuOpen, (open) => {
  if (open && state.isCompact.value) {
    nextTick(() => closeButtonRef.value?.focus({ preventScroll: true }));
  }
});

onMounted(() => {
  const view = document.defaultView;
  mediaQuery = view?.matchMedia?.("(max-width: 1120px)") ?? null;
  syncViewport();
  if (mediaQuery?.addEventListener) {
    mediaQuery.addEventListener("change", syncViewport);
  } else {
    mediaQuery?.addListener?.(syncViewport);
  }
  document.addEventListener("keydown", handleShellKeydown);
  const controller: AppShellController = {
    setPage: state.setPage,
    setLanguage(language) {
      currentLanguage.value = language;
    }
  };
  props.onReady?.(controller);
});

onBeforeUnmount(() => {
  if (mediaQuery?.removeEventListener) {
    mediaQuery.removeEventListener("change", syncViewport);
  } else {
    mediaQuery?.removeListener?.(syncViewport);
  }
  document.removeEventListener("keydown", handleShellKeydown);
  const workspace = document.querySelector<HTMLElement>(
    "#appShell > .workspace, [data-modern-workspace]"
  );
  if (workspace) {
    workspace.inert = false;
    workspace.removeAttribute("aria-hidden");
  }
});
</script>

<template>
  <div
    class="modern-shell"
    :class="{ 'is-compact': isCompact, 'is-menu-open': isMenuOpen }"
    :data-theme="theme"
    :data-page="currentPage"
    :aria-label="translate('shellLabel')"
  >
    <header class="modern-shell-mobile-bar">
      <button
        ref="menuTriggerRef"
        class="modern-shell-menu-trigger"
        type="button"
        :aria-label="translate('openMenu')"
        aria-controls="modernShellSidebar"
        :aria-expanded="isMenuOpen"
        @click="toggleMenu"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <div class="modern-shell-mobile-identity">
        <span class="modern-shell-mark" aria-hidden="true">Y</span>
        <span>
          <strong>YeahPromos</strong>
          <small>{{ currentPageLabel }}</small>
        </span>
      </div>
      <span class="modern-shell-mobile-page">{{ currentPageLabel }}</span>
    </header>

    <button
      class="modern-shell-backdrop"
      type="button"
      :aria-label="translate('closeMenu')"
      :aria-hidden="!isMenuOpen"
      @click="closeMenu(true)"
    ></button>

    <aside
      id="modernShellSidebar"
      ref="sidebarRef"
      class="modern-shell-sidebar"
      :aria-label="translate('navigation')"
      :aria-hidden="isCompact && !isMenuOpen"
      :inert="isCompact && !isMenuOpen"
    >
      <div class="modern-shell-brand">
        <div class="modern-shell-brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="modern-shell-brand-copy">
          <strong>YeahPromos</strong>
          <span>{{ translate("brandSubtitle") }}</span>
        </div>
        <button
          ref="closeButtonRef"
          class="modern-shell-close"
          type="button"
          :aria-label="translate('closeMenu')"
          @click="closeMenu(true)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <div class="modern-shell-controls" :aria-label="translate('sidebarControls')">
        <button
          class="modern-shell-control"
          type="button"
          data-shell-language
          :aria-label="languageActionLabel"
          @click="toggleLanguage"
        >
          <span class="modern-shell-control-icon" aria-hidden="true">文</span>
          <span>{{ languageButtonLabel }}</span>
        </button>
        <button
          class="modern-shell-control"
          type="button"
          data-shell-theme
          :aria-label="themeActionLabel"
          :title="themeActionLabel"
          @click="toggleTheme"
        >
          <span class="modern-shell-control-icon" aria-hidden="true">{{ theme === "light" ? "☾" : "☼" }}</span>
          <span>{{ theme === "light" ? translate("darkTheme") : translate("lightTheme") }}</span>
        </button>
        <button id="modernLogoutButton" class="modern-shell-control modern-shell-logout" type="button">
          <span class="modern-shell-control-icon" aria-hidden="true">↪</span>
          <span>{{ translate("signOut") }}</span>
        </button>
      </div>

      <nav class="modern-shell-nav" :aria-label="translate('navigation')">
        <section
          v-for="group in visibleNavigationGroups"
          :key="group.key"
          class="modern-shell-nav-group"
          :class="{ 'is-current': activeLocation === group.key, 'is-open': isGroupOpen(group.key) }"
          :data-shell-group="group.key"
        >
          <button
            class="modern-shell-group-toggle"
            type="button"
            :aria-expanded="isGroupOpen(group.key)"
            :aria-controls="`modernShellSubnav-${group.key}`"
            @click="toggleGroup(group.key)"
          >
            <span class="modern-shell-nav-icon modern-shell-group-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path :d="iconPaths[group.items[0]?.icon || 'products'][0]" /></svg>
            </span>
            <span class="modern-shell-group-copy">
              <strong>{{ localized(group.label) }}</strong>
              <small>{{ localized(group.hint) }}</small>
            </span>
            <span class="modern-shell-group-count" aria-hidden="true">{{ String(group.items.length).padStart(2, "0") }}</span>
            <span class="modern-shell-chevron" aria-hidden="true">⌄</span>
          </button>
          <div
            :id="`modernShellSubnav-${group.key}`"
            class="modern-shell-subnav"
            :aria-hidden="!isGroupOpen(group.key)"
            v-show="isGroupOpen(group.key)"
          >
            <button
              v-for="item in group.items"
              :key="item.page"
              class="modern-shell-nav-item"
              :class="{ active: isPageActive(item.page) }"
              type="button"
              :data-shell-nav-page="item.page"
              :aria-current="isPageActive(item.page) ? 'page' : undefined"
              @click="selectPage(item.page)"
            >
              <span class="modern-shell-nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path v-for="path in iconPaths[item.icon]" :key="path" :d="path" />
                </svg>
              </span>
              <span class="modern-shell-item-copy">
                <strong>{{ localized(item.label) }}</strong>
                <small>{{ localized(item.hint) }}</small>
              </span>
              <span v-if="isPageActive(item.page)" class="modern-shell-active-dot" aria-hidden="true"></span>
            </button>
          </div>
        </section>

        <button
          v-if="isPageAllowed(GOOGLE_ADS_NAVIGATION_ITEM.page)"
          class="modern-shell-primary-item"
          :class="{ active: isPageActive(GOOGLE_ADS_NAVIGATION_ITEM.page) }"
          type="button"
          data-shell-nav-page="google-ads"
          :aria-current="isPageActive(GOOGLE_ADS_NAVIGATION_ITEM.page) ? 'page' : undefined"
          @click="selectPage(GOOGLE_ADS_NAVIGATION_ITEM.page)"
        >
          <span class="modern-shell-nav-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path v-for="path in iconPaths['google-ads']" :key="path" :d="path" /></svg>
          </span>
          <span class="modern-shell-item-copy">
            <strong>{{ localized(GOOGLE_ADS_NAVIGATION_ITEM.label) }}</strong>
            <small>{{ localized(GOOGLE_ADS_NAVIGATION_ITEM.hint) }}</small>
          </span>
          <span v-if="isPageActive(GOOGLE_ADS_NAVIGATION_ITEM.page)" class="modern-shell-active-dot" aria-hidden="true"></span>
        </button>
      </nav>

      <footer class="modern-shell-footer">
        <span class="modern-shell-footer-pulse" aria-hidden="true"></span>
        <span>{{ currentPageLabel }}</span>
        <small>{{ theme === "light" ? translate("lightTheme") : translate("darkTheme") }}</small>
      </footer>
    </aside>
  </div>
</template>

<style scoped>
/* Shell 的布局和主题样式集中在 shell.css，组件样式保持为零，避免重复定义变量。 */
</style>
