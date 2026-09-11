<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import PromotionRelations from "./PromotionRelations.vue";
import PromotionImport from "./PromotionImport.vue";
import PromotionListPicker from "./PromotionListPicker.vue";
import {
  categoryStyle,
  LINK_KINDS,
  linkKind,
  linkLabel,
  type LinkKind,
  ASIN_SCOPES,
  asinScope,
  asinScopeLabel,
  type AsinScope,
} from "./promotionAppearance";
import DatePicker from "../../shared/components/DatePicker.vue";
import type { UiLanguage } from "../../shared/i18n";
import { loadCatalog, loadReport } from "./performanceApi";
import {
  METRICS,
  change,
  emptyMetrics,
  monthlyBaseline,
  observedDays,
  observationWindow,
  sumMetrics,
  windowDates,
  restoreBatches,
  upsertTrackedMerchant,
} from "./performanceModel";
import type {
  Metric,
  MediaRow,
  PerformanceReport,
  PromotionBatch,
  ReportRequest,
} from "./performanceModel";

const props = defineProps<{
  language: UiLanguage;
  catalogLoader?: typeof loadCatalog;
  reportLoader?: typeof loadReport;
  readFile?: (file: File) => Promise<unknown[][][]>;
  download?: (rows: Record<string, unknown>[]) => void;
}>();
const t = (zh: string, en: string) => (props.language === "zh" ? zh : en);
const labels: Record<Metric, [string, string]> = {
  revenue: ["营收", "Revenue"],
  clicks: ["点击量", "Clicks"],
  dpv: ["详情页浏览", "Detail views"],
  atc: ["加购量", "Add to cart"],
  orders: ["订单数", "Orders"],
  commission: ["总佣金", "Commission"],
};
const label = (key: Metric) => t(...labels[key]);
const batches = ref<PromotionBatch[]>([]),
  batchId = ref("");
const launch = ref("2026-09-07"),
  start = ref(""),
  end = ref("");
const report = ref<PerformanceReport | null>(null),
  detail = ref<PerformanceReport | null>(null);
const loading = ref(false),
  detailLoading = ref(false),
  error = ref(""),
  detailError = ref(""),
  catalogError = ref(false);
const search = ref(""),
  category = ref("all"),
  selectedId = ref(""),
  metric = ref<Metric>("revenue"),
  mediaSearch = ref("");
const importOpen = ref(false),
  importNotice = ref("");
const targetFilter = ref<LinkKind | "all">("all");
const targetScope = ref<AsinScope | "all">("all");
const mediaLimit = ref(100),
  linkLimit = ref(100);
const manualOpen = ref(false),
  manualId = ref(""),
  manualName = ref(""),
  manualMode = ref("current"),
  manualDate = ref(""),
  manualError = ref(""),
  manualNotice = ref("");
const relations = ref<PerformanceReport | null>(null),
  relationsLoading = ref(false),
  relationsError = ref(false);
let relationId = 0,
  relationController: AbortController | undefined;
const batch = computed(() => batches.value.find((b) => b.id === batchId.value));
const draftWindow = computed(() =>
  start.value && end.value
    ? windowDates(launch.value, start.value, end.value)
    : null,
);
const range = computed(() => report.value?.dateRange || draftWindow.value);
const asOf = computed(() => report.value?.availableThrough || "");
const daysAfter = computed(() =>
  range.value && asOf.value
    ? observedDays(range.value.startDate, range.value.endDate, asOf.value)
    : 0,
);
const daysBefore = computed(() =>
  range.value && asOf.value
    ? observedDays(range.value.beforeStart, range.value.beforeEnd, asOf.value)
    : 0,
);
const complete = computed(() =>
  Boolean(
    report.value &&
    range.value &&
    daysAfter.value === range.value.days &&
    daysBefore.value === range.value.days,
  ),
);
const categories = computed(() =>
  [
    ...new Set(batch.value?.offers.map((o) => o.category).filter(Boolean)),
  ].sort(),
);
const rows = computed(() =>
  (batch.value?.offers || [])
    .map((offer) => {
      const stats = report.value?.merchants.find(
        (m) => m.merchantId === offer.merchantId,
      );
      return {
        ...offer,
        stats,
        before: stats?.before || emptyMetrics(),
        after: stats?.after || emptyMetrics(),
        baseline: monthlyBaseline(stats, asOf.value),
      };
    })
    .filter(
      (o) =>
        (category.value === "all" || o.category === category.value) &&
        `${o.merchantName} ${o.merchantId} ${o.asins.join(" ")}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    )
    .sort(
      (a, b) => (b.after[metric.value] || 0) - (a.after[metric.value] || 0),
    ),
);
const selected = computed(() =>
  batch.value?.offers.find((o) => o.merchantId === selectedId.value),
);
const selectedStats = computed(() =>
  report.value?.merchants.find((o) => o.merchantId === selectedId.value),
);
const scopeForSelected = (row: MediaRow) => asinScope(row, selected.value);
const baseline = computed(() =>
  monthlyBaseline(selectedStats.value, asOf.value),
);
const totals = computed(() => ({
  before: sumMetrics(rows.value.map((r) => r.before)),
  after: sumMetrics(rows.value.map((r) => r.after)),
}));
const categoryRows = computed(() =>
  categories.value
    .map((name) => ({
      name,
      value: rows.value
        .filter((o) => o.category === name)
        .reduce((s, r) => s + (r.after.revenue || 0), 0),
    }))
    .sort((a, b) => b.value - a.value),
);
const activeCount = computed(
  () =>
    rows.value.filter((r) => METRICS.some((k) => (r.after[k] || 0) > 0)).length,
);
const media = computed(() =>
  (detail.value?.media || [])
    .filter((m) =>
      `${m.publisherName} ${m.publisherId}`
        .toLowerCase()
        .includes(mediaSearch.value.toLowerCase()),
    )
    .sort((a, b) => (b.after.revenue || 0) - (a.after.revenue || 0)),
);
const searchedLinks = computed(() =>
  (detail.value?.links || [])
    .filter((m) =>
      `${m.publisherName} ${m.publisherId} ${m.asin} ${m.purchasedAsin}`
        .toLowerCase()
        .includes(mediaSearch.value.toLowerCase()),
    )
    .sort((a, b) => (b.after.clicks || 0) - (a.after.clicks || 0)),
);
const links = computed(() =>
  searchedLinks.value.filter(
    (row) =>
      (targetFilter.value === "all" || linkKind(row) === targetFilter.value) &&
      (targetScope.value === "all" ||
        scopeForSelected(row) === targetScope.value),
  ),
);
function format(
  value: number | null | undefined,
  key: Metric = metric.value,
  compact = false,
) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(props.language === "zh" ? "zh-CN" : "en-US", {
    style: key === "revenue" || key === "commission" ? "currency" : "decimal",
    currency: "USD",
    maximumFractionDigits: compact
      ? 1
      : key === "revenue" || key === "commission"
        ? 2
        : 0,
    notation: compact ? "compact" : "standard",
  }).format(value);
}
function delta(before: number | null, after: number | null) {
  const ratio = change(before, after, complete.value);
  if (!report.value) return "—";
  if (!complete.value) return t("自定观察期未结束", "Observation in progress");
  if (ratio === null)
    return before === 0 && (after || 0) > 0
      ? t("新产生数据", "New activity")
      : "—";
  return `${ratio > 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`;
}
const storeKey = "oi-promotion-batches-v1";
let disposed = false;
let returnFocus: HTMLElement | null = null;
let requestId = 0,
  detailId = 0,
  controller: AbortController | undefined,
  detailController: AbortController | undefined;
let appliedRequest: ReportRequest | null = null;
function persist() {
  try {
    localStorage.setItem(storeKey, JSON.stringify(batches.value));
    localStorage.setItem("oi-promotion-selected-list-v1", batchId.value);
  } catch {
    /* Current session still works. */
  }
}
async function initialize() {
  catalogError.value = false;
  try {
    const result = await (props.catalogLoader ?? loadCatalog)();
    if (disposed) return;
    let saved: unknown = [];
    let selectedList = "";
    try {
      saved = JSON.parse(localStorage.getItem(storeKey) || "[]");
      selectedList =
        localStorage.getItem("oi-promotion-selected-list-v1") || "";
    } catch {
      /* A corrupt saved list does not prevent catalog startup. */
    }
    batches.value = restoreBatches(result.batches, saved);
    batchId.value = batches.value.some((b) => b.id === selectedList)
      ? selectedList
      : batches.value[0]?.id || "";
    await selectBatch();
  } catch {
    catalogError.value = true;
  }
}
async function chooseBatch(id: string) {
  batchId.value = id;
  await selectBatch();
}
async function selectBatch() {
  if (!batch.value) return;
  launch.value = batch.value.launchDate;
  category.value = "all";
  search.value = "";
  const dates = observationWindow(batch.value);
  start.value = dates?.startDate || "";
  end.value = dates?.endDate || "";
  await apply();
}
async function apply() {
  if (!batch.value || !draftWindow.value || !windowDates(launch.value)) {
    error.value = "date";
    return;
  }
  controller?.abort();
  detailController?.abort();
  relationController?.abort();
  relationId++;
  relations.value = null;
  relationsError.value = false;
  relationsLoading.value = false;
  detailId++;
  selectedId.value = "";
  detail.value = null;
  const id = ++requestId;
  controller = new AbortController();
  loading.value = true;
  error.value = "";
  report.value = null;
  appliedRequest = {
    batchId: batch.value.id,
    merchantIds: batch.value.offers.map((o) => o.merchantId).join(","),
    launchDate: launch.value,
    startDate: start.value,
    endDate: end.value,
  };
  batch.value.launchDate = launch.value;
  batch.value.observationStart = start.value;
  batch.value.observationEnd = end.value;
  persist();
  try {
    const result = await (props.reportLoader ?? loadReport)(
      appliedRequest,
      controller.signal,
    );
    if (id === requestId) {
      report.value = result;
      void refreshRelations();
    }
  } catch {
    if (id === requestId) error.value = "load";
  } finally {
    if (id === requestId) loading.value = false;
  }
}
async function refreshRelations(merchantId = "") {
  if (!appliedRequest || !report.value) return;
  if (
    merchantId &&
    !batch.value?.offers.some((o) => o.merchantId === merchantId)
  )
    return;
  relationController?.abort();
  relationController = new AbortController();
  const revision = ++relationId;
  relationsLoading.value = true;
  relationsError.value = false;
  relations.value = null;
  try {
    const result = await (props.reportLoader ?? loadReport)(
      {
        ...appliedRequest,
        action: "relations",
        ...(merchantId ? { merchantId } : {}),
      },
      relationController.signal,
    );
    if (!Array.isArray(result.media) || !Array.isArray(result.links))
      throw new Error("RELATION_DATA");
    if (revision === relationId) relations.value = result;
  } catch {
    if (revision === relationId) relationsError.value = true;
  } finally {
    if (revision === relationId) relationsLoading.value = false;
  }
}
async function openManual() {
  manualId.value = "";
  manualName.value = "";
  manualError.value = "";
  manualNotice.value = "";
  manualMode.value = batch.value ? "current" : "separate";
  manualDate.value = launch.value;
  manualOpen.value = true;
  await nextTick();
  document.getElementById("promotion-new-merchant-id")?.focus();
}
async function closeManual() {
  manualOpen.value = false;
  await nextTick();
  document.getElementById("promotion-add-merchant")?.focus();
}
async function saveManual() {
  manualError.value = "";
  try {
    const separate = manualMode.value === "separate" || !batch.value;
    if (!windowDates(separate ? manualDate.value : launch.value))
      throw new Error("DATE");
    const result = upsertTrackedMerchant(
      separate ? [] : batch.value!.offers,
      manualId.value,
      manualName.value,
    );
    if (separate) {
      const item: PromotionBatch = {
        id: `manual-${Date.now()}`,
        name: manualName.value.trim(),
        sourceFile: "",
        launchDate: manualDate.value,
        offers: result.offers,
        local: true,
      };
      batches.value.push(item);
      batchId.value = item.id;
    } else {
      batch.value!.offers = result.offers;
      batch.value!.customized = true;
    }
    manualNotice.value = result.added
      ? t(
          "已添加商家，追踪清单已保存在当前浏览器。",
          "Merchant added. The tracking list is saved in this browser.",
        )
      : t(
          "该 ID 已在追踪中，商家名称已更新。",
          "This ID is already tracked; its name has been updated.",
        );
    manualOpen.value = false;
    search.value = "";
    category.value = "all";
    persist();
    if (separate) await selectBatch();
    else await apply();
    await nextTick();
    document.getElementById("promotion-add-merchant")?.focus();
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    manualError.value =
      code === "MERCHANT_ID"
        ? t(
            "请输入有效的数字商家 ID（最多 13 位）。",
            "Enter a valid numeric Merchant ID, up to 13 digits.",
          )
        : code === "MERCHANT_NAME"
          ? t(
              "请输入商家名称（最多 160 字）。",
              "Enter a merchant name, up to 160 characters.",
            )
          : code === "DATE"
            ? t("请选择有效的推送日期。", "Choose a valid launch date.")
            : t(
                "每份清单最多追踪 200 个商家。",
                "Each list supports up to 200 merchants.",
              );
  }
}
function closeDetail() {
  detailId++;
  detailController?.abort();
  selectedId.value = "";
  detail.value = null;
  returnFocus?.focus();
}
async function selectMerchant(id: string) {
  if (!report.value || !appliedRequest) return;
  mediaLimit.value = 100;
  linkLimit.value = 100;
  targetFilter.value = "all";
  targetScope.value = "all";
  if (!selectedId.value) returnFocus = document.activeElement as HTMLElement;
  detailController?.abort();
  detailController = new AbortController();
  const revision = ++detailId;
  selectedId.value = id;
  detail.value = null;
  detailError.value = "";
  detailLoading.value = true;
  mediaSearch.value = "";
  await nextTick();
  document.getElementById("promotion-detail")?.focus();
  try {
    const result = await (props.reportLoader ?? loadReport)(
      { ...appliedRequest, merchantId: id },
      detailController.signal,
    );
    if (revision === detailId) detail.value = result;
  } catch {
    if (revision === detailId) detailError.value = "load";
  } finally {
    if (revision === detailId) detailLoading.value = false;
  }
}
async function confirmImport(item: PromotionBatch) {
  batches.value.push(item);
  importOpen.value = false;
  importNotice.value = t(
    `已导入「${item.name}」：${item.offers.length} 个商家。请在下方追踪清单中选择。`,
    `Imported “${item.name}”: ${item.offers.length} merchants. Select the tracking list below.`,
  );
  persist();
  if (!batch.value) {
    batchId.value = item.id;
    await selectBatch();
  }
  await nextTick();
  document.getElementById("promotion-list-selector")?.focus();
}
function exportRows() {
  props.download?.(
    rows.value.map((r) => ({
      MerchantID: r.merchantId,
      Merchant: r.merchantName,
      Category: r.category,
      LaunchDate: appliedRequest?.launchDate,
      BeforeStart: range.value?.beforeStart,
      BeforeEnd: range.value?.beforeEnd,
      AfterStart: range.value?.startDate,
      AfterEnd: range.value?.endDate,
      AvailableThrough: asOf.value,
      ...Object.fromEntries(
        METRICS.flatMap((k) => [
          [`Before_${k}`, r.before[k]],
          [`After_${k}`, r.after[k]],
        ]),
      ),
      MonthlyAverageRevenue: r.baseline.average,
      MonthlyPeakRevenue: r.baseline.peak,
      RecommendedASINs: r.asins.join(", "),
    })),
  );
}
onMounted(initialize);
onBeforeUnmount(() => {
  disposed = true;
  relationId++;
  relationController?.abort();
  requestId++;
  detailId++;
  controller?.abort();
  detailController?.abort();
});
</script>

<template>
  <section
    class="promotion-page"
    :aria-label="t('Offer 推广追踪', 'Offer promotion tracking')"
  >
    <header class="promotion-header">
      <div>
        <span class="promotion-eyebrow">{{
          t("产品与 Offer / 推广复盘", "Products & offers / Campaign review")
        }}</span>
        <h2>{{ t("Offer 推广追踪", "Offer promotion tracking") }}</h2>
        <p>
          {{
            t(
              "从推出清单到实际表现，看清谁在推、推什么、带来了多少。",
              "From your offer list to observed activity: who promoted, which targets, and how much.",
            )
          }}
        </p>
      </div>
      <div class="promotion-header-actions">
        <button
          id="promotion-add-merchant"
          type="button"
          class="primary"
          :aria-expanded="manualOpen"
          @click="openManual"
        >
          {{ t("添加商家", "Add merchant") }}</button
        ><button
          v-if="readFile"
          type="button"
          @click="importOpen = !importOpen"
          :aria-expanded="importOpen"
        >
          ＋ {{ t("导入商家清单", "Import merchants") }}
        </button>
      </div>
    </header>
    <form
      v-if="manualOpen"
      class="promotion-panel promotion-manual"
      :aria-label="t('添加追踪商家', 'Add a tracked merchant')"
      @submit.prevent="saveManual"
    >
      <div class="promotion-section-heading">
        <div>
          <h3>{{ t("添加商家追踪", "Track a merchant") }}</h3>
          <p>
            {{
              t(
                "填写商家 ID 和名称即可，单品与媒体关系从报表读取。相同 ID 会更新名称，不会重复添加。",
                "Only Merchant ID and name are required. Product and publisher relationships come from reports. An existing ID updates its name without duplication.",
              )
            }}
          </p>
        </div>
        <button type="button" @click="closeManual">
          {{ t("取消", "Cancel") }}
        </button>
      </div>
      <div class="promotion-manual-fields">
        <label
          >{{ t("商家 ID", "Merchant ID")
          }}<input
            id="promotion-new-merchant-id"
            v-model="manualId"
            inputmode="numeric"
            autocomplete="off"
            maxlength="13"
            required /></label
        ><label
          >{{ t("商家名称", "Merchant name")
          }}<input v-model="manualName" maxlength="160" required /></label
        ><label
          >{{ t("追踪方式", "Tracking list")
          }}<select v-model="manualMode">
            <option v-if="batch" value="current">
              {{ t("加入当前清单", "Add to current list") }} · {{ batch.name }}
            </option>
            <option value="separate">
              {{ t("单独建立追踪清单", "Track separately") }}
            </option>
          </select></label
        ><label v-if="manualMode === 'separate' || !batch"
          >{{ t("推送日期", "Launch date")
          }}<DatePicker
            v-model="manualDate"
            :language="language"
            :label="t('新增商家推送日期', 'New merchant launch date')"
        /></label>
      </div>
      <p v-if="manualMode === 'current' && batch">
        {{ t("沿用当前清单的推送日期", "Use this list’s launch date") }} ·
        {{ launch }}
      </p>
      <p v-if="manualError" role="alert">{{ manualError }}</p>
      <button type="submit" class="primary" :disabled="loading">
        {{ t("添加并追踪", "Add and track") }}
      </button>
    </form>
    <p v-if="manualNotice" class="promotion-message" role="status">
      {{ manualNotice }}
    </p>
    <div v-if="catalogError" class="promotion-message error" role="alert">
      {{ t("批次清单加载失败。", "Could not load batches.") }}
      <button type="button" @click="initialize">
        {{ t("重试", "Retry") }}
      </button>
    </div>
    <PromotionImport
      v-if="importOpen && readFile"
      :language="language"
      :default-date="batch?.launchDate || launch"
      :read-file="readFile"
      @confirm="confirmImport"
    />
    <p v-if="importNotice" role="status" class="promotion-message">
      {{ importNotice }}
    </p>
    <section
      v-if="batch"
      class="promotion-panel promotion-filters"
      :aria-label="t('批次与时间', 'Batch and dates')"
    >
      <div class="promotion-batch">
        <PromotionListPicker
          :model-value="batchId"
          :batches="batches"
          :language="language"
          @update:model-value="chooseBatch"
        />
        <p>
          {{ batch.offers.length }} {{ t("个商家", "merchants") }} ·
          {{ batch.offers.reduce((sum, o) => sum + o.asins.length, 0) }} ASIN
          <span v-if="batch.local"> · {{ t("本机批次", "Local batch") }}</span>
        </p>
        <small
          >{{ batch.sourceFile || t("手动添加", "Manually added")
          }}<span v-if="batch.customized">
            · {{ t("已在本机调整商家", "Merchants edited locally") }}</span
          ></small
        >
      </div>
      <div class="promotion-date-controls">
        <div class="promotion-date-heading">
          <strong>{{ t("自定观察期", "Custom observation period") }}</strong>
          <small>{{
            t(
              "选择起止日期，比较期自动取此前等长区间。",
              "Choose dates; compare with the preceding period of equal length.",
            )
          }}</small>
        </div>
        <div class="promotion-dates">
          <label
            >{{ t("开始日期", "Start date")
            }}<DatePicker
              v-model="start"
              :language="language"
              :label="t('观察开始', 'Observation start')"
          /></label>
          <span class="promotion-date-divider" aria-hidden="true">—</span>
          <label
            >{{ t("结束日期", "End date")
            }}<DatePicker
              v-model="end"
              :language="language"
              :label="t('观察结束', 'Observation end')"
          /></label>
          <button
            type="button"
            class="primary"
            :disabled="loading"
            @click="apply"
          >
            {{
              loading ? t("加载中…", "Loading…") : t("应用时间", "Apply dates")
            }}
          </button>
        </div>
        <div class="promotion-launch-date">
          <label
            >{{ t("推送日期", "Launch date")
            }}<DatePicker
              v-model="launch"
              :language="language"
              :label="t('推送日期', 'Launch date')"
          /></label>
          <small>{{
            t(
              "用于记录推送时间，修改它不会改变自定观察期。",
              "Records the launch date; editing it does not change your observation period.",
            )
          }}</small>
        </div>
      </div>
      <div v-if="range" class="promotion-periods">
        <span
          ><i class="before" />{{ t("比较期", "Comparison") }}
          <strong>{{ range.beforeStart }} — {{ range.beforeEnd }}</strong></span
        ><span
          ><i />{{ t("自定观察期", "Custom observation") }}
          <strong>{{ range.startDate }} — {{ range.endDate }}</strong></span
        ><small>{{
          t(
            "当前已应用区间；修改起止日期后点击应用时间。每份清单单独保存自定观察期。",
            "Applied dates. Apply after editing; each list remembers its own observation period.",
          )
        }}</small>
      </div>
    </section>
    <p v-if="error" class="promotion-message error" role="alert">
      {{
        error === "date"
          ? t(
              "请选择有效日期，自定观察期为 1—92 天。",
              "Choose valid dates covering 1–92 days.",
            )
          : t(
              "暂未取得报表数据。清单已保留，指标显示为“—”；连接恢复后可重新应用时间。",
              "Report data is unavailable. The offer list remains; metrics show “—”. Apply dates to retry.",
            )
      }}
    </p>
    <div v-if="report && range" class="promotion-message" role="status">
      <span
        >{{ t("数据记录截至", "Data through") }} <strong>{{ asOf }}</strong> ·
        {{ t("自定观察期", "Custom observation") }} {{ daysAfter }}/{{
          range.days
        }}
        {{ t("天", "days") }}</span
      ><span>{{
        complete
          ? t("周期已结束，可查看变化幅度", "Period ended; change is available")
          : t(
              "数据尚未覆盖完整周期，暂不计算涨跌幅。",
              "Full period not yet covered; change is withheld.",
            )
      }}</span>
    </div>
    <div class="promotion-kpis" :aria-busy="loading">
      <button
        v-for="key in METRICS"
        :key="key"
        type="button"
        :class="{ active: metric === key }"
        :aria-pressed="metric === key"
        @click="metric = key"
      >
        <span>{{ label(key) }}</span
        ><strong>{{
          daysAfter || !report ? format(totals.after[key], key, true) : "—"
        }}</strong
        ><small
          >{{ t("比较期", "Comparison") }}
          {{ format(totals.before[key], key, true) }}</small
        ><em>{{ delta(totals.before[key], totals.after[key]) }}</em>
      </button>
    </div>
    <PromotionRelations
      :language="language"
      :offers="batch?.offers || []"
      :report="relations"
      :loading="loading || relationsLoading"
      :error="relationsError"
      :ready="!!report"
      @retry="refreshRelations"
      @merchant="selectMerchant"
    />
    <section class="promotion-panel">
      <div class="promotion-section-heading">
        <div>
          <h3>{{ t("商家表现", "Merchant performance") }}</h3>
          <p>
            {{ rows.length }} {{ t("个商家 · 有活动", "merchants · active") }}
            {{ report && daysAfter ? activeCount : "—" }} ·
            {{
              t(
                "点击商家查看媒体与推广目标",
                "Select a merchant for publishers and targets",
              )
            }}
          </p>
        </div>
        <button
          type="button"
          :disabled="!report || !download"
          @click="exportRows"
        >
          {{ t("导出对比", "Export comparison") }}
        </button>
      </div>
      <div class="promotion-table-filters">
        <input
          v-model="search"
          type="search"
          :aria-label="t('搜索商家或 ASIN', 'Search merchant or ASIN')"
          :placeholder="
            t('搜索商家、ID 或 ASIN', 'Search merchant, ID or ASIN')
          "
        /><select
          v-model="category"
          :aria-label="t('品类筛选', 'Category filter')"
        >
          <option value="all">{{ t("全部品类", "All categories") }}</option>
          <option v-for="name in categories" :key="name">{{ name }}</option>
        </select>
      </div>
      <div
        class="promotion-scroll"
        tabindex="0"
        role="region"
        :aria-label="t('商家前后表现表', 'Merchant comparison table')"
      >
        <table class="promotion-merchant-table">
          <thead>
            <tr>
              <th>{{ t("商家 / 品类", "Merchant / category") }}</th>
              <th>{{ t("比较期营收", "Comparison revenue") }}</th>
              <th>{{ t("自定观察期营收", "Observed revenue") }}</th>
              <th>{{ t("营收变化", "Revenue change") }}</th>
              <th>{{ t("点击量", "Clicks") }}</th>
              <th>ATC</th>
              <th>{{ t("订单", "Orders") }}</th>
              <th>{{ t("完整月均营收", "Full-month avg revenue") }}</th>
              <th>{{ t("完整月峰值", "Full-month peak") }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in rows"
              :key="r.merchantId"
              :class="{ selected: selectedId === r.merchantId }"
            >
              <th scope="row">
                <div class="promotion-brand" :style="categoryStyle(r.category)">
                  <button
                    type="button"
                    :disabled="!report"
                    @click="selectMerchant(r.merchantId)"
                  >
                    {{ r.merchantName }}
                    <span aria-hidden="true">↗</span></button
                  ><small
                    >ID {{ r.merchantId }} ·
                    {{ r.category || t("未分类", "Uncategorized") }}</small
                  >
                </div>
              </th>
              <td>{{ format(r.before.revenue, "revenue") }}</td>
              <td class="promotion-emphasis">
                {{
                  daysAfter || !report
                    ? format(r.after.revenue, "revenue")
                    : "—"
                }}
              </td>
              <td>{{ delta(r.before.revenue, r.after.revenue) }}</td>
              <td>
                {{ format(r.after.clicks, "clicks")
                }}<small
                  >{{ t("前", "Before") }}
                  {{ format(r.before.clicks, "clicks") }}</small
                >
              </td>
              <td>
                {{ format(r.after.atc, "atc")
                }}<small
                  >{{ t("前", "Before") }}
                  {{ format(r.before.atc, "atc") }}</small
                >
              </td>
              <td>
                {{ format(r.after.orders, "orders")
                }}<small
                  >{{ t("前", "Before") }}
                  {{ format(r.before.orders, "orders") }}</small
                >
              </td>
              <td>
                {{ format(r.baseline.average, "revenue")
                }}<small
                  >{{ r.baseline.months.length }}
                  {{ t("个完整月", "full months") }}</small
                >
              </td>
              <td>{{ format(r.baseline.peak, "revenue") }}</td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="9">
                {{ t("没有匹配商家。", "No matching merchants.") }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section
      v-if="selected"
      id="promotion-detail"
      tabindex="-1"
      class="promotion-panel promotion-detail"
    >
      <div class="promotion-section-heading">
        <div>
          <span class="promotion-eyebrow"
            >{{ t("商家下钻", "Merchant detail") }} · ID
            {{ selected.merchantId }}</span
          >
          <div
            class="promotion-brand"
            :style="categoryStyle(selected.category)"
          >
            <h3>{{ selected.merchantName }}</h3>
            <p>{{ selected.category || t("未分类", "Uncategorized") }}</p>
          </div>
        </div>
        <button type="button" @click="closeDetail">
          {{ t("收起详情", "Close details") }}
        </button>
      </div>
      <p class="promotion-note">{{ selected.notes }}</p>
      <div class="promotion-baseline">
        <div>
          <small>{{
            t("历史完整月均营收", "Historical monthly average")
          }}</small
          ><strong>{{ format(baseline.average, "revenue") }}</strong
          ><span>{{
            t(
              "基于自定观察期前六个完整自然月的实际营收，不代表预测。",
              "Actual revenue across six preceding calendar months; not a forecast.",
            )
          }}</span>
        </div>
        <div class="promotion-months">
          <div v-for="m in selectedStats?.monthly || []" :key="m.month">
            <span>{{ m.month }}</span
            ><i
              ><b
                :style="{
                  width: `${((m.revenue || 0) / Math.max(1, baseline.peak || 0)) * 100}%`,
                }" /></i
            ><strong>{{ format(m.revenue, "revenue") }}</strong>
          </div>
        </div>
      </div>
      <details class="promotion-monthly-detail">
        <summary>{{ t("查看每月完整指标", "View monthly metrics") }}</summary>
        <div class="promotion-scroll" tabindex="0">
          <table>
            <thead>
              <tr>
                <th>{{ t("月份", "Month") }}</th>
                <th v-for="key in METRICS" :key="key">{{ label(key) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in selectedStats?.monthly || []" :key="m.month">
                <th scope="row">{{ m.month }}</th>
                <td v-for="key in METRICS" :key="key">
                  {{ format(m[key], key) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <p>
        {{ t("清单推荐 ASIN", "ASINs in the offer list") }} ·
        {{ selected.asins.length }}
      </p>
      <div class="promotion-asins">
        <code v-for="asin in selected.asins" :key="asin"
          >{{ asin
          }}<span
            v-if="
              detail?.links?.some(
                (l) =>
                  l.asin === asin && METRICS.some((k) => (l.after[k] || 0) > 0),
              )
            "
          >
            · {{ t("已观察到推广", "Promotion observed") }}</span
          ></code
        ><span v-if="!selected.asins.length">{{
          t("清单未指定 ASIN", "No ASINs listed")
        }}</span>
      </div>
      <p class="promotion-note">
        {{
          t(
            "媒体与链接仅表示记录中的活动，不能证明这次推送带来了全部增量；未识别的链接不会自动归为 Storefront。",
            "Publisher/link rows show observed activity, not causal lift from this campaign. Unknown targets are not inferred as Storefront.",
          )
        }}
      </p>
      <p v-if="detailLoading" role="status">
        {{ t("正在加载媒体与链接明细…", "Loading publisher and link detail…") }}
      </p>
      <p v-if="detailError" role="alert">
        {{ t("明细暂不可用。", "Detail unavailable.") }}
        <button type="button" @click="selectMerchant(selectedId)">
          {{ t("重试", "Retry") }}
        </button>
      </p>
      <template v-if="detail"
        ><div class="promotion-table-filters">
          <h4>
            {{ t("哪些媒体在推", "Active publishers") }} · {{ media.length }}
          </h4>
          <input
            v-model="mediaSearch"
            type="search"
            :aria-label="t('搜索媒体或 ASIN', 'Search publisher or ASIN')"
            :placeholder="t('媒体名称、ID 或 ASIN', 'Publisher, ID or ASIN')"
          />
        </div>
        <div class="promotion-scroll" tabindex="0">
          <table>
            <thead>
              <tr>
                <th>{{ t("媒体", "Publisher") }}</th>
                <th>{{ t("比较期营收", "Comparison revenue") }}</th>
                <th>{{ t("自定观察期营收", "Observed revenue") }}</th>
                <th>{{ t("点击", "Clicks") }}</th>
                <th>DPV</th>
                <th>ATC</th>
                <th>{{ t("订单", "Orders") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in media.slice(0, mediaLimit)" :key="m.publisherId">
                <th>
                  {{
                    m.publisherName ||
                    t("未识别媒体", "Unidentified publisher")
                  }}<small>ID {{ m.publisherId || "—" }}</small>
                </th>
                <td>{{ format(m.before.revenue, "revenue") }}</td>
                <td>{{ format(m.after.revenue, "revenue") }}</td>
                <td>{{ format(m.after.clicks, "clicks") }}</td>
                <td>{{ format(m.after.dpv, "dpv") }}</td>
                <td>{{ format(m.after.atc, "atc") }}</td>
                <td>{{ format(m.after.orders, "orders") }}</td>
              </tr>
              <tr v-if="!media.length">
                <td colspan="7">
                  {{
                    t(
                      "当前周期未观察到媒体活动。",
                      "No publisher activity in this period.",
                    )
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          v-if="media.length > mediaLimit"
          type="button"
          @click="mediaLimit += 100"
        >
          {{ t("显示更多媒体", "Show more publishers") }} · {{ mediaLimit }}/{{
            media.length
          }}
        </button>
        <h4>
          {{ t("具体推了什么", "Promoted targets") }} · {{ links.length }}
        </h4>
        <p>
          {{
            t(
              "推广目标与成交商品分开列示。仅有成交 ASIN 时，推广链接保持“未识别”。",
              "Promoted destinations and purchased items are separate. A purchased ASIN alone does not identify the promotion link.",
            )
          }}
        </p>
        <div
          class="promotion-target-filters"
          role="group"
          :aria-label="t('推广链接类型', 'Promotion link type')"
        >
          <button
            type="button"
            :aria-pressed="targetFilter === 'all'"
            @click="
              targetFilter = 'all';
              targetScope = 'all';
              linkLimit = 100;
            "
          >
            {{ t("全部", "All") }} · {{ searchedLinks.length }}
          </button>
          <button
            v-for="kind in LINK_KINDS"
            :key="kind"
            type="button"
            :data-link-kind="kind"
            :aria-pressed="targetFilter === kind"
            @click="
              targetFilter = kind;
              targetScope = 'all';
              linkLimit = 100;
            "
          >
            <span class="promotion-type-dot" aria-hidden="true" />{{
              linkLabel(kind, language)
            }}
            · {{ searchedLinks.filter((row) => linkKind(row) === kind).length }}
          </button>
        </div>
        <div
          v-if="targetFilter === 'all' || targetFilter === 'asin'"
          class="promotion-scope-filters"
          role="group"
          :aria-label="t('单品清单范围', 'Product list scope')"
        >
          <span>{{ t("单品范围", "Product scope") }}</span>
          <button
            type="button"
            :aria-pressed="targetScope === 'all'"
            @click="
              targetScope = 'all';
              linkLimit = 100;
            "
          >
            {{ t("不限范围", "Any scope") }}
          </button>
          <button
            v-for="scope in ASIN_SCOPES"
            :key="scope"
            type="button"
            :data-asin-scope="scope"
            :aria-pressed="targetScope === scope"
            @click="
              targetFilter = 'asin';
              targetScope = scope;
              linkLimit = 100;
            "
          >
            {{ asinScopeLabel(scope, language) }} ·
            {{
              searchedLinks.filter((row) => scopeForSelected(row) === scope)
                .length
            }}
          </button>
        </div>
        <div class="promotion-scroll" tabindex="0">
          <table>
            <thead>
              <tr>
                <th>{{ t("媒体", "Publisher") }}</th>
                <th>{{ t("链接类型", "Link type") }}</th>
                <th>{{ t("推广 ASIN", "Promoted ASIN") }}</th>
                <th>{{ t("与清单的关系", "List membership") }}</th>
                <th>{{ t("成交 ASIN", "Purchased ASIN") }}</th>
                <th>{{ t("自定观察期营收", "Observed revenue") }}</th>
                <th>{{ t("点击", "Clicks") }}</th>
                <th>{{ t("订单", "Orders") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in links.slice(0, linkLimit)" :key="i">
                <th>
                  {{
                    l.publisherName || t("未识别媒体", "Unidentified publisher")
                  }}
                </th>
                <td>
                  <span
                    class="promotion-target-type"
                    :data-link-kind="linkKind(l)"
                    ><span class="promotion-type-dot" aria-hidden="true" />{{
                      linkLabel(linkKind(l), language)
                    }}</span
                  >
                </td>
                <td>
                  <code>{{ l.asin || "—" }}</code>
                </td>
                <td>
                  <span
                    v-if="scopeForSelected(l)"
                    class="promotion-asin-scope"
                    :data-asin-scope="scopeForSelected(l)"
                    >{{ asinScopeLabel(scopeForSelected(l)!, language) }}</span
                  ><span v-else>—</span>
                </td>
                <td>
                  <code>{{ l.purchasedAsin || "—" }}</code>
                </td>
                <td>{{ format(l.after.revenue, "revenue") }}</td>
                <td>{{ format(l.after.clicks, "clicks") }}</td>
                <td>{{ format(l.after.orders, "orders") }}</td>
              </tr>
              <tr v-if="!links.length">
                <td colspan="8">
                  {{
                    t(
                      "当前周期暂无链接明细。",
                      "No link detail for this period.",
                    )
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <button
          v-if="links.length > linkLimit"
          type="button"
          @click="linkLimit += 100"
        >
          {{ t("显示更多推广目标", "Show more targets") }} · {{ linkLimit }}/{{
            links.length
          }}
        </button></template
      >
    </section>
    <section class="promotion-panel">
      <h3>{{ t("品类贡献与偏好", "Category contribution") }}</h3>
      <p>
        {{
          t(
            "展示当前筛选下营收领先的 12 个品类。点击品类筛选商家，全部品类可在商家表中选择。",
            "Top 12 categories by observed revenue in the current selection. Select to filter; all categories are available above the merchant table.",
          )
        }}
      </p>
      <div class="promotion-categories">
        <button
          v-for="c in categoryRows.slice(0, 12)"
          :key="c.name"
          type="button"
          :aria-pressed="category === c.name"
          :style="categoryStyle(c.name)"
          @click="category = c.name"
        >
          <span
            ><i class="promotion-category-dot" aria-hidden="true" />{{
              c.name
            }}</span
          ><i
            ><b
              :style="{
                width: `${(c.value / Math.max(1, totals.after.revenue || 0)) * 100}%`,
              }" /></i
          ><strong>{{
            report && daysAfter ? format(c.value, "revenue") : "—"
          }}</strong>
        </button>
      </div>
    </section>
    <footer class="promotion-footnote">
      {{
        t(
          "数据截至日期表示最新记录，不保证期间每日均已完整回传。Revenue 为 Amazon 归因营收；Orders 为购买数量。点击使用同一来源跨周期比较，不按营收比例分摊。对比展示相关活动，不能单独证明推送的因果效果。",
          "The latest record date does not guarantee complete ingestion each day. Revenue is Amazon-attributed sales; Orders are purchase counts. Clicks use one consistent source, never revenue-based allocation. Before/after activity alone does not establish causality.",
        )
      }}<span v-if="report">
        · {{ t("点击来源", "Clicks source") }}: {{ report.clickSource }}</span
      >
    </footer>
  </section>
</template>
