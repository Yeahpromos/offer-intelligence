<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import type { UiLanguage } from "../i18n";

const props = defineProps<{ modelValue: string; language: UiLanguage; label: string; today?: () => Date }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const id = useId();
const root = ref<HTMLElement>();
const panel = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const open = ref(false);
const year = ref(2026);
const focused = ref(0);
const position = ref({ left: "0px", top: "0px" });
const t = (zh: string, en: string) => props.language === "zh" ? zh : en;
const now = () => props.today?.() ?? new Date();
const valueFor = (month: number) => `${year.value}-${String(month + 1).padStart(2, "0")}`;
const months = computed(() => Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString(props.language === "zh" ? "zh-CN" : "en-US", { month: "short" })));
const display = computed(() => {
  const [y, m] = props.modelValue.split("-").map(Number);
  return y && m ? new Date(y, m - 1, 1).toLocaleDateString(props.language === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "long" }) : props.modelValue;
});
function reposition() {
  if (!open.value || !root.value || !panel.value) return;
  const anchor = root.value.getBoundingClientRect();
  const box = panel.value.getBoundingClientRect();
  position.value = { left: `${Math.max(12, Math.min(anchor.left, window.innerWidth - box.width - 12))}px`, top: `${anchor.bottom + box.height + 8 < window.innerHeight - 12 ? anchor.bottom + 8 : Math.max(12, anchor.top - box.height - 8)}px` };
}
async function focusMonth() {
  await nextTick();
  if (open.value) panel.value?.querySelector<HTMLButtonElement>(`[data-month="${focused.value}"]`)?.focus();
}
async function show() {
  if (open.value) { close(); return; }
  const [y, m] = props.modelValue.split("-").map(Number);
  year.value = y || now().getFullYear();
  focused.value = m ? m - 1 : now().getMonth();
  open.value = true;
  await nextTick();
  reposition();
  await focusMonth();
}
function close(restore = true) { open.value = false; if (restore) trigger.value?.focus(); }
function select(value: string) { emit("update:modelValue", value); close(); }
function moveYear(delta: number) { year.value = Math.min(9999, Math.max(1, year.value + delta)); }
function onMonthKey(event: KeyboardEvent, month: number) {
  const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };
  if (event.key in offsets) {
    const date = new Date(year.value, month + offsets[event.key]!, 1);
    year.value = date.getFullYear(); focused.value = date.getMonth();
  } else if (event.key === "Home") focused.value = 0;
  else if (event.key === "End") focused.value = 11;
  else if (event.key === "PageUp" || event.key === "PageDown") moveYear(event.key === "PageUp" ? -1 : 1);
  else return;
  event.preventDefault(); void focusMonth();
}
function outside(event: Event) {
  if (open.value && !root.value?.contains(event.target as Node) && !panel.value?.contains(event.target as Node)) close(false);
}
onMounted(() => { document.addEventListener("pointerdown", outside); document.addEventListener("focusin", outside); window.addEventListener("resize", reposition); window.addEventListener("scroll", reposition, true); });
onBeforeUnmount(() => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); });
</script>

<template>
  <div ref="root" class="month-picker">
    <button ref="trigger" class="month-picker-trigger" type="button" :aria-label="label" :aria-describedby="`${id}-value`" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="id" @click="show" @keydown.down.prevent="show">
      <span :id="`${id}-value`">{{ display }}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16"/></svg>
    </button>
    <Teleport to="body">
      <section v-if="open" :id="id" ref="panel" class="month-picker-panel" role="dialog" :aria-label="label" :style="position" @keydown.esc.stop.prevent="close()">
        <header><span>{{ label }}</span><button type="button" :aria-label="t('关闭月份选择', 'Close month picker')" @click="close()">×</button></header>
        <div class="month-picker-year"><button type="button" :aria-label="t('上一年', 'Previous year')" @click="moveYear(-1)">‹</button><strong aria-live="polite">{{ year }}{{ language === 'zh' ? '年' : '' }}</strong><button type="button" :aria-label="t('下一年', 'Next year')" @click="moveYear(1)">›</button></div>
        <div class="month-picker-months">
          <button v-for="(month, index) in months" :key="index" type="button" :data-month="index" :tabindex="focused === index ? 0 : -1" :aria-label="`${year} ${month}`" :aria-pressed="modelValue === valueFor(index)" @click="select(valueFor(index))" @keydown="onMonthKey($event, index)">{{ month }}</button>
        </div>
        <footer><button type="button" @click="select(`${now().getFullYear()}-${String(now().getMonth() + 1).padStart(2, '0')}`)">{{ t('本月', 'This month') }}</button></footer>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.month-picker-trigger { width:100%; min-height:44px; display:flex; align-items:center; justify-content:space-between; gap:20px; padding:10px 12px; border:1px solid light-dark(#ccd9ed,#405471); border-radius:10px; background:light-dark(#fff,#1a2638); color:light-dark(#203550,#e2eaf6); cursor:pointer; }
.month-picker-trigger svg { width:18px; height:18px; flex:none; }
.month-picker-panel { position:fixed; z-index:1700; width:min(312px,calc(100vw - 24px)); max-height:calc(100dvh - 24px); overflow:auto; padding:16px; box-sizing:border-box; border:1px solid light-dark(#d5e0ee,#405471); border-radius:16px; background:light-dark(#fff,#1a2638); color:light-dark(#203550,#e2eaf6); box-shadow:0 16px 44px rgb(25 50 90 / 18%); font:14px/1.5 sans-serif; }
.month-picker-panel button { font:inherit; color:inherit; border:0; background:transparent; border-radius:8px; cursor:pointer; min-height:40px; min-width:36px; }
.month-picker-panel header,.month-picker-year { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.month-picker-panel header { font-size:12px; color:light-dark(#526783,#afc2df); padding-bottom:8px; border-bottom:1px solid light-dark(#e2e9f4,#405471); }
.month-picker-panel header button { font-size:22px; }
.month-picker-year { margin:8px 0; }
.month-picker-year button { font-size:24px; }
.month-picker-months { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; }
.month-picker-months button { min-height:44px; }
.month-picker-panel button:hover { background:light-dark(#edf3ff,#293f61); }
.month-picker-months button[aria-pressed="true"] { background:#265dd9; color:#fff; }
.month-picker-panel footer { margin-top:12px; padding-top:8px; border-top:1px solid light-dark(#e2e9f4,#405471); text-align:right; }
.month-picker-panel footer button { color:light-dark(#265dd9,#a0bfff); padding:8px 14px; }
.month-picker-trigger:focus-visible,.month-picker-panel button:focus-visible { outline:2px solid light-dark(#265dd9,#a0bfff); outline-offset:2px; }
</style>
