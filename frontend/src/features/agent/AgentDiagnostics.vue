<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { notifyAuthFailure } from "../../shared/api/client";
import { DIAGNOSTIC_LIMIT, normalizeDiagnosticLog, type AgentDiagnosticLog, type AgentDiagnosticTurn } from "./agentDiagnostics";
const props = defineProps<{ language: "zh" | "en"; turns: AgentDiagnosticTurn[]; running: boolean }>();
const emit = defineEmits<{ replay: [turn: AgentDiagnosticTurn] }>();
const imported = ref<AgentDiagnosticLog | null>(null);
const selected = ref(0);
const notice = ref("");
const uploading = ref(false);
const uploadedId = ref("");
const copy = computed(() => props.language === "zh" ? {
  title: "对话日志与回测", download: "下载日志", import: "导入日志", upload: "上传日志", uploading: "上传中…", replay: "重新运行这一轮",
  empty: "暂无对话记录", invalid: "日志格式不正确，或文件超过 512 KB。", failed: "上传失败，可下载日志后重试。", uploaded: "已上传，记录 ID：",
  hint: "包含问题、回答、上下文和执行步骤。回测使用当前数据重新运行。", original: "原回答", choose: "选择轮次", loading: "日志已导入"
} : { title: "Conversation logs & replay", download: "Download log", import: "Import log", upload: "Upload log", uploading: "Uploading…", replay: "Rerun this turn", empty: "No conversation yet", invalid: "Invalid log or file exceeds 512 KB.", failed: "Upload failed. Download the log and retry.", uploaded: "Uploaded. Case ID: ", hint: "Includes questions, answers, context, and execution steps. Replay runs against current data.", original: "Original answer", choose: "Select turn", loading: "Log imported" });
const log = computed(() => imported.value || (props.turns.length ? { version: 1 as const, turns: props.turns } : null));
const turn = computed(() => log.value?.turns[selected.value]);
watch(() => props.turns, () => { if (!imported.value) selected.value = Math.max(0, props.turns.length - 1); uploadedId.value = ""; }, { immediate: true });
async function importLog(event: Event) {
  const field = event.target as HTMLInputElement;
  const file = field.files?.[0];
  field.value = "";
  if (!file) return;
  try {
    if (file.size > DIAGNOSTIC_LIMIT) throw new Error("large");
    imported.value = normalizeDiagnosticLog(JSON.parse(await file.text()));
    selected.value = imported.value.turns.length - 1;
    notice.value = copy.value.loading; uploadedId.value = "";
  } catch { notice.value = copy.value.invalid; }
}
function download() {
  if (!log.value) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(log.value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `agent-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function upload() {
  if (!log.value || uploading.value) return;
  uploading.value = true; notice.value = "";
  try {
    const result = await fetch("/api/chat/stream?operation=agent_debug", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(normalizeDiagnosticLog(log.value)), signal: AbortSignal.timeout(20000) });
    if (result.status === 401 || result.status === 403) notifyAuthFailure(result.status);
    const body = await result.json();
    if (!result.ok || body.ok !== true || typeof body.id !== "string") throw new Error("upload");
    uploadedId.value = body.id; notice.value = copy.value.uploaded + body.id;
  } catch { notice.value = copy.value.failed; }
  finally { uploading.value = false; }
}
</script>
<template>
  <details class="aw-diagnostics" data-agent-diagnostics>
    <summary>{{ copy.title }}</summary>
    <p>{{ copy.hint }}</p>
    <div class="aw-diagnostic-actions">
      <button type="button" :disabled="!log || uploading" @click="download">{{ copy.download }}</button>
      <label class="aw-file-label">{{ copy.import }}<input type="file" accept=".json,application/json" :disabled="uploading" data-agent-log-import @change="importLog" /></label>
      <button type="button" :disabled="!log || uploading || !!uploadedId" data-agent-log-upload @click="upload">{{ uploading ? copy.uploading : copy.upload }}</button>
    </div>
    <label v-if="log" class="aw-log-turn-select">{{ copy.choose }}<select v-model="selected"><option v-for="(item, index) in log.turns" :key="index" :value="index">{{ index + 1 }} · {{ item.prompt.slice(0, 72) }}</option></select></label>
    <p v-else>{{ copy.empty }}</p>
    <details v-if="turn"><summary>{{ copy.original }}</summary><pre class="aw-log-answer">{{ turn.response || turn.errorCode || turn.status }}</pre></details>
    <button v-if="turn" type="button" class="aw-button" :disabled="running || uploading" data-agent-log-replay @click="emit('replay', turn)">{{ copy.replay }}</button>
    <p v-if="notice" role="status">{{ notice }}</p>
  </details>
</template>
