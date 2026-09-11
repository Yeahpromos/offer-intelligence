<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import DatePicker from "../../shared/components/DatePicker.vue";
import type { UiLanguage } from "../../shared/i18n";
import {
  parseBatch,
  addDays,
  windowDates,
  type PromotionBatch,
} from "./performanceModel";
import { categoryStyle } from "./promotionAppearance";

const props = defineProps<{
  language: UiLanguage;
  defaultDate: string;
  readFile: (file: File) => Promise<unknown[][][]>;
}>();
const emit = defineEmits<{ confirm: [batch: PromotionBatch] }>();
const t = (zh: string, en: string) => (props.language === "zh" ? zh : en);
const fileInput = ref<HTMLInputElement | null>(null);
const previewButton = ref<HTMLButtonElement | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);
const file = ref<File | null>(null),
  reading = ref(false),
  error = ref("");
const preview = ref<PromotionBatch | null>(null),
  date = ref(""),
  start = ref(""),
  end = ref(""),
  name = ref("");
const dragging = ref(false);
const dates = computed(() =>
  windowDates(date.value) && start.value && end.value
    ? windowDates(date.value, start.value, end.value)
    : null,
);
const asinCount = computed(
  () => preview.value?.offers.reduce((sum, o) => sum + o.asins.length, 0) || 0,
);
const supportedExtensions = [".xlsx", ".xls", ".csv", ".tsv"];
let revision = 0;
let disposed = false;
let previousOverflow: string | null = null;
function unlockScroll() {
  if (previousOverflow === null) return;
  document.documentElement.style.overflow = previousOverflow;
  previousOverflow = null;
}
function selectFile(selected: File | undefined) {
  if (!selected) return;
  if (
    !supportedExtensions.some((extension) =>
      selected.name.toLowerCase().endsWith(extension),
    )
  ) {
    error.value = t(
      "请选择 XLSX、XLS、CSV 或 TSV 文件。",
      "Choose an XLSX, XLS, CSV, or TSV file.",
    );
    return;
  }
  file.value = selected;
  error.value = "";
}
function choose(event: Event) {
  selectFile((event.target as HTMLInputElement).files?.[0]);
}
function dragEnter(event: DragEvent) {
  if (reading.value) return;
  event.preventDefault();
  dragging.value = true;
}
function dragOver(event: DragEvent) {
  if (reading.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  dragging.value = true;
}
function dragLeave(event: DragEvent) {
  const current = event.currentTarget as HTMLElement;
  if (
    event.relatedTarget instanceof Node &&
    current.contains(event.relatedTarget)
  ) {
    return;
  }
  dragging.value = false;
}
function drop(event: DragEvent) {
  event.preventDefault();
  dragging.value = false;
  if (reading.value) return;
  selectFile(event.dataTransfer?.files?.[0]);
  if (!event.dataTransfer?.files?.length) {
    error.value = t(
      "请从文件夹中拖入一个 XLSX、XLS、CSV 或 TSV 文件。",
      "Drop an XLSX, XLS, CSV, or TSV file from a folder.",
    );
  }
}
async function readPreview() {
  if (!file.value || reading.value) return;
  error.value = "";
  reading.value = true;
  const current = ++revision;
  try {
    const selectedFile = file.value;
    const tables = await props.readFile(selectedFile);
    if (disposed || current !== revision) return;
    date.value = windowDates(props.defaultDate) ? props.defaultDate : "";
    start.value = date.value;
    end.value = addDays(date.value, 6);
    const item = parseBatch(tables, selectedFile.name, date.value);
    name.value = item.name;
    preview.value = item;
    await nextTick();
    if (disposed || current !== revision) return;
    dialog.value?.showModal();
    previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  } catch {
    unlockScroll();
    preview.value = null;
    error.value = t(
      "无法读取文件。请检查 Merchant ID、Merchant Name 两列；每份清单最多 200 个商家。",
      "Cannot read this file. Check Merchant ID and Merchant Name columns; each list supports up to 200 merchants.",
    );
  } finally {
    if (current === revision) reading.value = false;
  }
}
async function closePreview() {
  dialog.value?.close();
  unlockScroll();
  preview.value = null;
  await nextTick();
  previewButton.value?.focus();
}
function confirm() {
  if (!preview.value || !dates.value || !name.value.trim()) return;
  const item = {
    ...preview.value,
    name: name.value.trim(),
    launchDate: date.value,
    observationStart: start.value,
    observationEnd: end.value,
  };
  dialog.value?.close();
  unlockScroll();
  preview.value = null;
  emit("confirm", item);
}
onBeforeUnmount(() => {
  disposed = true;
  revision++;
  dialog.value?.close();
  unlockScroll();
});
</script>

<template>
  <section
    class="promotion-panel promotion-import"
    :aria-label="t('导入商家清单', 'Import merchants')"
  >
    <div>
      <h3>{{ t("导入商家清单", "Import tracked merchants") }}</h3>
      <p>
        {{
          t(
            "只需 Merchant ID 和 Merchant Name。选择文件后先核对内容和推送日期，确认后再从下方追踪清单选择。",
            "Only Merchant ID and Merchant Name are required. Review merchants and the launch date, confirm, then select the list below.",
          )
        }}
      </p>
    </div>
    <ol
      class="promotion-import-steps"
      :aria-label="t('导入步骤', 'Import steps')"
    >
      <li><b>1</b>{{ t("选择文件", "Choose file") }}</li>
      <li><b>2</b>{{ t("预览并确认", "Review and confirm") }}</li>
      <li><b>3</b>{{ t("选择追踪清单", "Select tracking list") }}</li>
    </ol>
    <div
      class="promotion-file-choice"
      :class="{ 'is-dragging': dragging }"
      role="group"
      :aria-label="
        t(
          '将商家文件拖到这里，或点击选择文件',
          'Drop a merchant file here or choose one',
        )
      "
      @dragenter.prevent="dragEnter"
      @dragover.prevent="dragOver"
      @dragleave="dragLeave"
      @drop.prevent="drop"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <path
          d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"
        />
      </svg>
      <div role="status">
        <strong>{{
          file?.name || t("选择要导入的商家文件", "Choose a merchant file")
        }}</strong
        ><small>{{
          file
            ? t("文件已选择，尚未导入", "File selected; not imported yet")
            : t(
                "XLSX · XLS · CSV · TSV · 可从文件夹拖入",
                "XLSX · XLS · CSV · TSV · Drop from a folder",
              )
        }}</small>
      </div>
      <input
        ref="fileInput"
        hidden
        type="file"
        accept=".xlsx,.xls,.csv,.tsv"
        :disabled="reading"
        :aria-label="t('选择 Offer 工作簿', 'Choose an offer workbook')"
        @change="choose"
      />
      <button type="button" :disabled="reading" @click="fileInput?.click()">
        {{ file ? t("更换文件", "Change file") : t("选择文件", "Choose file") }}
      </button>
    </div>
    <div class="promotion-import-action">
      <span>{{
        t(
          "品类与 ASIN 可选。导入不会改写原文件。",
          "Category and ASIN are optional. The source file stays unchanged.",
        )
      }}</span>
      <button
        ref="previewButton"
        type="button"
        class="primary"
        :disabled="!file || reading"
        @click="readPreview"
      >
        {{
          reading ? t("正在读取…", "Reading…") : t("预览导入", "Preview import")
        }}
      </button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <dialog
      v-if="preview"
      ref="dialog"
      class="promotion-page promotion-import-dialog"
      aria-labelledby="promotion-import-title"
      aria-describedby="promotion-import-description"
      @cancel.prevent="closePreview"
    >
      <form @submit.prevent="confirm">
        <header class="promotion-section-heading">
          <div>
            <span class="promotion-eyebrow">{{
              t("确认后才会保存", "Saved only after confirmation")
            }}</span>
            <h3 id="promotion-import-title">
              {{ t("核对导入内容", "Review imported merchants") }}
            </h3>
          </div>
          <button type="button" @click="closePreview">
            {{ t("返回修改", "Back to file") }}
          </button>
        </header>
        <p id="promotion-import-description">
          {{ preview.sourceFile }} ·
          {{
            t(
              "按商家 ID 合并各工作表，以下为将要新增的追踪清单。",
              "Sheets are merged by Merchant ID. Review the tracking list to be added.",
            )
          }}
        </p>
        <div class="promotion-import-metadata">
          <label
            >{{ t("清单名称", "List name")
            }}<input v-model="name" maxlength="160" required autofocus
          /></label>
          <label
            >{{ t("推送日期", "Launch date")
            }}<DatePicker
              v-model="date"
              :language="language"
              :teleport-to="dialog || 'body'"
              :label="t('新清单推送日期', 'New list launch date')"
          /></label>
        </div>
        <fieldset class="promotion-import-observation">
          <legend>{{ t("自定观察期", "Custom observation period") }}</legend>
          <div class="promotion-dates">
            <label
              >{{ t("开始日期", "Start date")
              }}<DatePicker
                v-model="start"
                :language="language"
                :teleport-to="dialog || 'body'"
                :label="t('新清单观察开始', 'New list observation start')"
            /></label>
            <label
              >{{ t("结束日期", "End date")
              }}<DatePicker
                v-model="end"
                :language="language"
                :teleport-to="dialog || 'body'"
                :label="t('新清单观察结束', 'New list observation end')"
            /></label>
          </div>
          <p>
            {{
              t(
                "比较期自动取此前等长区间；导入后仍可修改。",
                "The comparison uses the preceding period of equal length. You can edit dates after importing.",
              )
            }}
          </p>
        </fieldset>
        <p v-if="!dates" role="alert">
          {{
            t(
              "请填写有效推送日期及 1—92 天的自定观察期，再确认导入。",
              "Enter a valid launch date and a custom observation period of 1–92 days before confirming.",
            )
          }}
        </p>
        <div v-else class="promotion-periods">
          <span
            >{{ t("比较期", "Comparison") }}
            <strong
              >{{ dates.beforeStart }} — {{ dates.beforeEnd }}</strong
            ></span
          ><span
            >{{ t("自定观察期", "Custom observation") }}
            <strong>{{ dates.startDate }} — {{ dates.endDate }}</strong></span
          >
        </div>
        <div class="promotion-import-counts">
          <strong
            >{{ preview.offers.length }} {{ t("个商家", "merchants") }}</strong
          ><span>{{ asinCount }} ASIN</span
          ><span>{{ t("按 ID 去重", "Deduplicated by ID") }}</span>
        </div>
        <div
          class="promotion-scroll"
          tabindex="0"
          role="region"
          :aria-label="t('导入商家预览表', 'Imported merchant preview')"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{{ t("商家 ID", "Merchant ID") }}</th>
                <th scope="col">
                  {{ t("商家名称 / 品类", "Merchant / category") }}
                </th>
                <th scope="col">ASIN</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="offer in preview.offers" :key="offer.merchantId">
                <th scope="row">{{ offer.merchantId }}</th>
                <td class="promotion-import-merchant">
                  <div
                    class="promotion-brand"
                    :style="categoryStyle(offer.category)"
                  >
                    <strong>{{ offer.merchantName }}</strong
                    ><small>{{
                      offer.category || t("未分类", "Uncategorized")
                    }}</small>
                  </div>
                </td>
                <td>{{ offer.asins.join(", ") || "—" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="promotion-import-action">
          <p>
            {{
              t(
                "确认后保存在当前浏览器，并加入下方的追踪清单选项。",
                "Confirmation saves this list in this browser and adds it to the selector below.",
              )
            }}
          </p>
          <button
            type="submit"
            class="primary"
            :disabled="!dates || !name.trim()"
          >
            {{ t("确认导入", "Confirm import") }} · {{ preview.offers.length }}
          </button>
        </footer>
      </form>
    </dialog>
  </section>
</template>
