<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from "vue";
import { Files, ListChecks, UploadCloud } from "lucide-vue-next";
import AudioUploader from "./AudioUploader.vue";
import TranscriptViewer from "./TranscriptViewer.vue";
import AnalysisPanel from "./AnalysisPanel.vue";
import {
  connectWs,
  createBatch,
  getBatch,
  getJob,
  subscribeBatch,
  subscribeJob,
} from "../services/backendApi";
import { useSession } from "../services/session";

type BatchStatus =
  | "queued"
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "completed"
  | "failed";

type QAScoreRow = {
  area: string;
  evidence_timestamp: string;
  note: string;
  parameter?: string;
  score: number;
  max_score?: number;
  description?: string;
};

type QAScorecard = {
  summary: string;
  evaluation_table: QAScoreRow[];
  red_flags: string | null;
  routing: string;
};

type BatchItem = {
  id: string;
  file: File;
  status: BatchStatus;
  uploadProgress: number;
  analyticsProgress: number;
  transcript: string;
  segments: any[];
  analysis: QAScorecard | null;
  hasCEDefect: boolean;
  nceDefects: number;
  error: string | null;
};

const { hasApiKeys } = defineProps<{
  hasApiKeys: boolean;
}>();

const QA_TARGET_PERCENT = 85;

const batchCallType = ref<"inbound" | "outbound">("inbound");
const isConfirming = ref(false);
const pendingFiles = ref<File[]>([]);
const isRunning = ref(false);
const items = ref<BatchItem[]>([]);
const selectedItemId = ref<string | null>(null);
const maximizedPanel = ref<"transcript" | "analysis" | null>(null);
const nceParameterInput = ref(10);

const currentBatchId = ref<string | null>(null);
let ws: WebSocket | null = null;
let pollTimer: number | null = null;

const session = useSession();
const tenantId = computed(() => session.tenantId.value || "");
const projectId = computed(() => session.projectId.value || "");

const selectedItem = computed(
  () => items.value.find((item) => item.id === selectedItemId.value) ?? null,
);
const detectedNceParameterCount = computed(() => {
  const completedWithAnalysis = items.value.find(
    (item) => item.status === "completed" && item.analysis,
  );
  if (!completedWithAnalysis?.analysis) return 10;
  const count = completedWithAnalysis.analysis.evaluation_table.filter(
    (row) => (row.parameter || "").toUpperCase() === "NCE",
  ).length;
  return count > 0 ? count : 10;
});
const nceParameters = computed(() => {
  const parsed = Number(nceParameterInput.value);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
});
const totalSamples = computed(() => items.value.length);
const totalOpportunities = computed(() => totalSamples.value * nceParameters.value);
const ceDefectSamples = computed(() =>
  items.value.reduce(
    (sum, item) => sum + (item.status === "failed" || item.hasCEDefect ? 1 : 0),
    0,
  ),
);
const totalNCEDefects = computed(() =>
  items.value.reduce(
    (sum, item) => sum + (item.status === "failed" ? nceParameters.value : item.nceDefects),
    0,
  ),
);
const ceAccuracy = computed(() =>
  totalSamples.value ? (totalSamples.value - ceDefectSamples.value) / totalSamples.value : 0,
);
const nceAccuracy = computed(() => {
  if (!totalSamples.value) return 0;
  const defects = totalNCEDefects.value / totalOpportunities.value;
  return Math.max(0, Math.min(1, 1 - defects));
});
const integratedQAScore = computed(
  () => ceAccuracy.value * 0.6 + nceAccuracy.value * 0.4,
);
const targetMet = computed(() => integratedQAScore.value * 100 >= QA_TARGET_PERCENT);

const uploadOverallProgress = computed(() => {
  if (!items.value.length) return 0;
  return items.value.reduce((sum, item) => sum + item.uploadProgress, 0) / items.value.length;
});
const analyticsOverallProgress = computed(() => {
  if (!items.value.length) return 0;
  return items.value.reduce((sum, item) => sum + item.analyticsProgress, 0) / items.value.length;
});

const formatPercent = (value: number) => `${(value * 100).toFixed(2)}%`;

const statusLabel: Record<BatchStatus, string> = {
  queued: "Queued",
  uploading: "Uploading",
  transcribing: "Transcribing",
  analyzing: "Analyzing",
  completed: "Completed",
  failed: "Failed",
};

watch(
  detectedNceParameterCount,
  (value) => {
    if (items.value.length === 0) {
      nceParameterInput.value = value;
    }
  },
  { immediate: true },
);

const toggleMaximize = (panel: "transcript" | "analysis") => {
  maximizedPanel.value = maximizedPanel.value === panel ? null : panel;
};

const getDefectStats = (scorecard: QAScorecard) => {
  let hasCEDefect = false;
  let nceDefects = 0;
  scorecard.evaluation_table.forEach((row) => {
    const parameter = (row.parameter || "").toUpperCase();
    const isPassed = row.score === (row.max_score || 0);
    if (parameter === "CE" && !isPassed) hasCEDefect = true;
    if (parameter === "NCE" && !isPassed) nceDefects += 1;
  });
  return { hasCEDefect, nceDefects };
};

const updateItem = (id: string, patch: Partial<BatchItem>) => {
  items.value = items.value.map((item) => (item.id === id ? { ...item, ...patch } : item));
};

const hydrateJob = async (id: string) => {
  const detail = await getJob(id);
  const segments = detail.segments.map((seg: any) => ({
    start: seg.startSec,
    end: seg.endSec,
    text: seg.rawText,
    speakerId: seg.speakerId,
    role: seg.role,
    cleaned_text: seg.cleanedText,
    sentiment: seg.sentiment,
    words: seg.wordsJson,
  }));

  const analyticsProgress =
    detail.status === "completed"
      ? 100
      : detail.status === "analyzing"
      ? 80
      : detail.status === "transcribing"
      ? 40
      : 0;

  const defect = detail.analysis ? getDefectStats(detail.analysis as QAScorecard) : { hasCEDefect: false, nceDefects: 0 };

  updateItem(id, {
    status: detail.status as BatchStatus,
    transcript: detail.transcript || segments.map((seg: any) => seg.cleaned_text || seg.text).join(" "),
    segments,
    analysis: (detail.analysis as QAScorecard) || null,
    analyticsProgress,
    hasCEDefect: defect.hasCEDefect,
    nceDefects: defect.nceDefects,
    error: detail.errorMessage,
  });
};

const syncBatch = async () => {
  if (!currentBatchId.value) return;
  const batch = await getBatch(currentBatchId.value);

  for (const job of batch.jobs) {
    updateItem(job.id, {
      status: job.status as BatchStatus,
      uploadProgress: job.progress,
      analyticsProgress: job.progress,
      error: job.errorMessage,
    });

    if (job.status === "completed") {
      const existing = items.value.find((item) => item.id === job.id);
      if (existing && !existing.analysis) {
        await hydrateJob(job.id);
      }
    }
  }

  if (selectedItemId.value) {
    const selected = items.value.find((item) => item.id === selectedItemId.value);
    if (selected && (selected.status === "analyzing" || selected.status === "transcribing")) {
      await hydrateJob(selected.id);
    }
  }

  if (batch.jobs.every((job: any) => job.status === "completed" || job.status === "failed")) {
    isRunning.value = false;
  }
};

const stopRealtime = () => {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
};

const startRealtime = () => {
  if (!currentBatchId.value) return;

  try {
    ws = connectWs((event: any) => {
      if (event.batchId === currentBatchId.value) {
        void syncBatch();
      }
    });

    ws.onopen = () => {
      if (!ws || !currentBatchId.value) return;
      subscribeBatch(ws, currentBatchId.value);
      for (const item of items.value) {
        subscribeJob(ws, item.id);
      }
    };
  } catch {
    // Polling will keep updating.
  }

  pollTimer = window.setInterval(() => {
    void syncBatch();
  }, 2000);
};

const handleFilesSelect = (files: File[]) => {
  if (!hasApiKeys) {
    alert("Missing backend config/token. Configure frontend env first.");
    return;
  }
  if (!files.length) return;
  pendingFiles.value = files;
  isConfirming.value = true;
};

const startBatchRun = async () => {
  if (!hasApiKeys) return;
  if (!pendingFiles.value.length) return;
  if (!tenantId.value || !projectId.value) {
    alert("Select tenant and project from Manage page first.");
    return;
  }

  const queuedFiles = [...pendingFiles.value];
  pendingFiles.value = [];
  isConfirming.value = false;
  maximizedPanel.value = null;
  stopRealtime();

  try {
    const created = await createBatch({
      tenantId: tenantId.value,
      projectId: projectId.value,
      callType: batchCallType.value,
      files: queuedFiles,
    });

    currentBatchId.value = created.batchId;

    const nextItems: BatchItem[] = queuedFiles.map((file, idx) => ({
      id: created.jobIds[idx] || `${Date.now()}-${idx}`,
      file,
      status: "queued",
      uploadProgress: 0,
      analyticsProgress: 0,
      transcript: "",
      segments: [],
      analysis: null,
      hasCEDefect: false,
      nceDefects: 0,
      error: null,
    }));

    items.value = nextItems;
    selectedItemId.value = nextItems[0]?.id ?? null;
    isRunning.value = true;

    await syncBatch();
    startRealtime();
  } catch (error) {
    console.error(error);
    alert("Failed to start batch processing. See console.");
    isRunning.value = false;
  }
};

onUnmounted(() => {
  stopRealtime();
});
</script>

<template>
  <section class="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-5">
    <div class="flex flex-wrap gap-3 items-center justify-between mb-4">
      <div>
        <p class="text-xs uppercase tracking-[0.24em] text-cyan-100/70">Batch Upload QA</p>
        <h2 class="text-xl text-white font-semibold title-font">Batch QA Score Card</h2>
      </div>

      <div class="flex items-center gap-3">
        <AudioUploader
          :is-processing="isRunning"
          :multiple="true"
          button-label="Upload Batch Recordings"
          @files-selected="handleFilesSelect"
        />
      </div>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <button
        type="button"
        class="px-3 py-2 rounded-lg border text-sm font-medium"
        :class="
          batchCallType === 'inbound'
            ? 'bg-cyan-950/40 border-cyan-400/60 text-cyan-200'
            : 'bg-slate-900/40 border-slate-700/60 text-slate-400'
        "
        @click="batchCallType = 'inbound'"
      >
        Inbound Matrix
      </button>
      <button
        type="button"
        class="px-3 py-2 rounded-lg border text-sm font-medium"
        :class="
          batchCallType === 'outbound'
            ? 'bg-cyan-950/40 border-cyan-400/60 text-cyan-200'
            : 'bg-slate-900/40 border-slate-700/60 text-slate-400'
        "
        @click="batchCallType = 'outbound'"
      >
        Outbound Matrix
      </button>
    </div>

    <div v-if="!hasApiKeys" class="rounded-xl border border-amber-300/40 bg-amber-300/12 p-4 mb-4">
      <h3 class="text-amber-200 font-semibold mb-1">Missing Backend Config</h3>
      <p class="text-sm text-amber-200/70">Login first and pick active tenant/project in Manage page.</p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
      <div class="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
        <div class="flex justify-between text-xs text-slate-300 mb-2">
          <span>Upload Progress</span>
          <span>{{ uploadOverallProgress.toFixed(0) }}%</span>
        </div>
        <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
          <div class="h-full bg-cyan-400 transition-all" :style="{ width: `${uploadOverallProgress}%` }"></div>
        </div>
      </div>
      <div class="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3">
        <div class="flex justify-between text-xs text-slate-300 mb-2">
          <span>Analytics Progress</span>
          <span>{{ analyticsOverallProgress.toFixed(0) }}%</span>
        </div>
        <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
          <div class="h-full bg-emerald-400 transition-all" :style="{ width: `${analyticsOverallProgress}%` }"></div>
        </div>
      </div>
    </div>

    <div class="rounded-xl border border-slate-700/60 overflow-hidden">
      <table class="w-full text-sm">
        <tbody class="bg-slate-900/50">
          <tr class="border-b border-slate-700/60"><td class="px-3 py-2 text-slate-300">Total Samples</td><td class="px-3 py-2 text-right text-emerald-300 font-semibold">{{ totalSamples }}</td></tr>
          <tr class="border-b border-slate-700/60">
            <td class="px-3 py-2 text-slate-300">NCE Parameters</td>
            <td class="px-3 py-2 text-right">
              <input
                v-model.number="nceParameterInput"
                type="number"
                min="1"
                class="w-20 text-right px-2 py-1 rounded-md border border-slate-600 bg-emerald-400/20 text-emerald-200 font-semibold"
              />
            </td>
          </tr>
          <tr class="border-b border-slate-700/60"><td class="px-3 py-2 text-slate-300">Samples with CE Defect</td><td class="px-3 py-2 text-right text-amber-300 font-semibold">{{ ceDefectSamples }}</td></tr>
          <tr class="border-b border-slate-700/60"><td class="px-3 py-2 text-slate-300">Total NCE Defects</td><td class="px-3 py-2 text-right text-amber-300 font-semibold">{{ totalNCEDefects }}</td></tr>
          <tr class="border-b border-slate-700/60"><td class="px-3 py-2 text-slate-300">Total Opportunity</td><td class="px-3 py-2 text-right text-slate-200 font-semibold">{{ totalOpportunities }}</td></tr>
          <tr class="border-b border-slate-700/60"><td class="px-3 py-2 text-slate-300">CE Accuracy</td><td class="px-3 py-2 text-right text-cyan-200 font-semibold">{{ formatPercent(ceAccuracy) }}</td></tr>
          <tr class="border-b border-slate-700/60"><td class="px-3 py-2 text-slate-300">NCE Accuracy</td><td class="px-3 py-2 text-right text-cyan-200 font-semibold">{{ formatPercent(nceAccuracy) }}</td></tr>
          <tr><td class="px-3 py-2 text-yellow-200 font-semibold">Integrated QA Score</td><td class="px-3 py-2 text-right font-bold" :class="targetMet ? 'text-emerald-300' : 'text-rose-300'">{{ formatPercent(integratedQAScore) }}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="text-xs text-slate-400 mt-2">Target benchmark: {{ QA_TARGET_PERCENT.toFixed(1) }}%. Total samples follow your uploaded recording count.</p>
  </section>

  <div class="grid grid-cols-1 xl:grid-cols-12 gap-6 flex-1 min-h-0">
    <aside class="xl:col-span-4 min-h-0 rounded-xl border border-white/10 bg-slate-900/50 p-4 overflow-y-auto">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2 text-cyan-100"><Files class="w-4 h-4" /><span class="text-xs uppercase tracking-[0.2em]">Recordings</span></div>
        <span class="text-xs text-slate-400">{{ items.length }} files</span>
      </div>

      <div v-if="!items.length" class="h-40 border border-dashed border-slate-700 rounded-lg flex items-center justify-center text-sm text-slate-400">
        <div class="text-center"><UploadCloud class="w-6 h-6 mx-auto mb-2" />Upload files to start batch analysis</div>
      </div>

      <div v-else class="space-y-2">
        <button
          v-for="item in items"
          :key="item.id"
          class="w-full text-left p-3 rounded-lg border border-slate-700/60 bg-slate-900/40 hover:border-cyan-400/40"
          :class="{ 'ring-1 ring-cyan-400/60': selectedItemId === item.id }"
          @click="selectedItemId = item.id"
        >
          <div class="flex justify-between gap-2">
            <p class="text-sm text-slate-100 break-all">{{ item.file.name }}</p>
            <span class="text-[10px] uppercase text-slate-400">{{ statusLabel[item.status] }}</span>
          </div>
          <div class="mt-1 text-xs text-slate-400">Upload {{ item.uploadProgress.toFixed(0) }}% | Analytics {{ item.analyticsProgress.toFixed(0) }}%</div>
          <div v-if="item.status === 'completed'" class="mt-1 text-xs text-slate-300">
            CE: {{ item.hasCEDefect ? "Defect" : "Pass" }} | NCE Defects: {{ item.nceDefects }}
          </div>
          <p v-if="item.error" class="mt-1 text-xs text-rose-300">{{ item.error }}</p>
        </button>
      </div>
    </aside>

    <section class="xl:col-span-8 flex flex-col min-h-0">
      <template v-if="selectedItem && selectedItem.status === 'completed' && selectedItem.analysis">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1 min-h-0">
          <div class="flex flex-col h-full min-h-0 transition-all duration-300 ease-in-out" :class="{ hidden: maximizedPanel === 'analysis', 'col-span-1 lg:col-span-2': maximizedPanel === 'transcript' }">
            <TranscriptViewer
              :transcript="selectedItem.transcript"
              :segments="selectedItem.segments"
              :file="selectedItem.file"
              :is-maximized="maximizedPanel === 'transcript'"
              @toggle-maximize="toggleMaximize('transcript')"
            />
          </div>
          <div class="flex flex-col h-full min-h-0 transition-all duration-300 ease-in-out" :class="{ hidden: maximizedPanel === 'transcript', 'col-span-1 lg:col-span-2': maximizedPanel === 'analysis' }">
            <AnalysisPanel
              :analysis="selectedItem.analysis"
              :is-maximized="maximizedPanel === 'analysis'"
              @toggle-maximize="toggleMaximize('analysis')"
            />
          </div>
        </div>
      </template>

      <div v-else class="state-card state-card-empty">
        <ListChecks class="w-10 h-10 text-cyan-200/40 mb-3" />
        <p class="text-slate-200 text-center font-medium">Select a processed recording to see transcript and QA matrix</p>
      </div>
    </section>
  </div>

  <div v-if="isConfirming" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
    <div class="bg-slate-950/95 border border-cyan-300/20 rounded-2xl max-w-xl w-full p-6 shadow-2xl popup-in">
      <h3 class="text-xl font-semibold text-white mb-2 text-center title-font">Start Batch Analysis?</h3>
      <p class="text-slate-300 text-sm text-center mb-3">{{ pendingFiles.length }} recordings selected</p>
      <div class="max-h-32 overflow-y-auto rounded-lg border border-slate-700/60 bg-slate-900/55 p-3 mb-4">
        <p v-for="pending in pendingFiles" :key="pending.name + pending.size" class="text-xs text-slate-300 truncate">{{ pending.name }}</p>
      </div>
      <div class="flex gap-3">
        <button @click="isConfirming = false" class="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800/70 text-sm">Cancel</button>
        <button @click="startBatchRun" class="flex-1 px-4 py-2.5 rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-semibold text-sm">Start Batch Run</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.state-card {
  min-height: 17rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: linear-gradient(
    180deg,
    rgba(15, 23, 42, 0.8),
    rgba(2, 6, 23, 0.88)
  );
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.state-card-empty {
  border-style: dashed;
}

.popup-in {
  animation: popupIn 0.22s ease-out;
}

@keyframes popupIn {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
