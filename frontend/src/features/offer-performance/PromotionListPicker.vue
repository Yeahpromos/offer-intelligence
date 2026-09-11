<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from "vue";
import type { UiLanguage } from "../../shared/i18n";
import type { PromotionBatch } from "./performanceModel";

const props = defineProps<{
  modelValue: string;
  batches: PromotionBatch[];
  language: UiLanguage;
}>();
const emit = defineEmits<{ "update:modelValue": [id: string] }>();
const t = (zh: string, en: string) => (props.language === "zh" ? zh : en);
const id = useId();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const input = ref<HTMLInputElement>();
const open = ref(false);
const search = ref("");
const active = ref(0);
const selected = computed(() =>
  props.batches.find((item) => item.id === props.modelValue),
);
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase();
  return props.batches.filter((item) =>
    `${item.name} ${item.sourceFile}`.toLocaleLowerCase().includes(query),
  );
});
const optionId = (index: number) => `${id}-option-${index}`;
const count = (item: PromotionBatch) =>
  `${item.offers.length} ${t("个商家", "merchants")} · ${item.offers.reduce((sum, offer) => sum + offer.asins.length, 0)} ASIN`;
async function revealActive() {
  await nextTick();
  root.value
    ?.querySelector(`#${CSS.escape(optionId(active.value))}`)
    ?.scrollIntoView?.({ block: "nearest" });
}
async function show(last = false) {
  if (open.value) return;
  search.value = "";
  open.value = true;
  await nextTick();
  const index = filtered.value.findIndex(
    (item) => item.id === props.modelValue,
  );
  active.value = index >= 0 ? index : last ? filtered.value.length - 1 : 0;
  input.value?.focus();
  void revealActive();
}
function close(restoreFocus = true) {
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
}
function choose(item: PromotionBatch) {
  if (item.id !== props.modelValue) emit("update:modelValue", item.id);
  close();
}
function navigate(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const length = filtered.value.length;
    active.value = length
      ? (active.value + (event.key === "ArrowDown" ? 1 : -1) + length) % length
      : 0;
    void revealActive();
  } else if (event.key === "Enter") {
    event.preventDefault();
    const item = filtered.value[active.value];
    if (item) choose(item);
  }
}
function outside(event: Event) {
  if (open.value && !root.value?.contains(event.target as Node)) close(false);
}
watch(search, () => {
  active.value = 0;
  void revealActive();
});
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", outside);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", outside);
});
</script>

<template>
  <div
    ref="root"
    class="promotion-list-picker"
    @keydown.esc.stop.prevent="close()"
  >
    <span :id="`${id}-label`" class="promotion-list-label">{{
      t("追踪清单", "Tracking list")
    }}</span>
    <button
      id="promotion-list-selector"
      ref="trigger"
      type="button"
      class="promotion-list-trigger"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="`${id}-panel`"
      :aria-labelledby="`${id}-label ${id}-value`"
      @click="open ? close() : show()"
      @keydown.down.prevent="show()"
      @keydown.up.prevent="show(true)"
    >
      <span :id="`${id}-value`">{{
        selected?.name || t("选择追踪清单", "Choose a tracking list")
      }}</span>
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
    <div
      v-if="open"
      :id="`${id}-panel`"
      class="promotion-list-panel"
      role="dialog"
      :aria-label="t('选择追踪清单', 'Choose a tracking list')"
    >
      <input
        ref="input"
        v-model="search"
        type="search"
        role="combobox"
        autocomplete="off"
        :aria-label="t('搜索清单名称或文件名', 'Search list or file name')"
        :placeholder="t('搜索清单名称或文件名', 'Search list or file name')"
        aria-autocomplete="list"
        aria-expanded="true"
        :aria-controls="`${id}-options`"
        :aria-activedescendant="filtered[active] ? optionId(active) : undefined"
        @keydown="navigate"
      />
      <small class="promotion-list-count" role="status"
        >{{ filtered.length }} {{ t("份清单", "lists") }}</small
      >
      <div
        :id="`${id}-options`"
        role="listbox"
        :aria-label="t('追踪清单', 'Tracking lists')"
        class="promotion-list-options"
      >
        <div
          v-for="(item, index) in filtered"
          :id="optionId(index)"
          :key="item.id"
          role="option"
          :aria-selected="item.id === modelValue"
          :class="{ 'is-active': active === index }"
          class="promotion-list-option"
          @pointermove="active = index"
          @mousedown.prevent
          @click="choose(item)"
        >
          <div>
            <strong>{{ item.name }}</strong
            ><small>{{ count(item) }}</small
            ><small class="promotion-list-source">{{
              item.sourceFile || t("手动添加", "Manually added")
            }}</small>
          </div>
          <span
            v-if="item.id === modelValue"
            class="promotion-list-check"
            aria-hidden="true"
            >✓</span
          >
        </div>
      </div>
      <p v-if="!filtered.length" class="promotion-list-empty">
        {{
          t(
            "没有匹配的清单，请换个关键词。",
            "No matching lists. Try another search.",
          )
        }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.promotion-list-picker {
  position: relative;
  min-width: 0;
}
.promotion-list-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 650;
}
.promotion-list-picker .promotion-list-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  width: 100%;
  min-height: 48px;
  padding: 12px 14px;
  color: var(--pp-ink);
  text-align: left;
  font-weight: 650;
}
.promotion-list-trigger span {
  overflow-wrap: anywhere;
}
.promotion-list-trigger svg {
  width: 20px;
  height: 20px;
  flex: none;
  color: var(--pp-blue);
  transition: transform 160ms;
}
.promotion-list-trigger[aria-expanded="true"] {
  border-color: var(--pp-blue);
  background: var(--pp-soft);
}
.promotion-list-trigger[aria-expanded="true"] svg {
  transform: rotate(180deg);
}
.promotion-list-panel {
  position: absolute;
  z-index: 20;
  top: calc(100% + 8px);
  left: 0;
  width: 100%;
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--pp-line);
  border-radius: 13px;
  background: var(--pp-panel);
  box-shadow: 0 14px 40px #18345926;
}
.promotion-list-panel input {
  width: 100%;
  font-size: 13px;
}
.promotion-list-count {
  display: block;
  padding: 10px 4px 7px;
}
.promotion-list-options {
  max-height: min(340px, 45dvh);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.promotion-list-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
}
.promotion-list-option + .promotion-list-option {
  margin-top: 4px;
}
.promotion-list-option div {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.promotion-list-option strong {
  color: var(--pp-ink);
  font-size: 14px;
  overflow-wrap: anywhere;
}
.promotion-list-option small {
  font-size: 12px;
}
.promotion-list-source {
  overflow-wrap: anywhere;
}
.promotion-list-option[aria-selected="true"] {
  background: var(--pp-soft);
}
.promotion-list-option.is-active {
  border-color: var(--pp-blue);
  background: var(--pp-soft);
}
.promotion-list-check {
  color: var(--pp-blue);
  font-weight: 750;
}
.promotion-list-empty {
  padding: 8px 4px;
}
@media (prefers-reduced-motion: reduce) {
  .promotion-list-trigger svg {
    transition: none;
  }
}
</style>
