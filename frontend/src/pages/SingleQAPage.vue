<script setup lang="ts">
import { onUnmounted, ref, computed } from "vue";
import { Mic, Sparkles, ShieldCheck, Activity } from "lucide-vue-next";
import AudioUploader from "../components/AudioUploader.vue";
import TranscriptViewer from "../components/TranscriptViewer.vue";
import AnalysisPanel from "../components/AnalysisPanel.vue";
import {
  connectWs,
  createBatch,
  getJob,
  subscribeBatch,
  subscribeJob,
} from "../services/backendApi";
import { useSession } from "../services/session";

const file = ref<File | null>(null);
const transcript = ref<string>("");
const segments = ref<any[]>([]);
const analysis = ref<any>(null);

const isTranscribing = ref(false);
const isAnalyzing = ref(false);
const isConfirming = ref(false);
const pendingFile = ref<File | null>(null);
const callType = ref<"inbound" | "outbound">("inbound");

const maximizedPanel = ref<"transcript" | "analysis" | null>(null);

const batchId = ref<string | null>(null);
const jobId = ref<string | null>(null);
let pollTimer: number | null = null;
let ws: WebSocket | null = null;

const session = useSession();
const tenantId = computed(() => session.tenantId.value || "");
const projectId = computed(() => session.projectId.value || "");

const handleFileSelect = (selectedFile: File) => {
  pendingFile.value = selectedFile;
  isConfirming.value = true;
};

const cancelProcessing = () => {
  pendingFile.value = null;
  isConfirming.value = false;
};

const toggleMaximize = (panel: "transcript" | "analysis") => {
  maximizedPanel.value = maximizedPanel.value === panel ? null : panel;
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

const syncJob = async () => {
  if (!jobId.value) return;
  const detail = await getJob(jobId.value);

  segments.value = detail.segments.map((seg: any) => ({
    start: seg.startSec,
    end: seg.endSec,
    text: seg.rawText,
    speakerId: seg.speakerId,
    role: seg.role,
    cleaned_text: seg.cleanedText,
    sentiment: seg.sentiment,
    words: seg.wordsJson,
  }));
  transcript.value = detail.transcript || segments.value.map((s: any) => s.cleaned_text || s.text).join(" ");
  analysis.value = detail.analysis;

  isTranscribing.value = detail.status === "transcribing" || detail.status === "uploading" || detail.status === "queued";
  isAnalyzing.value = detail.status === "analyzing";

  if (detail.status === "completed" || detail.status === "failed") {
    stopRealtime();
    isTranscribing.value = false;
    isAnalyzing.value = false;
    if (detail.status === "failed") {
      alert(detail.errorMessage || "Failed to process audio.");
    }
  }
};

const startRealtime = () => {
  if (!jobId.value || !batchId.value) return;

  try {
    ws = connectWs((event: any) => {
      if (event.batchId !== batchId.value && event.jobId !== jobId.value) return;
      void syncJob();
    });
    ws.onopen = () => {
      if (!ws || !jobId.value || !batchId.value) return;
      subscribeBatch(ws, batchId.value);
      subscribeJob(ws, jobId.value);
    };
  } catch {
    // Polling remains active if websocket fails.
  }

  pollTimer = window.setInterval(() => {
    void syncJob();
  }, 2000);
};

const startProcessing = async () => {
  if (!pendingFile.value) return;
  if (!tenantId.value || !projectId.value) {
    alert("Select tenant and project from Manage page first.");
    return;
  }

  const selectedFile = pendingFile.value;
  isConfirming.value = false;

  file.value = selectedFile;
  transcript.value = "";
  segments.value = [];
  analysis.value = null;
  maximizedPanel.value = null;
  stopRealtime();

  isTranscribing.value = true;
  isAnalyzing.value = false;

  try {
    const created = await createBatch({
      tenantId: tenantId.value,
      projectId: projectId.value,
      callType: callType.value,
      files: [selectedFile],
    });

    batchId.value = created.batchId;
    jobId.value = created.jobIds[0] || null;

    await syncJob();
    startRealtime();
  } catch (err) {
    console.error(err);
    alert("Error starting backend processing. See console.");
    isTranscribing.value = false;
    isAnalyzing.value = false;
  }
};

const hasBackendConfig = computed(() => {
  const hasToken = !!session.token.value;
  return !!import.meta.env.VITE_API_BASE_URL && !!tenantId.value && !!projectId.value && hasToken;
});

onUnmounted(() => {
  stopRealtime();
});
</script>

<template>
  <section class="mb-6 rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-md p-5 sm:p-6">
    <div class="flex flex-wrap gap-3 items-start justify-between">
      <div>
        <p class="text-xs uppercase tracking-[0.24em] text-cyan-100/70">Single QA Workspace</p>
        <h2 class="mt-1 text-2xl sm:text-3xl text-white font-semibold title-font">Turn raw calls into QA-ready insights</h2>
        <p class="mt-2 text-sm text-slate-300/90 max-w-2xl">
          Upload one support call and get a synced transcript, role-aware cleanup, sentiment hints, and structured coaching notes.
        </p>
      </div>

      <div class="flex flex-col items-end gap-3">
        <AudioUploader
          @file-selected="handleFileSelect"
          :is-processing="isTranscribing || isAnalyzing"
          button-label="Upload Single Audio"
        />
        <div class="flex gap-2 flex-wrap justify-end">
          <div class="pill"><Sparkles class="w-4 h-4" /><span>Auto Cleanup</span></div>
          <div class="pill"><ShieldCheck class="w-4 h-4" /><span>QA Matrix</span></div>
          <div class="pill"><Activity class="w-4 h-4" /><span>Sentiment Cues</span></div>
        </div>
      </div>
    </div>
  </section>

  <div
    v-if="!hasBackendConfig"
    class="mb-6 rounded-xl border border-amber-300/40 bg-amber-300/12 p-4"
  >
    <h3 class="text-amber-200 font-semibold mb-1">Missing Backend Config</h3>
    <p class="text-sm text-amber-200/70">Configure API URL and select tenant/project from Manage page, then login.</p>
  </div>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[60vh]">
    <div
      class="flex flex-col h-full min-h-0 transition-all duration-300 ease-in-out"
      :class="{
        hidden: maximizedPanel === 'analysis',
        'col-span-1 lg:col-span-2': maximizedPanel === 'transcript',
      }"
    >
      <TranscriptViewer
        v-if="transcript"
        :transcript="transcript"
        :segments="segments"
        :file="file"
        :is-maximized="maximizedPanel === 'transcript'"
        @toggle-maximize="toggleMaximize('transcript')"
      />

      <div v-else-if="file && isTranscribing" class="state-card">
        <div class="scanner"></div>
        <p class="text-base text-slate-100 font-medium">Transcribing audio...</p>
        <p class="text-xs text-slate-400 mt-1">Detecting speaker turns and timestamps</p>
      </div>

      <div v-else class="state-card state-card-empty">
        <Mic class="w-14 h-14 text-cyan-200/40 mb-4" />
        <p class="text-slate-200 text-center font-medium">Upload an audio file to get started</p>
        <p class="text-xs text-slate-400 mt-1">Supported: mp3, wav, m4a (max 50MB)</p>
      </div>
    </div>

    <div
      class="flex flex-col h-full min-h-0 transition-all duration-300 ease-in-out"
      :class="{
        hidden: maximizedPanel === 'transcript',
        'col-span-1 lg:col-span-2': maximizedPanel === 'analysis',
      }"
    >
      <AnalysisPanel
        v-if="analysis"
        :analysis="analysis"
        :is-maximized="maximizedPanel === 'analysis'"
        @toggle-maximize="toggleMaximize('analysis')"
      />

      <div v-else-if="transcript && isAnalyzing" class="state-card">
        <div class="scanner"></div>
        <p class="text-base text-slate-100 font-medium">Analyzing transcript...</p>
        <p class="text-xs text-slate-400 mt-1">Building QA scorecard and coaching cues</p>
      </div>

      <div v-else class="state-card state-card-empty">
        <p class="text-slate-200 text-center font-medium">Analysis will appear here</p>
        <p class="text-xs text-slate-400 mt-1">Summary, matrix, strengths and improvements</p>
      </div>
    </div>
  </div>

  <div
    v-if="isConfirming"
    class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
  >
    <div class="bg-slate-950/95 border border-cyan-300/20 rounded-2xl max-w-md w-full p-6 shadow-2xl popup-in">
      <div class="flex flex-col gap-4">
        <div class="w-12 h-12 rounded-full bg-cyan-400/20 flex items-center justify-center self-center mb-2 border border-cyan-300/30">
          <Mic class="w-6 h-6 text-cyan-300" />
        </div>

        <div class="text-center">
          <h3 class="text-xl font-semibold text-white mb-2 title-font">Ready to Analyze?</h3>
          <p class="text-slate-300 text-sm mb-4">You selected <strong class="text-slate-200">{{ pendingFile?.name }}</strong></p>

          <div class="grid grid-cols-2 gap-3 text-sm">
            <button
              type="button"
              @click="callType = 'inbound'"
              class="px-3 py-3 rounded-xl border transition-all duration-200 font-medium"
              :class="
                callType === 'inbound'
                  ? 'bg-cyan-950/40 border-cyan-400/50 text-cyan-200'
                  : 'bg-slate-900/40 border-slate-700/50 text-slate-400'
              "
            >
              Inbound
            </button>
            <button
              type="button"
              @click="callType = 'outbound'"
              class="px-3 py-3 rounded-xl border transition-all duration-200 font-medium"
              :class="
                callType === 'outbound'
                  ? 'bg-cyan-950/40 border-cyan-400/50 text-cyan-200'
                  : 'bg-slate-900/40 border-slate-700/50 text-slate-400'
              "
            >
              Outbound
            </button>
          </div>
        </div>

        <div class="flex gap-3 mt-2">
          <button
            @click="cancelProcessing"
            class="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800/70 transition-colors font-medium text-sm"
          >
            Cancel
          </button>
          <button
            @click="startProcessing"
            class="flex-1 px-4 py-2.5 rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors font-semibold text-sm"
          >
            Start Analysis
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.title-font {
  font-family: var(--font-display);
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.7rem;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.45);
  color: rgba(224, 242, 254, 0.95);
  font-size: 0.74rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.state-card {
  min-height: 17rem;
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.8), rgba(2, 6, 23, 0.88));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.state-card-empty {
  border-style: dashed;
}

.scanner {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 999px;
  border: 4px solid rgba(30, 41, 59, 1);
  border-top-color: rgba(34, 211, 238, 0.95);
  animation: spin 0.95s linear infinite;
  margin-bottom: 0.8rem;
}

.popup-in {
  animation: popupIn 0.22s ease-out;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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
