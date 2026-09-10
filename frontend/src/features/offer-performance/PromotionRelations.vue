<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  METRICS,
  type MediaRow,
  type Metric,
  type PerformanceReport,
  type TrackedOffer,
} from "./performanceModel";
import type { UiLanguage } from "../../shared/i18n";
import {
  categoryStyle,
  linkKind,
  linkLabel,
  ASIN_SCOPES,
  asinScope,
  asinScopeLabel,
  type AsinScope,
} from "./promotionAppearance";

const props = defineProps<{
  language: UiLanguage;
  offers: readonly TrackedOffer[];
  report: PerformanceReport | null;
  loading: boolean;
  error: boolean;
  ready: boolean;
}>();
const emit = defineEmits<{
  retry: [merchantId: string];
  merchant: [id: string];
}>();
const t = (zh: string, en: string) => (props.language === "zh" ? zh : en);
const mode = ref<"merchants" | "products">("merchants"),
  search = ref(""),
  merchant = ref(""),
  period = ref("both"),
  sort = ref<Metric>("revenue"),
  limit = ref(40);
const scopeFilter = ref<AsinScope | "all">("all");
const labels: Record<Metric, [string, string]> = {
  revenue: ["营收", "Revenue"],
  clicks: ["点击", "Clicks"],
  dpv: ["详情页浏览", "Detail views"],
  atc: ["加购", "Add to cart"],
  orders: ["订单", "Orders"],
  commission: ["佣金", "Commission"],
};
const label = (key: Metric) => t(...labels[key]);
const offersById = computed(
  () => new Map(props.offers.map((o) => [o.merchantId, o])),
);
const active = (row: MediaRow, side: "before" | "after") =>
  METRICS.some((k) => Number.isFinite(row[side][k]) && row[side][k] !== 0);
const relationships = computed(
  () =>
    (mode.value === "merchants" ? props.report?.media : props.report?.links) ||
    [],
);
const scopeFor = (row: MediaRow) =>
  asinScope(row, offersById.value.get(row.merchantId));
const candidateRows = computed(() =>
  relationships.value
    .filter(
      (r) =>
        offersById.value.has(r.merchantId) &&
        (!merchant.value || r.merchantId === merchant.value) &&
        (period.value === "both"
          ? active(r, "before") || active(r, "after")
          : active(r, period.value as "before" | "after")) &&
        `${r.merchantId} ${offersById.value.get(r.merchantId)?.merchantName} ${r.publisherId} ${r.publisherName} ${r.asin} ${r.purchasedAsin} ${r.linkType}`
          .toLowerCase()
          .includes(search.value.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        ((period.value === "before" ? b.before : b.after)[sort.value] ??
          -Infinity) -
        ((period.value === "before" ? a.before : a.after)[sort.value] ??
          -Infinity),
    ),
);
const rows = computed(() =>
  candidateRows.value.filter(
    (row) =>
      mode.value !== "products" ||
      scopeFilter.value === "all" ||
      scopeFor(row) === scopeFilter.value,
  ),
);
const merchants = computed(
  () => new Set(rows.value.map((r) => r.merchantId)).size,
);
const publishers = computed(
  () =>
    new Set(
      rows.value.map((r) => r.publisherId).filter((id) => id && id !== "0"),
    ).size,
);
const target = (r: MediaRow) =>
  r.asin ||
  (r.linkType === "storefront"
    ? "Storefront"
    : r.purchasedAsin || t("目标未识别", "Unknown target"));
const evidence = (r: MediaRow) =>
  r.asin
    ? t("推广 ASIN", "Promoted ASIN")
    : r.linkType === "storefront"
      ? t("店铺推广链接", "Storefront link")
      : r.purchasedAsin
        ? t("成交 ASIN · 推广链接未知", "Purchased ASIN · destination unknown")
        : t("记录未提供目标", "No target evidence");
function format(value: number | null, metric: Metric) {
  return value === null
    ? "—"
    : new Intl.NumberFormat(props.language === "zh" ? "zh-CN" : "en-US", {
        style:
          metric === "revenue" || metric === "commission"
            ? "currency"
            : "decimal",
        currency: "USD",
        maximumFractionDigits:
          metric === "revenue" || metric === "commission" ? 2 : 0,
      }).format(value);
}
watch([mode, search, merchant, period, scopeFilter], () => {
  limit.value = 40;
});
watch(
  () => props.offers,
  () => {
    if (!offersById.value.has(merchant.value)) merchant.value = "";
  },
);
</script>

<template>
  <section
    class="promotion-panel promotion-relations"
    :aria-label="t('商家与媒体关系', 'Merchant and publisher relationships')"
    :aria-busy="loading"
  >
    <div class="promotion-section-heading">
      <div>
        <span class="promotion-eyebrow">{{
          t("关系视图", "Relationship view")
        }}</span>
        <h3>
          {{
            t(
              "商家、单品与媒体，直接对应",
              "Connect merchants, products and publishers",
            )
          }}
        </h3>
        <p>
          {{
            t(
              "从商家 ID 出发，读取实际媒体与商品记录；无需在导入表中指定 ASIN。",
              "Read publisher and product records by Merchant ID. An imported ASIN list is optional.",
            )
          }}
        </p>
      </div>
      <div
        class="promotion-relation-modes"
        role="group"
        :aria-label="t('关系层级', 'Relationship level')"
      >
        <button
          type="button"
          :aria-pressed="mode === 'merchants'"
          @click="mode = 'merchants'"
        >
          {{ t("商家—媒体", "Merchant–publisher") }}
        </button>
        <button
          type="button"
          :aria-pressed="mode === 'products'"
          @click="mode = 'products'"
        >
          {{ t("商家单品—媒体", "Product–publisher") }}
        </button>
      </div>
    </div>
    <div class="promotion-relation-filters">
      <label
        >{{ t("关系搜索", "Search relationships")
        }}<input
          v-model="search"
          type="search"
          :placeholder="
            t('商家、媒体、ID 或 ASIN', 'Merchant, publisher, ID or ASIN')
          "
      /></label>
      <label
        >{{ t("关系商家", "Relationship merchant")
        }}<select v-model="merchant" @change="emit('retry', merchant)">
          <option value="">
            {{ t("全部追踪商家", "All tracked merchants") }}
          </option>
          <option v-for="o in offers" :key="o.merchantId" :value="o.merchantId">
            {{ o.merchantName }} · {{ o.merchantId }}
          </option>
        </select></label
      >
      <label
        >{{ t("活动周期", "Activity period")
        }}<select v-model="period">
          <option value="both">{{ t("前后两个周期", "Both periods") }}</option>
          <option value="after">{{ t("仅观察期", "Observation only") }}</option>
          <option value="before">{{ t("仅推送前", "Before only") }}</option>
        </select></label
      >
      <label
        >{{ t("关系排序指标", "Sort relationships")
        }}<select v-model="sort">
          <option v-for="key in METRICS" :key="key" :value="key">
            {{ label(key) }}
          </option>
        </select></label
      >
    </div>
    <div
      v-if="mode === 'products'"
      class="promotion-scope-filters"
      role="group"
      :aria-label="t('关系单品范围', 'Relationship product scope')"
    >
      <button
        type="button"
        :aria-pressed="scopeFilter === 'all'"
        @click="scopeFilter = 'all'"
      >
        {{ t("全部目标", "All targets") }} · {{ candidateRows.length }}
      </button>
      <button
        v-for="scope in ASIN_SCOPES"
        :key="scope"
        type="button"
        :data-asin-scope="scope"
        :aria-pressed="scopeFilter === scope"
        @click="scopeFilter = scope"
      >
        {{ asinScopeLabel(scope, language) }} ·
        {{ candidateRows.filter((row) => scopeFor(row) === scope).length }}
      </button>
    </div>
    <p v-if="loading" role="status">
      {{
        t(
          "正在读取商家与媒体的实际关系…",
          "Loading observed merchant and publisher relationships…",
        )
      }}
    </p>
    <p v-else-if="error" class="promotion-message error" role="alert">
      {{
        t(
          "关系数据暂不可用，可重试或缩短时间范围。",
          "Relationship data is unavailable. Retry or shorten the date range.",
        )
      }}
      <button type="button" @click="emit('retry', merchant)">
        {{ t("重试关系数据", "Retry relationships") }}
      </button>
    </p>
    <p v-else-if="!ready || !report" role="status">
      {{
        t(
          "统计数据加载后，这里会显示实际关系。商家清单已保留。",
          "Observed relationships appear after reporting data loads. Tracked merchants remain saved.",
        )
      }}
    </p>
    <template v-else>
      <div class="promotion-relation-summary" role="status">
        <span
          ><strong>{{ merchants }}</strong> {{ t("个商家", "merchants") }}</span
        ><span
          ><strong>{{ publishers }}</strong>
          {{ t("家已识别媒体", "identified publishers") }}</span
        ><span
          ><strong>{{ rows.length }}</strong>
          {{ t("条对应关系", "relationships") }}</span
        ><small
          >{{
            t(
              "每项指标上方为观察期，下方为推送前。",
              "Each metric shows observation above and before below.",
            )
          }}
          · {{ t("数据截至", "Data through") }}
          {{ report.availableThrough }}</small
        >
      </div>
      <div
        class="promotion-scroll"
        tabindex="0"
        role="region"
        :aria-label="
          mode === 'merchants'
            ? t('商家媒体关系表', 'Merchant publisher relationships')
            : t('商家单品媒体关系表', 'Product publisher relationships')
        "
      >
        <table class="promotion-relation-table">
          <thead>
            <tr>
              <th>
                {{
                  mode === "merchants"
                    ? t("商家 → 媒体", "Merchant → publisher")
                    : t(
                        "商家 → 单品 / 店铺 → 媒体",
                        "Merchant → product / store → publisher",
                      )
                }}
              </th>
              <th v-for="key in METRICS" :key="key" scope="col">
                {{ label(key) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, index) in rows.slice(0, limit)"
              :key="
                [
                  r.merchantId,
                  r.publisherId,
                  r.asin,
                  r.purchasedAsin,
                  r.linkType,
                  index,
                ].join(':')
              "
            >
              <th scope="row">
                <div
                  class="promotion-relation-path"
                  :class="{ 'has-product': mode === 'products' }"
                >
                  <div
                    class="promotion-relation-node promotion-brand"
                    :style="
                      categoryStyle(offersById.get(r.merchantId)?.category)
                    "
                  >
                    <small>{{ t("商家", "Merchant") }}</small
                    ><button
                      type="button"
                      @click="emit('merchant', r.merchantId)"
                    >
                      {{ offersById.get(r.merchantId)?.merchantName }}</button
                    ><small>ID {{ r.merchantId }}</small
                    ><small class="promotion-category-label">{{
                      offersById.get(r.merchantId)?.category ||
                      t("未分类", "Uncategorized")
                    }}</small>
                  </div>
                  <span class="promotion-relation-arrow" aria-hidden="true"
                    >→</span
                  >
                  <template v-if="mode === 'products'"
                    ><div
                      class="promotion-relation-node promotion-relation-product"
                      :data-link-kind="linkKind(r)"
                    >
                      <span
                        class="promotion-target-type"
                        :data-link-kind="linkKind(r)"
                        ><span
                          class="promotion-type-dot"
                          aria-hidden="true"
                        />{{ linkLabel(linkKind(r), language) }}</span
                      ><small>{{ evidence(r) }}</small
                      ><strong>{{ target(r) }}</strong
                      ><span
                        v-if="scopeFor(r)"
                        class="promotion-asin-scope"
                        :data-asin-scope="scopeFor(r)"
                        >{{ asinScopeLabel(scopeFor(r)!, language) }}</span
                      ><small
                        v-if="
                          r.purchasedAsin &&
                          (r.asin || r.linkType === 'storefront')
                        "
                        >{{ t("成交", "Purchased") }}
                        {{ r.purchasedAsin }}</small
                      >
                    </div>
                    <span class="promotion-relation-arrow" aria-hidden="true"
                      >→</span
                    ></template
                  >
                  <div class="promotion-relation-node">
                    <small>{{ t("媒体", "Publisher") }}</small
                    ><strong>{{
                      r.publisherName ||
                      t("未识别媒体", "Unidentified publisher")
                    }}</strong
                    ><small>ID {{ r.publisherId || "—" }}</small
                    ><span class="promotion-relation-status">{{
                      active(r, "after")
                        ? t("观察期有活动", "Activity observed")
                        : t("仅推送前有记录", "Before-period records only")
                    }}</span>
                  </div>
                </div>
              </th>
              <td v-for="key in METRICS" :key="key">
                <strong>{{ format(r.after[key], key) }}</strong
                ><small
                  >{{ t("前", "Before") }}
                  {{ format(r.before[key], key) }}</small
                >
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="7">
                {{
                  t(
                    "当前筛选下没有观察到对应关系。可以切换活动周期或清空搜索。",
                    "No relationships match. Change the activity period or clear the search.",
                  )
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button v-if="rows.length > limit" type="button" @click="limit += 40">
        {{ t("显示更多关系", "Show more relationships") }} · {{ limit }}/{{
          rows.length
        }}
      </button>
      <p v-if="mode === 'products'" class="promotion-note">
        {{
          t(
            "清单内/外按当前商家 ID 对应的 ASIN 清单判断；未提供清单 ASIN 时不推断范围。“成交 ASIN”不是推广目标证据，未关联到单品的点击不分摊给商品。",
            "List membership uses the current merchant ID and its ASIN list. No list means unspecified scope. Purchased ASINs do not prove promoted destinations; unattributed clicks are not allocated to products.",
          )
        }}
      </p>
    </template>
  </section>
</template>
