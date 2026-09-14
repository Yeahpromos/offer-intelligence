<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from "vue";
import type { OfferRecord, OfferTrackerExportPayload, UiLanguage } from "../../shared/contracts/offer";
import { exportNumberForFormat, worksheetRowBackgroundColor, type ExportColumn } from "../../shared/export/xlsx";
import { EXPORT_PRESETS, exportMerchantSummary, exportRowColor, limitExportMerchants, validExportRanges, offerTrackerExportSheets, type ExportPreset } from "./offerTrackerExport";

const props = defineProps<{ payload: OfferTrackerExportPayload; language: UiLanguage }>();
const emit = defineEmits<{ close: []; confirm: [payload: OfferTrackerExportPayload] }>();
const preset = ref<ExportPreset>("tier");
const page = ref(1);
const dialog = ref<HTMLElement | null>(null);
const text = (zh: string, en: string) => props.language === "zh" ? zh : en;
const names = computed(() => ({ tier: text("按 Tier 配色", "Tier colors"), blue: text("统一浅蓝", "Light blue"), none: text("无背景", "No background") }));
const summary = computed(() => exportMerchantSummary(props.payload.rows));
const quantities = ref<Record<string, number>>(Object.fromEntries(summary.value.tiers.map((item) => [item.tier, item.count])));
const ranges = ref<{ start: number; end: number; color: string }[]>([]);
const outputRows = computed(() => limitExportMerchants(props.payload.rows, quantities.value));
const outputSummary = computed(() => exportMerchantSummary(outputRows.value));
const rangesValid = computed(() => validExportRanges(ranges.value, outputRows.value.length));
const sheetIndex = ref(props.payload.view === "products" ? 1 : 0);
const sheets = computed(() => offerTrackerExportSheets({ ...props.payload, rows: outputRows.value, backgroundPreset: preset.value, backgroundRanges: rangesValid.value ? ranges.value : [] }));
const sheet = computed(() => sheets.value[sheetIndex.value]!);
const pages = computed(() => Math.max(1, Math.ceil(outputRows.value.length / 25)));
const visibleRows = computed(() => outputRows.value.slice((page.value - 1) * 25, page.value * 25));
watch(outputRows, () => { page.value = Math.min(page.value, pages.value); });
function addRange(): void {
  const start = ranges.value.reduce((last, range) => Math.max(last, range.end), 0) + 1;
  if (start <= outputRows.value.length) ranges.value.push({ start, end: outputRows.value.length, color: "#D6EEDD" });
}
function confirm(): void {
  if (!outputRows.value.length || !rangesValid.value) return;
  emit("confirm", { ...props.payload, rows: outputRows.value, backgroundPreset: preset.value, backgroundRanges: ranges.value.map((range) => ({ ...range })) });
}
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
const previousOverflow = document.body.style.overflow;
const columnNames: Readonly<Record<string, readonly [string, string]>> = {
  "Priority": ["优先级", "Priority"], "Merchant Name": ["商家名称", "Merchant Name"], "Merchant ID": ["商家 ID", "Merchant ID"],
  "Tier": ["分层", "Tier"], "AFF Commission": ["AFF 佣金", "AFF Commission"], "AOV": ["客单价", "AOV"],
  "Revenue": ["营收", "Revenue"], "AOV Type": ["AOV 类型", "AOV Type"], "BB Preference": ["是否介意 BB", "BB Preference"],
  "Category": ["品类", "Category"], "Recommendation": ["推荐信息", "Recommendation"], "Top Rank ASINs": ["营收优先 ASIN · 前 5 个", "Revenue-ranked ASINs · Top 5"]
};
function columnLabel(key: string): string {
  const labels = columnNames[key];
  return labels ? text(labels[0]!, labels[1]!) : key;
}

function cellValue(column: ExportColumn, row: OfferRecord, index: number): string {
  const value = column[1](row, (page.value - 1) * 25 + index, sheet.value);
  if (column[3] === "percentage") {
    const number = exportNumberForFormat(value, "percentage");
    return number === null ? String(value ?? "") : `${(number * 100).toFixed(2)}%`;
  }
  return String(value ?? "");
}

function keydown(event: KeyboardEvent): void {
  if (event.key === "Escape") { event.preventDefault(); emit("close"); return; }
  if (event.key !== "Tab") return;
  const elements = dialog.value?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']");
  const first = elements?.[0];
  const last = elements?.[elements.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault(); last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
onMounted(() => { document.body.style.overflow = "hidden"; dialog.value?.focus(); });
onBeforeUnmount(() => { document.body.style.overflow = previousOverflow; void nextTick(() => previousFocus?.focus()); });
</script>

<template>
  <Teleport to="body">
    <div class="offer-export-overlay" @click.self="emit('close')">
      <section ref="dialog" class="offer-export-dialog" role="dialog" aria-modal="true" aria-labelledby="offer-export-title" tabindex="-1" @keydown="keydown">
        <header>
          <div><h2 id="offer-export-title">{{ text('导出预览', 'Export preview') }}</h2>
            <p>{{ payload.selectedOnly ? text('已选择的 Offer', 'Selected offers') : text('当前筛选结果', 'Current filtered results') }} · {{ summary.total }} {{ text('个商家', 'merchants') }} · {{ payload.rows.length }} {{ text('行', 'rows') }}</p>
          </div>
          <button type="button" :aria-label="text('关闭预览', 'Close preview')" @click="emit('close')">×</button>
        </header>
        <div class="offer-export-content">
          <div class="offer-export-tier-counts" :aria-label="text('各 Tier 商家数量', 'Merchants per Tier')">
            <div v-for="item in summary.tiers" :key="item.tier"><span>{{ item.tier === 'Unassigned' ? text('未分层', 'Unassigned') : item.tier }}</span><strong>{{ item.count }}</strong>
              <label class="offer-export-quantity">{{ text('导出', 'Export') }}<input v-model.number="quantities[item.tier]" type="number" min="0" :max="item.count" step="1" :disabled="!item.count" :aria-label="`${item.tier} ${text('导出商家数', 'merchant export count')}`" /></label>
            </div>
          </div>
          <p aria-live="polite">{{ text('预计导出', 'Exporting') }} {{ outputSummary.total }} {{ text('个商家', 'merchants') }} · {{ outputRows.length }} {{ text('行。每层按当前排序取前 N 个商家；设为 0 可不导出该层。', 'rows. Take the first N merchants per Tier in the current order; set 0 to exclude a Tier.') }}</p>
          <fieldset><legend>{{ text('背景颜色预设', 'Background color presets') }}</legend>
            <label v-for="option in EXPORT_PRESETS" :key="option" :class="{ selected: preset === option }">
              <input v-model="preset" type="radio" name="offer-export-preset" :value="option" />
              <span class="offer-export-swatches" aria-hidden="true"><i v-for="tier in ['Tier 1', 'Tier 2', 'Tier 3', 'Tier 4']" :key="tier" :style="{ background: exportRowColor({ tier }, option) || '#fff' }" /></span>
              {{ names[option] }}
            </label>
          </fieldset>
          <details class="offer-export-custom"><summary>{{ text('自定义行背景色', 'Custom row backgrounds') }}</summary>
            <p>{{ text('数据行从 1 开始，不含表头；自定义颜色覆盖预设。', 'Data rows start at 1, excluding the header. Custom colors override the preset.') }}</p>
            <div v-for="(range, index) in ranges" :key="index" class="offer-export-range">
              <label>{{ text('起始行', 'Start row') }}<input v-model.number="range.start" type="number" min="1" :max="outputRows.length" /></label>
              <label>{{ text('结束行', 'End row') }}<input v-model.number="range.end" type="number" min="1" :max="outputRows.length" /></label>
              <label>{{ text('背景色', 'Color') }}<input v-model="range.color" type="color" /></label>
              <button type="button" :aria-label="`${text('移除高亮区间', 'Remove highlight range')} ${index + 1}`" @click="ranges.splice(index, 1)">×</button>
            </div>
            <button type="button" :disabled="!outputRows.length || ranges.some(range => range.end >= outputRows.length)" @click="addRange">{{ text('添加高亮区间', 'Add highlight range') }}</button>
          </details>
          <p v-if="!rangesValid" role="alert" class="offer-export-error">{{ text('请检查高亮区间：行号必须在导出范围内，起始行不能大于结束行，区间不能重叠。', 'Highlight ranges must be within the output rows, in ascending order, and must not overlap.') }}</p>
          <p>{{ text('一个 Excel 包含 Offer 清单和品牌产品清单，按列设置导出。ASIN 仅保留营收优先排序的前 5 个。背景颜色在两个工作表中一致；每页预览 25 行，下载包含全部预览行。', 'One Excel file contains both the offer list and brand product list, using your column settings. ASINs are limited to the revenue-ranked top 5. Both sheets retain the same backgrounds; the preview shows 25 rows per page and the download includes every row.') }}</p>
          <div class="offer-export-sheets" :aria-label="text('工作表预览', 'Worksheet preview')">
            <button v-for="(item, index) in sheets" :key="item.sheetName" type="button" :aria-pressed="sheetIndex === index" @click="sheetIndex = index">{{ index === 0 ? text('Offer 清单', 'Offer list') : text('品牌产品清单', 'Brand product list') }}</button>
          </div>
          <div class="offer-export-table" tabindex="0" :aria-label="text('导出数据预览，可横向滚动', 'Export data preview, scroll horizontally')">
            <table><thead><tr><th v-for="column in sheet.columns" :key="column[0]" scope="col" :title="column[0]">{{ columnLabel(column[0]) }}</th></tr></thead>
              <tbody><tr v-for="(row, index) in visibleRows" :key="index" :style="{ background: worksheetRowBackgroundColor((page - 1) * 25 + index + 1, sheet.rowBackgroundRanges) || '#fff' }"><td v-for="column in sheet.columns" :key="column[0]">{{ cellValue(column, row, index) }}</td></tr></tbody>
            </table>
          </div>
          <nav :aria-label="text('预览分页', 'Preview pagination')"><button :disabled="page <= 1" @click="page--">{{ text('上一页', 'Previous') }}</button><span aria-live="polite">{{ page }} / {{ pages }}</span><button :disabled="page >= pages" @click="page++">{{ text('下一页', 'Next') }}</button></nav>
        </div>
        <footer><button type="button" @click="emit('close')">{{ text('取消', 'Cancel') }}</button><button type="button" class="offer-export-confirm" :disabled="!outputRows.length || !rangesValid" @click="confirm">{{ text('确认导出 Excel', 'Confirm Excel export') }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.offer-export-overlay { position: fixed; inset: 0; z-index: 1200; background: #0f234a80; display: grid; place-items: center; padding: 24px; }
.offer-export-dialog { width: min(1200px, 100%); max-height: calc(100dvh - 48px); display: flex; flex-direction: column; background: #fff; color: #1e3557; border: 1px solid #cfddf5; border-radius: 20px; box-shadow: 0 24px 80px #10254c40; overflow: hidden; }
header, footer { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 24px; flex-shrink: 0; }
header { border-bottom: 1px solid #d8e3f5; } h2 { margin: 0; font-size: 22px; } p { font-size: 13px; line-height: 1.6; margin: 8px 0; color: #526786; }
.offer-export-content { padding: 20px 24px; overflow: auto; }
.offer-export-sheets { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.offer-export-sheets button[aria-pressed="true"] { color: #1d4ed8; background: #eff6ff; border-color: #2563eb; }
.offer-export-tier-counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
.offer-export-tier-counts > div { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; background: #f2f6ff; border: 1px solid #d8e3f5; border-radius: 10px; padding: 14px; font-size: 13px; }
.offer-export-tier-counts .offer-export-quantity { grid-column: 1 / -1; width: auto; min-width: 0; border: 0; padding: 0; justify-content: space-between; }
.offer-export-quantity input { width: 65px; min-width: 0; }
input[type="number"] { border: 1px solid #b9cbea; border-radius: 6px; padding: 8px; color: #1e3557; background: white; }
.offer-export-custom { margin: 16px 0; } summary { cursor: pointer; font-weight: 600; padding: 10px 0; }
.offer-export-range { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; align-items: center; }
.offer-export-range label { min-width: 0; padding: 8px; } .offer-export-range input[type="number"] { width: 70px; }
p.offer-export-error { color: #b42318; }
strong { font-size: 22px; color: #2458d6; }
fieldset { display: flex; flex-wrap: wrap; gap: 12px; border: 0; padding: 0; margin: 20px 0 12px; } legend { font-weight: 700; margin-bottom: 10px; }
label { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 12px; border: 1px solid #cbd9ef; border-radius: 10px; font-size: 14px; white-space: nowrap; min-width: 180px; } label.selected { border-color: #2563eb; background: #eff6ff; } input { accent-color: #2563eb; }
.offer-export-swatches { display: flex; gap: 2px; } i { width: 14px; height: 20px; border: 1px solid #cbd5e1; border-radius: 3px; }
.offer-export-table { overflow: auto; max-height: 350px; border: 1px solid #cbd9ef; border-radius: 10px; } table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; } th, td { padding: 12px 14px; min-width: 120px; max-width: 320px; overflow-wrap: anywhere; border-bottom: 1px solid #cbd9ef; text-align: left; } th { position: sticky; top: 0; background: #eff4ff; color: #1e3557; z-index: 1; }
nav { display: flex; justify-content: flex-end; align-items: center; gap: 14px; margin-top: 12px; } footer { justify-content: flex-end; border-top: 1px solid #d8e3f5; }
button { border: 1px solid #b9cbea; border-radius: 8px; padding: 10px 16px; min-height: 40px; background: #fff; color: #24436d; cursor: pointer; font: inherit; } button:disabled { opacity: .45; cursor: default; } button.offer-export-confirm { background: #2458d6; border-color: #2458d6; color: #fff; }
button:focus-visible, input:focus-visible, [tabindex]:focus-visible { outline: 3px solid #3b82f6; outline-offset: 3px; }
@media (max-width: 600px) { .offer-export-overlay { padding: 8px; } .offer-export-dialog { max-height: calc(100dvh - 16px); } header, footer, .offer-export-content { padding: 16px; } label { flex: 1; } }
</style>
