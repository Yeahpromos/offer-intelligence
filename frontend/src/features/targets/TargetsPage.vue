<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import { translateMessage, type UiLanguage } from "../../shared/i18n";
import {
  TARGET_METRICS,
  TARGET_TREND_VIEWS,
  dbMonthlySummaryForKey,
  monthKeyFromText,
  targetActualAvailable,
  targetDailyTrendRows,
  targetEditableRecord,
  targetGoal,
  targetMetricRows,
  targetMonthlyTrendRows,
  targetProgressDefinition,
  targetRowMetricValue,
  targetSummaryMetricValue,
  targetTextFromEditValue,
  targetTierSortRank,
  type TargetGoal,
  type TargetMetricKey,
  type TargetRecord,
  type TargetReportData,
  type TargetTrendRow
} from "./targetModel";
import {
  useTargets,
  type TargetStatusLoader,
  type TargetTierSummaryLoader
} from "./useTargets";

export interface TargetExportPayload {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly scope: string;
}

const props = withDefaults(defineProps<{
  language: UiLanguage;
  reportData?: TargetReportData;
  autoLoad?: boolean;
  today?: () => Date;
  loadStatus?: TargetStatusLoader;
  loadTierSummary?: TargetTierSummaryLoader;
  download?: (payload: TargetExportPayload) => void;
}>(), {
  autoLoad: true
});

const targets = useTargets({
  reportData: props.reportData,
  today: props.today,
  loadStatus: props.loadStatus,
  loadTierSummary: props.loadTierSummary
});

const pageRoot = ref<HTMLElement | null>(null);
const targetEditValue = ref("");
const activeTrendPoint = ref(-1);
const matrixSortKey = ref("Tier");
const matrixSortDirection = ref<"asc" | "desc">("asc");

const copy = computed(() => ({
  title: translateMessage(props.language, "targets.title", "Report Overview"),
  subtitle: translateMessage(props.language, "targets.subtitle", "Target and performance summary from the report sheet"),
  month: translateMessage(props.language, "targets.month", "Month"),
  compareMonth: translateMessage(props.language, "targets.compareMonth", "Compare with"),
  noComparison: translateMessage(props.language, "targets.noComparison", "No comparison"),
  allMonths: translateMessage(props.language, "targets.allMonths", "All months"),
  tier: translateMessage(props.language, "targets.tier", "Tier"),
  allTiers: translateMessage(props.language, "targets.allTiers", "All tiers"),
  revenue: translateMessage(props.language, "targets.revenue", "Revenue"),
  orders: translateMessage(props.language, "targets.orders", "Orders"),
  clicks: translateMessage(props.language, "targets.clicks", "Clicks"),
  conversion: translateMessage(props.language, "targets.conversion", "Avg Conversion"),
  brands: translateMessage(props.language, "targets.brands", "Active Brands"),
  gmvTarget: translateMessage(props.language, "targets.gmvTarget", "GMV target"),
  commissionTarget: translateMessage(props.language, "targets.commissionTarget", "Commission target"),
  removalTarget: translateMessage(props.language, "targets.removalTarget", "Merchant removal target"),
  monthlyReport: translateMessage(props.language, "targets.monthlyReport", "Monthly report"),
  dailyReport: translateMessage(props.language, "targets.dailyReport", "Daily report"),
  noTargetMatch: translateMessage(props.language, "targets.noTargetMatch", "No target data matched the selected filters."),
  targetUnavailable: translateMessage(props.language, "targets.targetUnavailable", "Target data is not available for this report."),
  tierComparison: translateMessage(props.language, "targets.tierComparison", "Tier comparison matrix"),
  tierComparisonHelp: translateMessage(props.language, "targets.tierComparisonHelp", "Metric comparison with target, entries and exits by tier"),
  tierTargetProgress: translateMessage(props.language, "targets.tierTargetProgress", "Tier target progress"),
  targetsByTier: translateMessage(props.language, "targets.targetsByTier", "Targets by tier"),
  activeTargets: translateMessage(props.language, "targets.activeTargets", "active targets"),
  target: translateMessage(props.language, "targets.target", "Target"),
  actual: translateMessage(props.language, "targets.actual", "Actual"),
  targetNeeded: translateMessage(props.language, "targets.targetNeeded", "Target needed"),
  awaitingData: translateMessage(props.language, "targets.awaitingData", "Awaiting data"),
  setTarget: translateMessage(props.language, "targets.setTarget", "Set target"),
  edit: translateMessage(props.language, "targets.edit", "Edit"),
  save: translateMessage(props.language, "targets.save", "Save"),
  cancel: translateMessage(props.language, "targets.cancel", "Cancel"),
  noTrend: translateMessage(props.language, "targets.noTrend", "No trend data is available for this selection."),
  loadingDaily: translateMessage(props.language, "targets.loadingDaily", "Loading daily trend data."),
  sourceDatabase: translateMessage(props.language, "targets.sourceDatabase", "Production database"),
  sourceFallback: translateMessage(props.language, "targets.sourceFallback", "Sheet fallback"),
  sourceSnapshot: translateMessage(props.language, "targets.sourceSnapshot", "Tier snapshot"),
  sourceLoading: translateMessage(props.language, "targets.sourceLoading", "Syncing database"),
  ordersSource: translateMessage(props.language, "targets.ordersSource", "Orders and revenue: cnpscy_order_new_aggregate"),
  clicksSource: translateMessage(props.language, "targets.clicksSource", "Clicks: cnpscy_amazon_click"),
  portfolio: translateMessage(props.language, "targets.portfolio", "Portfolio"),
  newEntries: translateMessage(props.language, "targets.newEntries", "New Entries"),
  exits: translateMessage(props.language, "targets.exits", "Exits"),
  vsTarget: translateMessage(props.language, "targets.vsTarget", "vs Target"),
  aboveTarget: translateMessage(props.language, "targets.aboveTarget", "above target"),
  toTarget: translateMessage(props.language, "targets.toTarget", "to target"),
  noBenchmark: translateMessage(props.language, "targets.noBenchmark", "No benchmark"),
  merchants: translateMessage(props.language, "targets.merchants", "merchants"),
  removed: translateMessage(props.language, "targets.removed", "removed"),
  export: translateMessage(props.language, "targets.export", "Export report"),
  exportHint: translateMessage(props.language, "targets.exportHint", "Download the current filtered target rows as an Excel workbook.")
}));

const hasReportData = computed(() => Boolean(props.reportData && Array.isArray(props.reportData.sheets) && props.reportData.sheets.length));

const headlineSummary = computed(() => {
  const databaseSummary = targets.tier.value === "all"
    ? dbMonthlySummaryForKey(monthKeyFromText(targets.month.value), targets.statusData.value)
    : null;
  return databaseSummary ? { ...targets.summary.value, ...databaseSummary } : targets.summary.value;
});

const kpis = computed(() => [
  { icon: "$", label: copy.value.revenue, value: compactMoney(targetSummaryMetricValue(headlineSummary.value, "revenue")), tone: "blue" },
  { icon: "#", label: copy.value.orders, value: compactNumber(targetSummaryMetricValue(headlineSummary.value, "orders")), tone: "green" },
  { icon: "C", label: copy.value.clicks, value: compactNumber(targetSummaryMetricValue(headlineSummary.value, "clicks")), tone: "amber" },
  { icon: "%", label: copy.value.conversion, value: formatPercent(targetSummaryMetricValue(headlineSummary.value, "conversion")), tone: "violet" },
  { icon: "B", label: copy.value.brands, value: compactNumber(targetSummaryMetricValue(headlineSummary.value, "brands")), tone: "slate" }
]);

interface ProgressCard {
  readonly key: string;
  readonly tier: string;
  readonly label: string;
  readonly record: TargetRecord | null;
  readonly goal: TargetGoal | null;
  readonly hasActual: boolean;
  readonly progress: number;
  readonly actualText: string;
  readonly targetText: string;
}

const progressCards = computed<ProgressCard[]>(() => {
  const rows = targetMetricRows(targets.filteredRecords.value);
  const definitions = ["Tier 1", "Tier 2", "Tier 3", "Tier 4"]
    .map(targetProgressDefinition)
    .filter((definition): definition is NonNullable<ReturnType<typeof targetProgressDefinition>> => Boolean(definition))
    .filter((definition) => targets.tier.value === "all" || definition.tier === targets.tier.value);

  return definitions.map((definition) => {
    const record = rows.find((row) => row.tier.toLowerCase() === definition.tier.toLowerCase()) || null;
    const editableRecord = targetEditableRecord(definition, record, targets.month.value);
    const goal = editableRecord ? targetGoal(editableRecord) : null;
    const hasActual = Boolean(editableRecord && goal && targetActualAvailable(editableRecord, goal));
    const progress = hasActual && goal && goal.target ? Math.max(0, Math.min(1, goal.actual / goal.target)) : 0;
    return {
      key: editableRecord?.targetOverrideKey || monthKeyFromText(targets.month.value) + "::" + definition.tier,
      tier: definition.tier,
      label: targetProgressLabel(definition.type),
      record: editableRecord,
      goal,
      hasActual,
      progress,
      actualText: goal && hasActual ? goalActualText(goal) : actualForPlaceholder(definition.type, editableRecord),
      targetText: goal ? goalTargetText(goal) : copy.value.targetNeeded
    };
  });
});

const targetCountLabel = computed(() => progressCards.value.filter((card) => card.goal && card.hasActual).length.toLocaleString() + " " + copy.value.activeTargets);

const trendRows = computed<TargetTrendRow[]>(() => {
  if (targets.trendView.value === "day") return targetDailyTrendRows(targets.statusData.value, targets.metric.value);
  return targetMonthlyTrendRows(targets.databaseRecords.value, {
    selectedMonth: targets.month.value,
    tier: targets.tier.value,
    metric: targets.metric.value,
    databaseRows: targets.monthlyTrendRows.value
  });
});

const trendMax = computed(() => Math.max(...trendRows.value.map((row) => Number(row.value)).filter((value) => Number.isFinite(value)), 1));
const trendPoints = computed(() => {
  const rows = trendRows.value;
  const width = 760;
  const height = 240;
  const pad = { left: 68, right: 24, top: 34, bottom: 42 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const step = rows.length > 1 ? innerWidth / (rows.length - 1) : innerWidth;
  return rows.map((row, index) => {
    const value = Number.isFinite(row.value) ? Number(row.value) : null;
    const x = pad.left + (rows.length <= 1 ? innerWidth / 2 : index * step);
    const y = value === null ? height - pad.bottom : pad.top + innerHeight - (value / trendMax.value) * innerHeight;
    return { ...row, index, x, y, value, hasValue: value !== null };
  });
});
const trendPath = computed(() => trendPoints.value.filter((point) => point.hasValue).map((point) => point.x.toFixed(2) + "," + point.y.toFixed(2)).join(" "));
const trendIsDaily = computed(() => targets.trendView.value === "day");
const selectedMetricLabel = computed(() => targets.metric.value === "revenue"
  ? copy.value.revenue
  : targets.metric.value === "orders"
    ? copy.value.orders
    : targets.metric.value === "clicks"
      ? copy.value.clicks
      : targets.metric.value === "conversion"
        ? copy.value.conversion
        : copy.value.brands);
const dailyBarWidth = computed(() => {
  const step = trendPoints.value.length > 1 ? 668 / (trendPoints.value.length - 1) : 20;
  return Math.max(5, Math.min(18, step * 0.58));
});
const trendEmptyMessage = computed(() => {
  if (targets.statusLoading.value && trendIsDaily.value) return copy.value.loadingDaily;
  if (targets.statusError.value && trendIsDaily.value) return targets.statusError.value;
  return copy.value.noTrend;
});

const matrixRows = computed(() => {
  const rows = targetMetricRows(targets.filteredRecords.value).slice();
  const comparison = new Map(targetMetricRows(targets.comparisonRecords.value).map((row) => [row.tier, row]));
  const multiplier = matrixSortDirection.value === "desc" ? -1 : 1;
  return rows.sort((left, right) => {
    const value = (row: TargetRecord): number | string => {
      if (matrixSortKey.value === "Tier") return targetTierSortRank(row.tier);
      if (matrixSortKey.value === "Active Brands") return row.brandCount;
      if (matrixSortKey.value === "Revenue") return row.revenue;
      if (matrixSortKey.value === "Orders") return row.orders;
      if (matrixSortKey.value === "Clicks") return row.clicks;
      if (matrixSortKey.value === "Avg Conversion") return row.conversionRate;
      if (matrixSortKey.value === "New Entries") return row.newEntries;
      if (matrixSortKey.value === "Exits") return row.exits;
      const previous = comparison.get(row.tier);
      return previous ? targetRowMetricValue(row, targets.metric.value) - targetRowMetricValue(previous, targets.metric.value) : "";
    };
    const leftValue = value(left);
    const rightValue = value(right);
    if (typeof leftValue === "string" || typeof rightValue === "string") return typeof leftValue === "string" ? 1 : -1;
    return (leftValue - rightValue) * multiplier;
  });
});

function compactNumber(value: number): string {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1_000_000) return (numeric / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M";
  if (Math.abs(numeric) >= 1_000) return (numeric / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "K";
  return numeric.toLocaleString();
}

function compactMoney(value: number): string {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) >= 1_000_000) return "$" + (numeric / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M";
  if (Math.abs(numeric) >= 1_000) return "$" + (numeric / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "K";
  return "$" + numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatPercent(value: number): string {
  return (Number(value) * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "%";
}

function actualForPlaceholder(type: "gmv" | "commission" | "removal", record: TargetRecord | null): string {
  if (!record) return copy.value.awaitingData;
  if (type === "gmv") return compactMoney(record.revenue);
  if (type === "commission") return record.payout === null ? copy.value.awaitingData : compactMoney(record.payout);
  return record.tierExitsAvailable ? record.exits.toLocaleString() + " " + copy.value.removed : copy.value.awaitingData;
}

function targetProgressLabel(type: "gmv" | "commission" | "removal"): string {
  if (type === "gmv") return copy.value.gmvTarget;
  if (type === "commission") return copy.value.commissionTarget;
  return copy.value.removalTarget;
}

function goalTargetText(goal: TargetGoal): string {
  if (goal.type === "removal") return goal.target.toLocaleString() + " " + copy.value.merchants;
  return goal.targetText;
}

function goalActualText(goal: TargetGoal): string {
  if (goal.type === "removal") return goal.actual.toLocaleString() + " " + copy.value.removed;
  return goal.actualText;
}

function sortLabel(key: string): string {
  const labels: Record<string, string> = {
    Tier: copy.value.tier,
    "Active Brands": copy.value.brands,
    Revenue: copy.value.revenue,
    Orders: copy.value.orders,
    Clicks: copy.value.clicks,
    "Avg Conversion": copy.value.conversion,
    "New Entries": copy.value.newEntries,
    Exits: copy.value.exits,
    "vs Target": copy.value.vsTarget
  };
  return labels[key] || key;
}

function setMatrixSort(key: string): void {
  if (matrixSortKey.value === key) matrixSortDirection.value = matrixSortDirection.value === "asc" ? "desc" : "asc";
  else {
    matrixSortKey.value = key;
    matrixSortDirection.value = "asc";
  }
}

function matrixDelta(record: TargetRecord): { text: string; tone: string } {
  const goal = targetGoal(record);
  if (goal && goal.target) {
    const delta = goal.actual - goal.target;
    return { text: (delta >= 0 ? "+ " : "- ") + Math.round((goal.actual / goal.target) * 100) + "% " + copy.value.vsTarget, tone: delta >= 0 ? "up" : "down" };
  }
  const previous = targets.comparisonRecords.value.find((row) => row.tier === record.tier);
  if (!previous || !targets.compareMonth.value) return { text: copy.value.noBenchmark, tone: "flat" };
  const current = targetRowMetricValue(record, targets.metric.value);
  const prior = targetRowMetricValue(previous, targets.metric.value);
  const diff = current - prior;
  if (Math.abs(diff) < 0.000001) return { text: "0 " + copy.value.vsTarget + " " + targets.compareMonth.value, tone: "flat" };
  const percent = prior ? Math.abs((diff / Math.abs(prior)) * 100).toFixed(1) + "%" : compactNumber(Math.abs(diff));
  return { text: (diff >= 0 ? "+ " : "- ") + percent + " " + copy.value.vsTarget + " " + targets.compareMonth.value, tone: diff >= 0 ? "up" : "down" };
}

function startEdit(card: ProgressCard): void {
  if (!card.record) return;
  targets.targetEditingKey.value = card.key;
  targetEditValue.value = card.goal?.targetText || "";
  void nextTick(() => pageRoot.value?.querySelector<HTMLInputElement>(".target-edit-form input")?.focus());
}

function submitTarget(card: ProgressCard): void {
  if (!card.record) return;
  const definition = targetProgressDefinition(card.tier);
  targets.setTarget(card.key, targetTextFromEditValue(card.record, targetEditValue.value, definition));
  targetEditValue.value = "";
}

function onMonthChange(event: Event): void {
  targets.setMonth((event.target as HTMLSelectElement).value);
}

function onCompareMonthChange(event: Event): void {
  targets.setCompareMonth((event.target as HTMLSelectElement).value);
}

function onTierChange(event: Event): void {
  targets.setTier((event.target as HTMLSelectElement).value);
}

function exportRows(): void {
  if (!props.download) return;
  props.download({
    scope: targets.month.value === "all" ? "all_months" : targets.month.value,
    rows: targets.filteredRecords.value.map((record) => ({
      "Month": record.month,
      "Tier": record.tier,
      "Brand Count": record.brandCount,
      "Total Clicks": record.clicks,
      "Order Count": record.orders,
      "Revenue": record.revenue,
      "Avg Conversion": record.conversionRate,
      "New Tier Entries": record.newEntries,
      "Tier Exits": record.exits,
      "Target": record.target
    }))
  });
}

function togglePoint(index: number): void {
  activeTrendPoint.value = activeTrendPoint.value === index ? -1 : index;
}

function showTrendLabel(index: number): boolean {
  return !trendIsDaily.value || index === 0 || index === trendPoints.value.length - 1 || index % Math.max(1, Math.ceil(trendPoints.value.length / 9)) === 0;
}

function formatTrendValue(value: number | null): string {
  return value === null ? "-" : translateTargetMetricValue(targets.metric.value, value);
}

function translateTargetMetricValue(metric: TargetMetricKey, value: number): string {
  if (metric === "revenue") return compactMoney(value);
  if (metric === "conversion") return formatPercent(value);
  return compactNumber(value);
}

function tooltipX(x: number): number {
  return Math.max(4, Math.min(600, x - 78));
}

function tooltipY(y: number): number {
  return y < 90 ? y + 12 : y - 60;
}

async function loadSelectedMonth(): Promise<void> {
  if (props.autoLoad === false) return;
  await Promise.all([targets.loadStatusForMonth(), targets.loadTierSummaryForMonth()]);
}

watch(() => targets.month.value, () => {
  void loadSelectedMonth();
});

onMounted(() => {
  void loadSelectedMonth();
  pageRoot.value?.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && targets.targetEditingKey.value) targets.cancelTargetEdit();
  });
});

onUnmounted(() => {
  targets.unmount();
});
</script>

<template>
  <div ref="pageRoot" class="sheet-page-modern" data-page="sheets">
    <section v-if="!hasReportData" class="target-report-card target-empty-state" role="status">
      <strong>{{ copy.targetUnavailable }}</strong>
    </section>
    <template v-else>
      <header class="tier-header sheet-page-header">
        <div>
          <h2>{{ copy.title }}</h2>
          <p>{{ copy.subtitle }}</p>
        </div>
        <button
          v-if="props.download"
          class="icon-button target-download-button"
          type="button"
          data-target-action="download"
          :disabled="!targets.filteredRecords.value.length"
          :title="copy.exportHint"
          @click="exportRows"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /></svg>
          {{ copy.export }}
        </button>
      </header>

      <section class="panel sheet-target-filters" aria-label="Target filters">
        <label>
          <span>{{ copy.month }}</span>
          <select data-target-action="month" :value="targets.month.value" @change="onMonthChange">
            <option value="all">{{ copy.allMonths }}</option>
            <option v-for="value in targets.availableMonths.value" :key="value" :value="value">{{ value }}</option>
          </select>
        </label>
        <label>
          <span>{{ copy.compareMonth }}</span>
          <select data-target-action="compare-month" :value="targets.compareMonth.value" @change="onCompareMonthChange">
            <option value="">{{ copy.noComparison }}</option>
            <option v-for="value in targets.availableMonths.value" :key="value" :value="value" :disabled="value === targets.month.value">{{ value }}</option>
          </select>
        </label>
        <label>
          <span>{{ copy.tier }}</span>
          <select data-target-action="tier" :value="targets.tier.value" @change="onTierChange">
            <option value="all">{{ copy.allTiers }}</option>
            <option v-for="value in targets.tierOptions.value" :key="value" :value="value">{{ value }}</option>
          </select>
        </label>
      </section>

      <section class="tier-summary">
        <article v-for="card in kpis" :key="card.label" class="target-kpi-card target-card-enter">
          <div class="target-kpi-icon" :class="card.tone">{{ card.icon }}</div>
          <div><span>{{ card.label }}</span><strong>{{ card.value }}</strong></div>
        </article>
      </section>

      <section class="sheet-target-notes">
        <section class="target-report-card target-trend-card target-card-enter">
          <div class="target-section-header">
            <div>
              <h3>{{ trendIsDaily ? copy.dailyReport : copy.monthlyReport }}</h3>
              <p>{{ targets.metric.value === "revenue" ? copy.revenue : targets.metric.value === "orders" ? copy.orders : targets.metric.value === "clicks" ? copy.clicks : targets.metric.value === "conversion" ? copy.conversion : copy.brands }}</p>
            </div>
            <div class="target-trend-controls">
              <div class="target-trend-view-tabs" aria-label="Trend view">
                <button v-for="view in TARGET_TREND_VIEWS" :key="view.key" class="target-trend-view-tab" :class="{ active: targets.trendView.value === view.key }" type="button" :data-target-trend-view="view.key" :aria-pressed="targets.trendView.value === view.key" @click="targets.setTrendView(view.key)">{{ view.key === "month" ? copy.monthlyReport : copy.dailyReport }}</button>
              </div>
              <div class="target-metric-tabs" aria-label="Trend metric">
                <button v-for="item in TARGET_METRICS" :key="item.key" class="target-metric-tab" :class="{ active: targets.metric.value === item.key }" type="button" :data-target-metric="item.key" :aria-pressed="targets.metric.value === item.key" @click="targets.setMetric(item.key)">{{ item.key === "revenue" ? copy.revenue : item.key === "orders" ? copy.orders : item.key === "clicks" ? copy.clicks : item.key === "conversion" ? copy.conversion : copy.brands }}</button>
              </div>
            </div>
          </div>
          <div class="target-trend-source">
            <span class="target-source-status" :class="targets.statusError.value ? 'fallback' : targets.statusLoading.value ? 'syncing' : targets.statusData.value ? 'fresh' : 'snapshot'"><i aria-hidden="true"></i>{{ targets.statusError.value ? copy.sourceFallback : targets.statusLoading.value ? copy.sourceLoading : targets.statusData.value ? copy.sourceDatabase : copy.sourceSnapshot }}</span>
            <span>{{ copy.ordersSource }}</span>
            <span>{{ copy.clicksSource }}</span>
          </div>
          <div class="target-trend-plot">
            <div v-if="!trendPoints.length" class="target-empty-state">{{ trendEmptyMessage }}</div>
            <svg v-else viewBox="0 0 760 240" role="img" :aria-label="(trendIsDaily ? copy.dailyReport : copy.monthlyReport) + ' ' + selectedMetricLabel">
              <g v-for="ratio in [0, 0.25, 0.5, 0.75, 1]" :key="ratio" class="trend-grid">
                <line x1="68" :y1="34 + (164 * (1 - ratio))" x2="736" :y2="34 + (164 * (1 - ratio))" />
                <text x="56" :y="38 + (164 * (1 - ratio))" text-anchor="end">{{ formatTrendValue(ratio * trendMax) }}</text>
              </g>
              <polyline v-if="!trendIsDaily && trendPath" :points="trendPath" class="trend-line" />
              <g v-for="point in trendPoints" :key="point.label + '-' + point.index" class="target-trend-point" :class="{ 'is-hovered': activeTrendPoint === point.index }" tabindex="0" role="img" :aria-label="point.detail" @click="togglePoint(point.index)" @keydown.enter="togglePoint(point.index)">
                <rect v-if="trendIsDaily" class="target-daily-bar" :class="{ muted: !point.hasValue, stale: point.state === 'stale', delay: point.state === 'delay' }" :x="point.x - dailyBarWidth" :y="point.hasValue ? point.y : 194" :width="dailyBarWidth * 2" :height="point.hasValue ? Math.max(4, 194 - point.y) : 4" rx="2.5" />
                <circle v-else class="trend-dot" :class="{ muted: !point.hasValue, selected: point.selected }" :cx="point.x" :cy="point.y" :r="point.selected ? 6 : 4.5" />
                <text v-if="point.hasValue && (point.selected || (trendIsDaily && point.index === trendPoints.length - 1))" class="trend-value-label" :x="point.x" :y="Math.max(18, point.y - 14)" text-anchor="middle">{{ formatTrendValue(point.value) }}</text>
                <text v-if="showTrendLabel(point.index)" class="trend-month" :x="point.x" y="228" text-anchor="middle">{{ point.shortLabel }}</text>
                <g class="target-trend-tooltip" :transform="'translate(' + tooltipX(point.x) + ' ' + tooltipY(point.y) + ')'" aria-hidden="true">
                  <rect width="156" height="48" rx="7" />
                  <text x="11" y="18" class="target-trend-tooltip-date">{{ point.label }}</text>
                  <text x="11" y="36" class="target-trend-tooltip-value">{{ point.hasValue ? formatTrendValue(point.value) : copy.awaitingData }}</text>
                </g>
              </g>
            </svg>
          </div>
        </section>

        <section class="target-progress-section target-card-enter">
          <div class="target-section-header">
            <div><h3>{{ copy.tierTargetProgress }}</h3><p>{{ targets.month.value || copy.allMonths }} {{ copy.targetsByTier }}</p></div>
            <span>{{ targetCountLabel }}</span>
          </div>
          <div class="target-progress-grid">
            <article v-for="card in progressCards" :key="card.key" class="target-progress-card target-card-enter">
              <div class="target-progress-card-head"><div><strong>{{ card.tier }}</strong><span>{{ card.label }}</span></div><span class="target-status-pill" :class="!card.goal ? 'placeholder' : card.hasActual ? (card.goal.actual >= card.goal.target ? 'met' : 'miss') : 'placeholder'">{{ card.goal && card.hasActual ? (card.progress * 100).toFixed(1) + '%' : copy.targetNeeded }}</span></div>
              <div class="target-progress-values">
                <div>
                  <span>{{ copy.target }}</span>
                  <template v-if="targets.targetEditingKey.value === card.key">
                    <form class="target-edit-form" @submit.prevent="submitTarget(card)">
                      <input v-model="targetEditValue" name="target" :aria-label="copy.target + ' ' + card.tier" />
                      <button type="submit">{{ copy.save }}</button>
                      <button type="button" @click="targets.cancelTargetEdit">{{ copy.cancel }}</button>
                    </form>
                  </template>
                  <template v-else>
                    <span class="target-value-line"><strong :class="{ 'target-placeholder-value': !card.goal }">{{ card.targetText }}</strong><button class="target-edit-button" :class="{ 'target-set-button': !card.goal }" data-target-action="edit-target" :data-target-key="card.key" type="button" @click="startEdit(card)">{{ card.goal ? copy.edit : copy.setTarget }}</button></span>
                  </template>
                </div>
                <div><span>{{ copy.actual }}</span><strong>{{ card.actualText }}</strong></div>
              </div>
              <div class="target-progress-bar" :class="{ placeholder: !card.goal || !card.hasActual }"><span :style="{ width: Math.min(100, Math.max(0, card.progress * 100)) + '%' }"></span></div>
              <p :class="card.hasActual ? (card.goal && card.goal.actual >= card.goal.target ? 'positive' : 'negative') : ''">{{ card.hasActual && card.goal ? (card.goal.actual >= card.goal.target ? '+ ' : '- ') + compactNumber(Math.abs(card.goal.actual - card.goal.target)) + ' ' + (card.goal.actual >= card.goal.target ? copy.aboveTarget : copy.toTarget) : copy.awaitingData }}</p>
            </article>
            <div v-if="!progressCards.length" class="target-empty-state">{{ copy.noTargetMatch }}</div>
          </div>
        </section>

        <section class="target-report-card target-matrix-card target-card-enter">
          <div class="target-section-header"><div><h3>{{ copy.tierComparison }}</h3><p>{{ copy.tierComparisonHelp }}</p></div></div>
          <div class="target-mobile-sort-controls" aria-label="Sort tier comparison matrix">
            <button v-for="key in ['Tier', 'Active Brands', 'Revenue', 'Orders', 'Clicks', 'Avg Conversion', 'New Entries', 'Exits', 'vs Target']" :key="key" class="table-sort-button" :class="{ active: matrixSortKey === key }" type="button" @click="setMatrixSort(key)">{{ sortLabel(key) }}</button>
          </div>
          <div class="table-wrap target-matrix-wrap" tabindex="0" role="region" :aria-label="copy.tierComparison">
            <table class="target-matrix-table" :aria-label="copy.tierComparison">
              <thead>
                <tr>
                  <th v-for="key in ['Tier', 'Active Brands', 'Revenue', 'Orders', 'Clicks', 'Avg Conversion', 'New Entries', 'Exits', 'vs Target']" :key="key" scope="col" :aria-sort="matrixSortKey === key ? (matrixSortDirection === 'asc' ? 'ascending' : 'descending') : 'none'">
                    <button class="table-sort-button" :class="{ active: matrixSortKey === key }" type="button" @click="setMatrixSort(key)">
                      <span>{{ sortLabel(key) }}</span>
                      <span class="sort-indicator" aria-hidden="true">{{ matrixSortKey === key ? (matrixSortDirection === 'asc' ? '↑' : '↓') : '↕' }}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in matrixRows" :key="row.monthKey + '-' + row.tier">
                  <td data-label="Tier"><span class="target-tier-label"><span class="tier-dot" :class="row.tier.toLowerCase().replace(/[^a-z0-9]+/g, '-')"></span><strong>{{ row.tier }}</strong></span></td>
                  <td data-label="Active Brands">{{ row.brandCount.toLocaleString() }}</td>
                  <td data-label="Revenue">{{ compactMoney(row.revenue) }}</td>
                  <td data-label="Orders">{{ row.orders.toLocaleString() }}</td>
                  <td data-label="Clicks">{{ row.clicks.toLocaleString() }}</td>
                  <td data-label="Avg Conversion">{{ formatPercent(row.conversionRate) }}</td>
                  <td data-label="New Entries">{{ row.newEntries.toLocaleString() }}</td>
                  <td data-label="Exits">{{ row.exits.toLocaleString() }}</td>
                  <td data-label="vs Target"><span class="target-matrix-delta" :class="matrixDelta(row).tone">{{ matrixDelta(row).text }}</span></td>
                </tr>
                <tr v-if="matrixRows.length" class="target-matrix-total">
                  <td data-label="Tier"><strong>{{ copy.portfolio }}</strong></td>
                  <td data-label="Active Brands">{{ targets.summary.value.brands.toLocaleString() }}</td>
                  <td data-label="Revenue">{{ compactMoney(targets.summary.value.revenue) }}</td>
                  <td data-label="Orders">{{ targets.summary.value.orders.toLocaleString() }}</td>
                  <td data-label="Clicks">{{ targets.summary.value.clicks.toLocaleString() }}</td>
                  <td data-label="Avg Conversion">{{ formatPercent(targets.summary.value.conversionRate) }}</td>
                  <td data-label="New Entries">{{ targets.summary.value.newEntries.toLocaleString() }}</td>
                  <td data-label="Exits">{{ targets.summary.value.exits.toLocaleString() }}</td>
                  <td data-label="vs Target"><span class="target-matrix-delta total">{{ copy.portfolio }}</span></td>
                </tr>
                <tr v-if="!matrixRows.length"><td colspan="9"><span class="target-empty-state">{{ copy.noTargetMatch }}</span></td></tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </template>
  </div>
</template>
