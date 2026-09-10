<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { translateMessage, type UiLanguage } from "../i18n";

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  modelValue: string;
  language: UiLanguage;
  label: string;
  disabled?: boolean;
  today?: () => Date;
  teleportTo?: string | HTMLElement;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const id = useId();
const root = ref<HTMLElement>();
const panel = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const open = ref(false);
const focused = ref("");
const view = ref(new Date());
const position = ref({ left: "0px", top: "0px" });
const t = (key: string) => translateMessage(props.language, `datePicker.${key}`);
const now = () => props.today?.() ?? new Date();
function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parse(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && iso(date) === value ? date : null;
}
const locale = computed(() => props.language === "zh" ? "zh-CN" : "en-US");
const weekdays = computed(() => props.language === "zh" ? ["一", "二", "三", "四", "五", "六", "日"] : ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
const months = computed(() => Array.from({ length: 12 }, (_, month) => new Date(2026, month, 1).toLocaleDateString(locale.value, { month: "long" })));
const years = computed(() => {
  const year = view.value.getFullYear();
  const first = Math.min(2000, year - 10);
  const last = Math.max(now().getFullYear() + 10, year + 10);
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
});
const days = computed(() => {
  const first = new Date(view.value.getFullYear(), view.value.getMonth(), 1, 12);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), index - offset + 1, 12);
    return { value: iso(date), day: date.getDate(), outside: date.getMonth() !== first.getMonth(), today: iso(date) === iso(now()), label: date.toLocaleDateString(locale.value, { year: "numeric", month: "long", day: "numeric" }) };
  });
});
function reposition(): void {
  if (!open.value || !root.value || !panel.value) return;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
  panel.value.style.maxWidth = `${viewportWidth - 24}px`;
  const anchor = root.value.getBoundingClientRect();
  const box = panel.value.getBoundingClientRect();
  const left = Math.max(12, Math.min(anchor.left, viewportWidth - box.width - 12));
  const top = anchor.bottom + box.height + 8 <= window.innerHeight - 12 ? anchor.bottom + 8 : Math.max(12, anchor.top - box.height - 8);
  position.value = { left: `${left}px`, top: `${top}px` };
}
async function focusDay(): Promise<void> {
  await nextTick();
  panel.value?.querySelector<HTMLButtonElement>(`[data-date="${focused.value}"]`)?.focus();
}
async function show(): Promise<void> {
  if (props.disabled) return;
  if (open.value) { close(); return; }
  const date = parse(props.modelValue) ?? now();
  view.value = date;
  focused.value = iso(date);
  open.value = true;
  await nextTick();
  reposition();
  await focusDay();
}
function close(restoreFocus = true): void {
  open.value = false;
  if (restoreFocus) trigger.value?.focus();
}
function select(value: string): void {
  emit("update:modelValue", value);
  close();
}
function changeMonth(delta: number): void {
  view.value = new Date(view.value.getFullYear(), view.value.getMonth() + delta, 1, 12);
  focused.value = iso(view.value);
}
function changeView(year: number, month: number): void {
  view.value = new Date(year, month, 1, 12);
  focused.value = iso(view.value);
}
function onDayKey(event: KeyboardEvent, value: string): void {
  const date = parse(value);
  if (!date) return;
  const deltas: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -((date.getDay() + 6) % 7), End: 6 - ((date.getDay() + 6) % 7) };
  if (event.key === "PageUp" || event.key === "PageDown") {
    event.preventDefault();
    changeMonth(event.key === "PageUp" ? -1 : 1);
  } else if (event.key in deltas) {
    event.preventDefault();
    date.setDate(date.getDate() + deltas[event.key]!);
    focused.value = iso(date);
    view.value = date;
  } else return;
  void focusDay();
}
function outside(event: PointerEvent): void {
  if (open.value && !root.value?.contains(event.target as Node) && !panel.value?.contains(event.target as Node)) close(false);
}
function onFocus(event: FocusEvent): void {
  if (open.value && !root.value?.contains(event.target as Node) && !panel.value?.contains(event.target as Node)) close(false);
}
function escape(event: KeyboardEvent): void {
  if (open.value && event.key === "Escape") { event.preventDefault(); close(); }
}
watch(() => props.disabled, (disabled) => { if (disabled) close(false); });
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", onFocus);
  document.addEventListener("keydown", escape);
  window.addEventListener("resize", reposition);
  window.addEventListener("scroll", reposition, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("focusin", onFocus);
  document.removeEventListener("keydown", escape);
  window.removeEventListener("resize", reposition);
  window.removeEventListener("scroll", reposition, true);
});
</script>

<template>
  <div ref="root" class="date-picker" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <input v-bind="$attrs" type="text" inputmode="numeric" maxlength="10" placeholder="YYYY-MM-DD" :value="modelValue" :disabled="disabled" :aria-label="label" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" @keydown.alt.down.prevent="show" />
    <button ref="trigger" class="date-picker-trigger" type="button" :disabled="disabled" :aria-label="`${label} · ${t('open')}`" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="id" @click="show">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M7 3v4m10-4v4M4 11h16m-12 4h2m4 0h2"/></svg>
    </button>
    <Teleport :to="teleportTo || 'body'">
      <section v-if="open" :id="id" ref="panel" class="date-picker-panel" role="dialog" :aria-label="label" :style="position">
        <div class="date-picker-heading"><span>{{ label }}</span><button type="button" :aria-label="t('close')" @click="close()">×</button></div>
        <div class="date-picker-month">
          <button type="button" :aria-label="t('previousMonth')" @click="changeMonth(-1)">‹</button>
          <div class="date-picker-selects">
            <select :value="view.getFullYear()" :aria-label="t('year')" @change="changeView(Number(($event.target as HTMLSelectElement).value), view.getMonth())"><option v-for="year in years" :key="year" :value="year">{{ year }}{{ language === 'zh' ? '年' : '' }}</option></select>
            <select :value="view.getMonth()" :aria-label="t('month')" @change="changeView(view.getFullYear(), Number(($event.target as HTMLSelectElement).value))"><option v-for="(month, index) in months" :key="month" :value="index">{{ month }}</option></select>
          </div>
          <button type="button" :aria-label="t('nextMonth')" @click="changeMonth(1)">›</button>
        </div>
        <div class="date-picker-weekdays" aria-hidden="true"><span v-for="day in weekdays" :key="day">{{ day }}</span></div>
        <div class="date-picker-days" :aria-label="view.toLocaleDateString(locale, { year: 'numeric', month: 'long' })">
          <button v-for="day in days" :key="day.value" type="button" :data-date="day.value" :class="{ 'is-outside': day.outside, 'is-selected': day.value === modelValue, 'is-today': day.today }" :aria-label="day.label" :aria-pressed="day.value === modelValue" :aria-current="day.today ? 'date' : undefined" :tabindex="day.value === focused ? 0 : -1" @click="select(day.value)" @keydown="onDayKey($event, day.value)">{{ day.day }}</button>
        </div>
        <div class="date-picker-footer"><button type="button" @click="select('')">{{ t('clear') }}</button><button type="button" @click="select(iso(now()))">{{ t('today') }}</button></div>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.date-picker { position: relative; min-width: 0; width: 148px; }
.date-picker input { width: 100%; padding-right: 35px !important; font-variant-numeric: tabular-nums; }
.date-picker-trigger { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 30px; height: 34px; padding: 6px; border: 0; border-radius: 8px; background: transparent; color: light-dark(#546784, #b3c7e9); cursor: pointer; }
.date-picker-trigger svg { width: 18px; height: 18px; }
.date-picker-trigger:hover:not(:disabled), .is-open .date-picker-trigger { color: light-dark(#265dd9, #a0bfff); background: light-dark(#edf3ff, #253d62); }
.date-picker-panel { position: fixed; z-index: 1200; box-sizing: border-box; width: min(356px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow-y: auto; padding: 16px; border: 1px solid light-dark(#dae3f2, #3b506d); border-radius: 20px; background: light-dark(#fff, #1a2638); color: light-dark(#203550, #e2eaf6); box-shadow: 0 18px 56px rgb(25 50 90 / 19%); font-size: 13px; line-height: 1.4; font-family: inherit; }
.date-picker-panel button, .date-picker-panel select { font: inherit; color: inherit; cursor: pointer; }
.date-picker-panel button { display: grid; place-items: center; border: 0; background: transparent; border-radius: 9px; transition: background 160ms, color 160ms; }
.date-picker-panel button:hover { background: light-dark(#edf3ff, #293e5d); color: light-dark(#265dd9, #a0bfff); }
.date-picker-panel button:focus-visible, .date-picker-panel select:focus-visible, .date-picker-trigger:focus-visible { outline: 2px solid light-dark(#265dd9, #a0bfff); outline-offset: 2px; }
.date-picker-heading, .date-picker-month, .date-picker-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.date-picker-heading { padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid light-dark(#e7edf6, #35465e); color: light-dark(#63738b, #a5b4c8); font-size: 12px; }
.date-picker-heading button { width: 26px; height: 26px; font-size: 21px; }
.date-picker-month > button { width: 28px; height: 32px; flex-shrink: 0; font-size: 24px; }
.date-picker-selects { display: flex; justify-content: center; min-width: 0; gap: 3px; }
.date-picker-selects select { min-width: 0; max-width: 105px; padding: 5px 2px; border: 0; border-radius: 6px; background: light-dark(#fff, #1a2638); font-size: 13px; font-weight: 650; }
.date-picker-weekdays, .date-picker-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; }
.date-picker-weekdays { margin: 12px 0 6px; text-align: center; color: light-dark(#63738b, #a5b4c8); font-size: 11px; }
.date-picker-days button { position: relative; height: 40px; padding: 0; font-size: 12px; font-variant-numeric: tabular-nums; }
.date-picker-days .is-outside { color: light-dark(#63738b, #a5b4c8); }
.date-picker-days .is-today::after { position: absolute; bottom: 3px; width: 3px; height: 3px; border-radius: 50%; background: currentColor; content: ''; }
.date-picker-days .is-selected, .date-picker-days .is-selected:hover { background: #265dd9; color: #fff; font-weight: 700; }
.date-picker-footer { margin-top: 12px; padding-top: 10px; border-top: 1px solid light-dark(#e7edf6, #35465e); }
.date-picker-footer button { padding: 6px 10px; font-size: 12px; color: light-dark(#265dd9, #a0bfff); }
.is-disabled { opacity: .55; }
@media (prefers-reduced-motion: reduce) { .date-picker-panel button { transition: none; } }
</style>
