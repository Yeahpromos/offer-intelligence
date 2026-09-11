<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
} from "vue";
import type { UiLanguage } from "../i18n";

const props = defineProps<{
  modelValue: readonly string[];
  options: readonly { value: string; label: string }[];
  label: string;
  language: UiLanguage;
  multiple?: boolean;
  searchable?: boolean;
  allLabel?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();
const id = useId();
const root = ref<HTMLElement>();
const panel = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const searchInput = ref<HTMLInputElement>();
const open = ref(false);
const search = ref("");
const position = ref({ left: "0px", top: "0px", width: "240px" });
const t = (zh: string, en: string) => (props.language === "zh" ? zh : en);
const filtered = computed(() =>
  props.options.filter((item) =>
    item.label
      .toLocaleLowerCase()
      .includes(search.value.trim().toLocaleLowerCase()),
  ),
);
const text = computed(() => {
  if (props.multiple && !props.modelValue.length)
    return props.allLabel || t("全部", "All");
  return props.options
    .filter((item) => props.modelValue.includes(item.value))
    .map((item) => item.label)
    .join("、");
});
function reposition() {
  if (!open.value || !trigger.value || !panel.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  const width = Math.min(Math.max(anchor.width, 240), window.innerWidth - 24);
  const height = panel.value.getBoundingClientRect().height;
  position.value = {
    width: `${width}px`,
    left: `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`,
    top: `${anchor.bottom + height + 8 <= window.innerHeight - 12 ? anchor.bottom + 8 : Math.max(12, anchor.top - height - 8)}px`,
  };
}
async function show() {
  if (open.value) {
    close();
    return;
  }
  search.value = "";
  open.value = true;
  await nextTick();
  reposition();
  await nextTick();
  reposition();
  if (!open.value) return;
  const target =
    searchInput.value ||
    panel.value?.querySelector<HTMLElement>(
      '[aria-selected="true"], [data-choice]',
    );
  target?.focus();
}
function close(restoreFocus = true) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
}
function select(value: string) {
  if (props.multiple) {
    const selected = new Set(props.modelValue);
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    emit("update:modelValue", [...selected]);
  } else {
    emit("update:modelValue", [value]);
    close();
  }
}
function onKey(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const isSearch = event.target === searchInput.value;
  if (isSearch && ["Home", "End"].includes(event.key)) return;
  const choices = [
    ...(panel.value?.querySelectorAll<HTMLElement>("[data-choice]") || []),
  ];
  if (!choices.length) return;
  event.preventDefault();
  const index = choices.indexOf(event.target as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? choices.length - 1
        : index < 0
          ? event.key === "ArrowUp"
            ? choices.length - 1
            : 0
          : (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) %
            choices.length;
  choices[next]?.focus();
  choices[next]?.scrollIntoView?.({ block: "nearest" });
}
function outside(event: Event) {
  if (
    open.value &&
    !root.value?.contains(event.target as Node) &&
    !panel.value?.contains(event.target as Node)
  )
    close(false);
}
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", outside);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", outside);
  window.removeEventListener("resize", reposition);
  window.removeEventListener("scroll", reposition, true);
});
</script>

<template>
  <div ref="root" class="filter-dropdown">
    <span :id="`${id}-label`" class="filter-dropdown-label">{{ label }}</span>
    <button
      ref="trigger"
      type="button"
      class="filter-dropdown-trigger"
      :aria-label="label"
      :aria-describedby="`${id}-value`"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="`${id}-panel`"
      @click="show"
      @keydown.down.prevent="show"
    >
      <span :id="`${id}-value`" :title="text">{{ text }}</span>
      <small v-if="multiple && modelValue.length">{{
        modelValue.length
      }}</small>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        aria-hidden="true"
      >
        <path d="m5 7 5 5 5-5" />
      </svg>
    </button>
    <Teleport to="body">
      <section
        v-if="open"
        :id="`${id}-panel`"
        ref="panel"
        class="filter-dropdown-panel"
        role="dialog"
        :aria-label="label"
        :style="position"
        @keydown="onKey"
      >
        <header>
          <strong>{{ label }}</strong
          ><button
            type="button"
            :aria-label="t('关闭', 'Close')"
            @click="close()"
          >
            ×
          </button>
        </header>
        <input
          v-if="searchable"
          ref="searchInput"
          v-model="search"
          type="search"
          autocomplete="off"
          :aria-label="t('搜索选项', 'Search options')"
          :placeholder="t('搜索选项', 'Search options')"
        />
        <template v-if="multiple">
          <button
            type="button"
            class="filter-dropdown-all"
            data-choice
            :aria-pressed="!modelValue.length"
            @click="emit('update:modelValue', [])"
          >
            <span>{{ allLabel || t("全部", "All") }}</span
            ><span v-if="!modelValue.length" aria-hidden="true">✓</span>
          </button>
          <div class="filter-dropdown-options" role="group" :aria-label="label">
            <label
              v-for="item in filtered"
              :key="item.value"
              class="filter-dropdown-option"
              :class="{ selected: modelValue.includes(item.value) }"
            >
              <input
                type="checkbox"
                data-choice
                :value="item.value"
                :checked="modelValue.includes(item.value)"
                @change="select(item.value)"
              />
              <span>{{ item.label }}</span>
            </label>
          </div>
          <footer>
            {{
              modelValue.length
                ? t(
                    `已选 ${modelValue.length} 项`,
                    `${modelValue.length} selected`,
                  )
                : t(
                    "不限，包含全部选项",
                    "No restriction; includes all options",
                  )
            }}
          </footer>
        </template>
        <div
          v-else
          class="filter-dropdown-options"
          role="listbox"
          :aria-label="label"
        >
          <button
            v-for="item in filtered"
            :key="item.value"
            type="button"
            role="option"
            data-choice
            class="filter-dropdown-option"
            :aria-selected="modelValue.includes(item.value)"
            @click="select(item.value)"
          >
            <span>{{ item.label }}</span
            ><span v-if="modelValue.includes(item.value)" aria-hidden="true"
              >✓</span
            >
          </button>
        </div>
        <p v-if="!filtered.length" role="status">
          {{ t("没有匹配的选项", "No matching options") }}
        </p>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.filter-dropdown {
  display: grid;
  gap: 7px;
  min-width: 0;
  align-content: start;
}
.filter-dropdown-label {
  font-size: 11px;
  line-height: 1.4;
  font-weight: 650;
  color: light-dark(#526783, #afc2df);
  letter-spacing: 0;
  text-transform: none;
}
.filter-dropdown-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 42px;
  padding: 9px 12px;
  border: 1px solid light-dark(#d5e0ee, #405471);
  border-radius: 10px;
  background: light-dark(#fff, #1a2638);
  color: light-dark(#203550, #e2eaf6);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
}
.filter-dropdown-trigger > span {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.filter-dropdown-trigger small {
  padding: 1px 6px;
  border-radius: 5px;
  background: light-dark(#eaf1ff, #29436a);
  color: light-dark(#255bd4, #a7c4ff);
}
.filter-dropdown-trigger svg {
  flex: none;
  width: 18px;
  height: 18px;
  color: light-dark(#526f98, #a7c4ff);
  transition: transform 160ms;
}
.filter-dropdown-trigger:hover,
.filter-dropdown-trigger[aria-expanded="true"] {
  border-color: light-dark(#3874ec, #91b6ff);
  background: light-dark(#f4f8ff, #223755);
}
.filter-dropdown-trigger[aria-expanded="true"] svg {
  transform: rotate(180deg);
}
.filter-dropdown-trigger:focus-visible {
  outline: 3px solid light-dark(#3874ec, #91b6ff);
  outline-offset: 2px;
}
.filter-dropdown-panel {
  position: fixed;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  max-height: calc(100dvh - 24px);
  padding: 12px;
  border: 1px solid light-dark(#d5e0ee, #405471);
  border-radius: 14px;
  background: light-dark(#fff, #1a2638);
  color: light-dark(#203550, #e2eaf6);
  box-shadow: 0 16px 44px rgb(25 50 90 / 18%);
  font:
    13px/1.5 "Plus Jakarta Sans",
    sans-serif;
}
.filter-dropdown-panel * {
  box-sizing: border-box;
}
.filter-dropdown-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.filter-dropdown-panel header strong {
  font-size: 12px;
}
.filter-dropdown-panel header button {
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  width: 30px;
  height: 30px;
  font: inherit;
  font-size: 22px;
  cursor: pointer;
}
.filter-dropdown-panel input[type="search"] {
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  margin-bottom: 8px;
  background: light-dark(#f6f9ff, #233650);
  color: inherit;
  border: 1px solid light-dark(#d5e0ee, #405471);
  border-radius: 8px;
  font: inherit;
}
.filter-dropdown-options {
  min-height: 0;
  max-height: 280px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.filter-dropdown-option,
.filter-dropdown-all {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 42px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
button.filter-dropdown-option,
.filter-dropdown-all {
  justify-content: space-between;
}
.filter-dropdown-option:hover,
.filter-dropdown-all:hover,
.filter-dropdown-panel header button:hover {
  background: light-dark(#edf3ff, #293f61);
}
.filter-dropdown-option.selected,
.filter-dropdown-option[aria-selected="true"],
.filter-dropdown-all[aria-pressed="true"] {
  background: light-dark(#edf3ff, #293f61);
  color: light-dark(#2158cb, #b2ceff);
}
.filter-dropdown-option:focus-within {
  outline: 2px solid light-dark(#3874ec, #91b6ff);
  outline-offset: -2px;
}
.filter-dropdown-panel :is(button, input):focus-visible {
  outline: 2px solid light-dark(#3874ec, #91b6ff);
  outline-offset: -2px;
}
.filter-dropdown-option input[type="checkbox"] {
  width: 17px;
  height: 17px;
  flex: none;
  margin: 0;
  accent-color: #2c68e8;
}
.filter-dropdown-all {
  margin-bottom: 6px;
  border-bottom-color: light-dark(#d5e0ee, #405471);
}
.filter-dropdown-panel footer {
  padding: 10px 4px 0;
  margin-top: 8px;
  border-top: 1px solid light-dark(#e2e9f4, #405471);
  color: light-dark(#526783, #afc2df);
  font-size: 11px;
}
.filter-dropdown-panel p {
  padding: 4px;
  color: light-dark(#526783, #afc2df);
}
@media (prefers-reduced-motion: reduce) {
  .filter-dropdown-trigger svg {
    transition: none;
  }
}
</style>
