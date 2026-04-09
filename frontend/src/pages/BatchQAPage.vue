<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { toast } from "vue-sonner";
import {
  AlertTriangle,
  ArrowRight,
  FileText,
  History,
  Image as ImageIcon,
  Lock,
  SlidersHorizontal,
  Table2,
  Trash2,
} from "lucide-vue-next";
import AudioUploader from "../components/AudioUploader.vue";
import AnalysisPanel from "../components/AnalysisPanel.vue";
import TranscriptViewer from "../components/TranscriptViewer.vue";
import {
  canDeleteBatch as canDeleteBatchItem,
  defaultBatchName,
  loadBatchNameMap,
  persistBatchNameMap,
  resolveBatchDisplayName,
} from "../composables/useBatchHistory";
import {
  runWithConcurrency,
  toTranscriptSegments,
} from "../composables/useJobDetail";
import {
  hasMissingScoreNotes as hasMissingScoreNotesInEdits,
  hasScoreChanges as hasScoreChangesInEdits,
} from "../composables/useScoreEditing";
import {
  getRealtimePollingInterval,
  isRealtimeJobEvent,
} from "../composables/useBatchRealtime";
import {
  analyzeBatchNow,
  connectWs,
  createProjectBatch,
  deleteBatch,
  deleteJob,
  getBatch,
  getJob,
  getJobAudioBlobUrl,
  getProjectBatchSummary,
  listJobScoreHistory,
  getActiveMatrixVersion,
  listProjectBatches,
  listProjects,
  listTenants,
  retryJob,
  updateJobScores,
  uploadBatchFiles,
  updateBatchName,
  getAuthMeCached,
  subscribeBatch,
  subscribeJob,
  type BatchHistoryItem,
  type BatchDetail,
  type JobDetail,
  type JobScoreHistoryEntry,
  type Project,
  type Tenant,
} from "../services/backendApi";
import { useSession } from "../services/session";

const session = useSession();
const route = useRoute();
const router = useRouter();

const tenants = ref<Tenant[]>([]);
const projects = ref<Project[]>([]);
const history = ref<BatchHistoryItem[]>([]);
const tenantPreviewStats = ref<
  Record<
    string,
    {
      projects: number;
      batches: number;
      recordings: number;
      completed: number;
      failed: number;
      inProgress: number;
    }
  >
>({});
const loadingTenantPreviewStats = ref(false);
const batchDetails = ref<BatchDetail | null>(null);
const selectedJobId = ref("");
const selectedJobDetail = ref<JobDetail | null>(null);
const loadingJobDetail = ref(false);
const selectedJobAudioUrl = ref<string | null>(null);
const resultTranscriptRef = ref<{ seekTo: (seconds: number) => void } | null>(
  null,
);

const jobsWithAnalysis = ref<Record<string, any>>({});
const activeMatrixRows = ref<any[]>([]);

const selectedTenantId = ref("");
const selectedProjectId = ref("");
const selectedBatchId = ref("");
const showWorkspace = ref(false);
const showCreateBatchModal = ref(false);
const showResultModal = ref(false);

const batchName = ref("");
const loading = ref(false);
const creatingBatch = ref(false);
const uploading = ref(false);
const loadingHistory = ref(false);
const checkingMatrix = ref(false);
const hasMatrixForProject = ref(true);
const matrixMessage = ref("");
const requestingAnalyze = ref(false);
const lockedBatchId = ref("");
const canManageJobs = ref(false);
const canManageScores = ref(false);
const canViewMatrices = ref(false);
const isSuperAdmin = ref(false);
const resultModalTab = ref<"result" | "history">("result");
const resultDetailTab = ref<"matrix" | "manual">("matrix");
const scoreEdits = ref<Record<string, { score: number; note: string }>>({});
const addScoreEditsToRag = ref(true);
const savingScoreEdits = ref(false);
const scoreHistory = ref<JobScoreHistoryEntry[]>([]);
const loadingScoreHistory = ref(false);
const scoreHistoryLoadedForJobId = ref("");
const showConfirmModal = ref(false);
const confirmTitle = ref("");
const confirmMessage = ref("");
const confirmBusy = ref(false);
let confirmAction: null | (() => Promise<void>) = null;

let ws: WebSocket | null = null;
let pollTimer: number | null = null;
let batchRefreshTimer: number | null = null;
let realtimeBatchId = "";
let isWsConnected = false;
let hasStableWsConnection = false;
let selectedJobAudioAbortController: AbortController | null = null;
let selectedJobAudioRequestId = 0;
let suppressSelectedJobWatcher = false;
const jobFailureAlerts = new Map<string, string>();
const JOB_HYDRATION_CONCURRENCY = 5;
const hydratingJobIds = new Set<string>();

const batchNamesById = ref<Record<string, string>>({});
const BATCH_NAME_KEY = "qa_batch_names_v1";
const syncedBatchNameIds = new Set<string>();
const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001"
).replace(/\/$/, "");
const logoBgColors = ref<Record<string, string>>({});
const isDev = import.meta.env.DEV;
const debugError = (...args: unknown[]) => {
  if (!isDev) return;
  console.error(...args);
};

const resolveTenantLogoUrl = (logoUrl?: string | null) => {
  if (!logoUrl) return "";
  if (logoUrl.startsWith("http://") || logoUrl.startsWith("https://")) {
    return logoUrl;
  }
  return `${apiBaseUrl}${logoUrl.startsWith("/") ? logoUrl : `/${logoUrl}`}`;
};

const getLogoBgStyle = (src: string) => ({
  backgroundColor: logoBgColors.value[src] || "rgba(2, 6, 23, 0.65)",
});

const applyDominantLogoColor = (event: Event) => {
  const img = event.target as HTMLImageElement;
  const src = img.currentSrc || img.src;
  if (!src || logoBgColors.value[src]) return;

  try {
    const canvas = document.createElement("canvas");
    const size = 24;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] ?? 0;
      if (alpha < 40) continue;
      rSum += data[i] ?? 0;
      gSum += data[i + 1] ?? 0;
      bSum += data[i + 2] ?? 0;
      count += 1;
    }
    if (!count) return;

    const r = Math.round(rSum / count);
    const g = Math.round(gSum / count);
    const b = Math.round(bSum / count);
    logoBgColors.value[src] = `rgba(${r}, ${g}, ${b}, 0.3)`;
  } catch {
    // Ignore extraction errors (for example, tainted canvas).
  }
};

const selectedTenant = computed(
  () =>
    tenants.value.find((tenant) => tenant.id === selectedTenantId.value) ||
    null,
);
const selectedProject = computed(
  () =>
    projects.value.find((project) => project.id === selectedProjectId.value) ||
    null,
);
const projectDailyUploadLimit = computed(() =>
  Math.max(1, Number(selectedProject.value?.dailyUploadLimit || 100)),
);
const projectDailyUploadCount = computed(() =>
  Math.max(0, Number(selectedProject.value?.dailyUploadCount || 0)),
);
const projectDailyUploadRemaining = computed(() =>
  Math.max(0, projectDailyUploadLimit.value - projectDailyUploadCount.value),
);
const isDailyUploadLimitReached = computed(
  () =>
    Boolean(selectedProject.value) &&
    projectDailyUploadCount.value >= projectDailyUploadLimit.value,
);
const showProjectSelector = computed(() => projects.value.length !== 1);
const workspaceTitle = computed(() => {
  const tenantName = selectedTenant.value?.name || "Tenant Workspace";
  if (!showProjectSelector.value && selectedProject.value?.name) {
    return `${tenantName} - ${selectedProject.value.name}`;
  }
  return tenantName;
});
const selectedBatchJobs = computed(
  () =>
    (batchDetails.value?.jobs || []) as Array<{
      id: string;
      fileName: string;
      status: string;
      progress: number;
      errorMessage?: string | null;
    }>,
);
const jobsPageSize = 8;
const jobsCurrentPage = ref(1);
const jobsTotalPages = computed(() =>
  Math.max(1, Math.ceil(selectedBatchJobs.value.length / jobsPageSize)),
);
const pagedBatchJobs = computed(() => {
  const start = (jobsCurrentPage.value - 1) * jobsPageSize;
  return selectedBatchJobs.value.slice(start, start + jobsPageSize);
});
const jobsPageNumbers = computed(() =>
  Array.from({ length: jobsTotalPages.value }, (_, i) => i + 1),
);
const selectedJobMeta = computed(
  () =>
    selectedBatchJobs.value.find((job) => job.id === selectedJobId.value) ||
    null,
);
const normalizeJobErrorMessage = (message?: string | null) =>
  String(message || "").replace(/\s+/g, " ").trim();
const getJobFailurePreview = (job: { errorMessage?: string | null }) => {
  const message = normalizeJobErrorMessage(job.errorMessage);
  if (!message) return "Processing failed.";
  return message.length > 140 ? `${message.slice(0, 137)}...` : message;
};
const transcriptSegments = computed(() => {
  const segments = selectedJobDetail.value?.segments || [];
  return toTranscriptSegments(segments as any[]);
});
const resultScoreRows = computed(
  () => selectedJobDetail.value?.analysis?.evaluation_table || [],
);
const hasScoreChanges = computed(() =>
  hasScoreChangesInEdits(resultScoreRows.value as any, scoreEdits.value),
);
const hasMissingScoreNotes = computed(() =>
  hasMissingScoreNotesInEdits(resultScoreRows.value as any, scoreEdits.value),
);
const canSubmitScoreEdits = computed(
  () =>
    canManageScores.value &&
    !isBatchViewOnlyLocked.value &&
    !savingScoreEdits.value &&
    selectedJobDetail.value?.status === "completed" &&
    hasScoreChanges.value &&
    !hasMissingScoreNotes.value,
);
const batchDashboard = computed(() => {
  const total = selectedBatchJobs.value.length;
  const completed = selectedBatchJobs.value.filter(
    (job) => job.status === "completed",
  ).length;
  const failed = selectedBatchJobs.value.filter(
    (job) => job.status === "failed",
  ).length;
  const running = selectedBatchJobs.value.filter((job) =>
    ["uploading", "transcribing", "analyzing"].includes(job.status),
  ).length;
  const queued = selectedBatchJobs.value.filter(
    (job) => job.status === "queued",
  ).length;
  const progress = total ? Math.round(((completed + failed) / total) * 100) : 0;
  return { total, completed, failed, running, queued, progress };
});

const ceNceScores = computed(() => {
  const matrixNceParametersCount = activeMatrixRows.value.filter(
    (r) => String(r.parameter || "").toUpperCase() === "NCE",
  ).length;
  const derivedNceParametersCountFromResults = Math.max(
    0,
    ...selectedBatchJobs.value
      .filter((job) => job.status === "completed")
      .map((job) => {
        const detail = jobsWithAnalysis.value[job.id];
        const table = detail?.analysis?.evaluation_table || [];
        return table.filter(
          (row: any) => String(row.parameter || "").toUpperCase() === "NCE",
        ).length;
      }),
  );
  const nceParametersCount =
    matrixNceParametersCount > 0
      ? matrixNceParametersCount
      : derivedNceParametersCountFromResults;

  const totalSamples =
    batchDashboard.value.completed + batchDashboard.value.failed;
  const totalOpportunities = totalSamples * nceParametersCount;

  let ceDefectSamples = 0;
  let totalNCEDefects = 0;

  for (const job of selectedBatchJobs.value) {
    if (job.status === "failed") {
      ceDefectSamples += 1;
      totalNCEDefects += nceParametersCount;
      continue;
    }

    if (job.status === "completed") {
      const detail = jobsWithAnalysis.value[job.id];
      if (detail && detail.analysis?.evaluation_table) {
        let hasCE = false;
        let jobNCEDefects = 0;

        for (const row of detail.analysis.evaluation_table) {
          const parameter = String(row.parameter || "").toUpperCase();
          const score = Number(row.score ?? 0);
          const maxScore = Number(row.max_score ?? 0);
          if (
            parameter === "CE" &&
            Number.isFinite(score) &&
            Number.isFinite(maxScore) &&
            score < maxScore
          ) {
            hasCE = true;
          }
          if (
            parameter === "NCE" &&
            Number.isFinite(score) &&
            Number.isFinite(maxScore) &&
            score < maxScore
          ) {
            jobNCEDefects += 1;
          }
        }

        if (hasCE) {
          ceDefectSamples += 1;
        }
        totalNCEDefects += jobNCEDefects;
      }
    }
  }

  const ceAccuracy =
    totalSamples > 0
      ? ((totalSamples - ceDefectSamples) / totalSamples) * 100
      : 0;
  const nceAccuracy =
    totalOpportunities > 0
      ? ((totalOpportunities - totalNCEDefects) / totalOpportunities) * 100
      : 0;

  const integratedQAScore =
    totalSamples > 0 ? ceAccuracy * 0.6 + nceAccuracy * 0.4 : 0;

  return {
    ceDefectSamples,
    totalNCEDefects,
    nceParametersCount,
    ceAccuracy: ceAccuracy.toFixed(2),
    nceAccuracy: nceAccuracy.toFixed(2),
    integratedQAScore: integratedQAScore.toFixed(2),
    targetMet: integratedQAScore >= 90,
  };
});

const inferredCallType = computed<"inbound" | "outbound">(() => {
  if (selectedProject.value?.supportsInbound) return "inbound";
  return "outbound";
});
const hasRunningJobs = computed(() =>
  selectedBatchJobs.value.some((job) =>
    ["uploading", "transcribing", "analyzing"].includes(job.status),
  ),
);
const hasQueuedJobs = computed(() =>
  selectedBatchJobs.value.some((job) => job.status === "queued"),
);
const selectedHistoryBatch = computed(
  () =>
    history.value.find((batch) => batch.id === selectedBatchId.value) || null,
);
const selectedBatchCreatorName = computed(() => {
  const name =
    selectedHistoryBatch.value?.createdByFullname ||
    batchDetails.value?.createdByFullname ||
    "";
  return String(name || "User");
});
const liveQaDashboardTitle = computed(() =>
  selectedBatchId.value
    ? `Live QA Dashboard | Created by ${selectedBatchCreatorName.value}`
    : "Live QA Dashboard",
);
const isBatchViewOnlyLocked = computed(() =>
  Boolean(selectedHistoryBatch.value?.isLocked ?? batchDetails.value?.isLocked),
);
const selectedBatchLockAt = computed(
  () => selectedHistoryBatch.value?.lockAt || batchDetails.value?.lockAt || "",
);
const selectedBatchLockDays = computed(() =>
  Number(
    selectedHistoryBatch.value?.lockDays ||
      selectedProject.value?.batchHistoryLockDays ||
      2,
  ),
);
const isBatchLocked = computed(() => {
  if (!selectedBatchId.value) return true;
  const lockApplies = lockedBatchId.value === selectedBatchId.value;
  return (
    isBatchViewOnlyLocked.value ||
    uploading.value ||
    requestingAnalyze.value ||
    hasRunningJobs.value ||
    (lockApplies && hasQueuedJobs.value)
  );
});
const uploadBlockedMessage = computed(() => {
  if (!selectedBatchId.value) {
    return "Create or select a batch first";
  }
  if (!canManageJobs.value) {
    return "You do not have permission to upload recordings";
  }
  if (isBatchViewOnlyLocked.value) {
    return "This batch is locked and now view-only";
  }
  if (isDailyUploadLimitReached.value) {
    return `Daily project limit reached (${projectDailyUploadCount.value}/${projectDailyUploadLimit.value})`;
  }
  if (isBatchLocked.value) {
    return "Uploads are temporarily unavailable while this batch is processing";
  }
  return "Upload is currently unavailable";
});

const normalizeUuidParam = (value: unknown) => {
  const raw =
    typeof value === "string" ? value : Array.isArray(value) ? value[0] : "";
  if (!raw) return "";
  const clean = raw.replace(/[^a-fA-F0-9-]/g, "").toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    clean,
  )
    ? clean
    : "";
};

const loadBatchNames = () => {
  batchNamesById.value = loadBatchNameMap(BATCH_NAME_KEY);
};

const saveBatchName = (batchId: string, name: string) => {
  batchNamesById.value = { ...batchNamesById.value, [batchId]: name.trim() };
  persistBatchNameMap(BATCH_NAME_KEY, batchNamesById.value);
};

const syncCachedBatchNamesToDb = async (items: BatchHistoryItem[]) => {
  if (!canManageJobs.value) return;
  const pending = items.filter((item) => {
    const dbName = String(item.name || "").trim();
    if (dbName) return false;
    const cachedName = String(batchNamesById.value[item.id] || "").trim();
    if (!cachedName) return false;
    return !syncedBatchNameIds.has(item.id);
  });

  for (const item of pending) {
    const cachedName = String(batchNamesById.value[item.id] || "").trim();
    if (!cachedName) continue;
    try {
      await updateBatchName({ batchId: item.id, name: cachedName });
      syncedBatchNameIds.add(item.id);
      item.name = cachedName;
    } catch (error) {
      debugError("Failed to sync cached batch name to DB", {
        batchId: item.id,
        error,
      });
    }
  }
};

const getBatchName = (batch: BatchHistoryItem) => {
  return resolveBatchDisplayName(batch, batchNamesById.value);
};

const canDeleteBatch = (batch: BatchHistoryItem) => {
  return canDeleteBatchItem(batch, isSuperAdmin.value);
};

const syncRoute = async () => {
  const currentTenant = normalizeUuidParam(route.query.tenant);
  const currentProject = normalizeUuidParam(route.query.project);
  const currentBatch = normalizeUuidParam(route.query.batch);

  const nextTenant = showWorkspace.value ? selectedTenantId.value || "" : "";
  const nextProject = showWorkspace.value ? selectedProjectId.value || "" : "";
  const nextBatch =
    showWorkspace.value && selectedProjectId.value
      ? selectedBatchId.value || ""
      : "";

  if (
    currentTenant === nextTenant &&
    currentProject === nextProject &&
    currentBatch === nextBatch
  ) {
    return;
  }

  await router.replace({
    path: "/batch",
    query: {
      tenant: nextTenant || undefined,
      project: nextProject || undefined,
      batch: nextBatch || undefined,
    },
  });
};

const loadTenants = async () => {
  loading.value = true;
  try {
    const loaded = await listTenants();
    tenants.value = loaded;
    void loadTenantPreviewStats(loaded);
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to load tenants",
    );
  } finally {
    loading.value = false;
  }
};

const loadProjectsForTenant = async (tenantId: string) => {
  if (!tenantId) {
    projects.value = [];
    selectedProjectId.value = "";
    return;
  }
  try {
    projects.value = await listProjects(tenantId);
  } catch (error) {
    projects.value = [];
    toast.error(
      error instanceof Error ? error.message : "Failed to load projects",
    );
  }
};

const checkMatrix = async () => {
  hasMatrixForProject.value = true;
  matrixMessage.value = "";
  activeMatrixRows.value = [];

  if (!selectedProject.value) {
    hasMatrixForProject.value = false;
    matrixMessage.value = "Select a project first.";
    return;
  }

  // Read-only QA users without matrix permission should still access history/results
  // without a blocking warning banner.
  if (!canViewMatrices.value && !canManageJobs.value) {
    hasMatrixForProject.value = true;
    matrixMessage.value = "";
    return;
  }

  checkingMatrix.value = true;
  try {
    const activeVersion = await getActiveMatrixVersion(
      selectedProject.value.id,
      inferredCallType.value,
    );
    activeMatrixRows.value = activeVersion.rows || [];
    hasMatrixForProject.value = true;
  } catch (error) {
    hasMatrixForProject.value = false;
    matrixMessage.value =
      error instanceof Error ? error.message : "Failed to load active matrix";
  } finally {
    checkingMatrix.value = false;
  }
};

const loadHistory = async (opts?: {
  silent?: boolean;
  preserveSelection?: boolean;
}) => {
  const previousSelectedBatchId = selectedBatchId.value;
  if (!opts?.preserveSelection) {
    history.value = [];
    selectedBatchId.value = "";
    batchDetails.value = null;
  }

  if (!selectedProjectId.value) return;

  if (!opts?.silent) {
    loadingHistory.value = true;
  }
  try {
    history.value = await listProjectBatches(selectedProjectId.value);
    await syncCachedBatchNamesToDb(history.value);
    if (opts?.preserveSelection && previousSelectedBatchId) {
      const stillExists = history.value.some(
        (item) => item.id === previousSelectedBatchId,
      );
      selectedBatchId.value = stillExists
        ? previousSelectedBatchId
        : history.value[0]?.id || "";
    } else {
      selectedBatchId.value = history.value[0]?.id || "";
    }
  } catch (error) {
    if (!opts?.silent) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load QA history",
      );
    }
  } finally {
    if (!opts?.silent) {
      loadingHistory.value = false;
    }
  }
};

const hydrateCompletedJobDetails = async (targetJobIds?: string[]) => {
  const candidates = (
    targetJobIds?.length
      ? targetJobIds
      : selectedBatchJobs.value
          .filter((job) => job.status === "completed")
          .map((job) => job.id)
  ).filter(
    (jobId, index, array) =>
      array.indexOf(jobId) === index &&
      !jobsWithAnalysis.value[jobId] &&
      !hydratingJobIds.has(jobId),
  );

  if (!candidates.length) return;

  await runWithConcurrency(
    candidates,
    JOB_HYDRATION_CONCURRENCY,
    async (jobId) => {
      hydratingJobIds.add(jobId);
      try {
        const detail = await getJob(jobId);
        jobsWithAnalysis.value = {
          ...jobsWithAnalysis.value,
          [jobId]: detail,
        };
      } catch (error) {
        debugError("Failed to fetch full job detail for calculation", error);
      } finally {
        hydratingJobIds.delete(jobId);
      }
    },
  );
};

const scheduleBatchDetailRefresh = (delayMs = 1_000) => {
  if (batchRefreshTimer) return;
  batchRefreshTimer = window.setTimeout(() => {
    batchRefreshTimer = null;
    void loadSelectedBatchDetail({ silent: true });
  }, delayMs);
};

const applyRealtimeEvent = (event: Record<string, unknown>) => {
  const eventType = String(event.event || "");
  const eventBatchId = String(event.batchId || "");
  if (!eventType || eventBatchId !== selectedBatchId.value || !batchDetails.value) {
    return false;
  }

  if (eventType === "batch.progress") {
    return true;
  }

  if (isRealtimeJobEvent(eventType)) {
    const jobId = String(event.jobId || "");
    if (!jobId) return false;
    const currentJob = batchDetails.value.jobs.find((job) => job.id === jobId);

    const nextStatus =
      typeof event.status === "string" && event.status.trim()
        ? event.status
        : eventType === "job.failed"
          ? "failed"
          : eventType === "job.completed"
            ? "completed"
            : "";
    const nextProgressRaw = Number(event.progress);
    const nextProgress = Number.isFinite(nextProgressRaw)
      ? Math.max(0, Math.min(100, nextProgressRaw))
      : null;
    const nextErrorMessage =
      typeof event.message === "string" ? event.message : null;

    batchDetails.value = {
      ...batchDetails.value,
      jobs: batchDetails.value.jobs.map((job) => {
        if (job.id !== jobId) return job;
        return {
          ...job,
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(nextProgress != null ? { progress: nextProgress } : {}),
          ...(nextErrorMessage != null
            ? { errorMessage: nextErrorMessage }
            : {}),
        };
      }),
    };

    if (selectedJobDetail.value?.id === jobId && nextStatus) {
      selectedJobDetail.value = {
        ...selectedJobDetail.value,
        status: nextStatus,
        ...(nextErrorMessage != null
          ? { errorMessage: nextErrorMessage }
          : {}),
      };
    }

    if (nextStatus === "failed") {
      const jobName = currentJob?.fileName || "Recording";
      const failureMessage =
        normalizeJobErrorMessage(nextErrorMessage) || "Processing failed.";
      const alertKey = `${jobName}:${failureMessage}`;
      if (jobFailureAlerts.get(jobId) !== alertKey) {
        toast.error(`${jobName}: ${failureMessage}`);
        jobFailureAlerts.set(jobId, alertKey);
      }
    } else if (nextStatus) {
      jobFailureAlerts.delete(jobId);
    }

    if (nextStatus === "completed") {
      void hydrateCompletedJobDetails([jobId]);
      if (selectedJobId.value === jobId) {
        void loadSelectedJobDetail({ silent: true, keepContent: true });
      }
    } else if (nextStatus === "failed" && selectedJobId.value === jobId) {
      void loadSelectedJobDetail({ silent: true, keepContent: true });
    }

    return true;
  }

  return false;
};

const loadSelectedBatchDetail = async (opts?: { silent?: boolean }) => {
  if (!selectedBatchId.value) {
    batchDetails.value = null;
    return;
  }
  try {
    batchDetails.value = await getBatch(selectedBatchId.value);
    const jobs = (batchDetails.value?.jobs || []) as Array<{ id: string }>;
    if (!jobs.length) {
      selectedJobId.value = "";
      selectedJobDetail.value = null;
    } else if (
      !selectedJobId.value ||
      !jobs.some((job) => job.id === selectedJobId.value)
    ) {
      const completedFirst = (batchDetails.value?.jobs || []).find(
        (job: any) => job.status === "completed",
      );
      selectedJobId.value = completedFirst?.id || jobs[0]?.id || "";
    }
    const selected = selectedBatchJobs.value.find(
      (job) => job.id === selectedJobId.value,
    );
    if (
      selected &&
      ["completed", "failed"].includes(selected.status) &&
      selectedJobDetail.value?.id === selected.id &&
      selectedJobDetail.value?.status !== selected.status
    ) {
      await loadSelectedJobDetail({ silent: true });
    }

    await hydrateCompletedJobDetails();

    if (ws && ws.readyState === WebSocket.OPEN) {
      for (const job of selectedBatchJobs.value) {
        subscribeJob(ws, job.id);
      }
    }

    if (
      lockedBatchId.value === selectedBatchId.value &&
      !selectedBatchJobs.value.some((job) =>
        ["queued", "uploading", "transcribing", "analyzing"].includes(
          job.status,
        ),
      )
    ) {
      lockedBatchId.value = "";
    }
  } catch (error) {
    if (!opts?.silent) {
      toast.error(
        error instanceof Error ? error.message : "Failed to load batch detail",
      );
    }
  }
};

const loadSelectedJobDetail = async (opts?: {
  silent?: boolean;
  keepContent?: boolean;
}) => {
  if (!selectedJobId.value) {
    selectedJobDetail.value = null;
    return;
  }
  const showLoading = !opts?.keepContent;
  if (showLoading) {
    loadingJobDetail.value = true;
  }
  try {
    selectedJobDetail.value = await getJob(selectedJobId.value);
  } catch (error) {
    if (!opts?.keepContent) {
      selectedJobDetail.value = null;
    }
    if (!opts?.silent) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load recording result",
      );
    }
  } finally {
    if (showLoading) {
      loadingJobDetail.value = false;
    }
  }
};

const stopRealtime = () => {
  realtimeBatchId = "";
  isWsConnected = false;
  if (batchRefreshTimer) {
    window.clearTimeout(batchRefreshTimer);
    batchRefreshTimer = null;
  }
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
};

const startRealtimePollingFallback = () => {
  if (pollTimer || isWsConnected) return;
  const interval = getRealtimePollingInterval(hasStableWsConnection);
  pollTimer = window.setInterval(() => {
    void loadSelectedBatchDetail({ silent: true });
  }, interval);
};

const startRealtime = () => {
  if (!selectedBatchId.value) return;
  if (
    realtimeBatchId === selectedBatchId.value &&
    ws &&
    (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  stopRealtime();
  realtimeBatchId = selectedBatchId.value;

  try {
    ws = connectWs((event: any) => {
      if (!event || event.batchId !== selectedBatchId.value) {
        return;
      }
      const handled = applyRealtimeEvent(event as Record<string, unknown>);
      if (!handled) {
        scheduleBatchDetailRefresh(800);
      }
    });
    ws.onopen = () => {
      if (!ws || !selectedBatchId.value) return;
      if (realtimeBatchId !== selectedBatchId.value) return;
      isWsConnected = true;
      hasStableWsConnection = true;
      if (pollTimer) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      subscribeBatch(ws, selectedBatchId.value);
      for (const job of selectedBatchJobs.value) {
        subscribeJob(ws, job.id);
      }
    };
    ws.onerror = () => {
      isWsConnected = false;
      startRealtimePollingFallback();
    };
    ws.onclose = () => {
      isWsConnected = false;
      if (realtimeBatchId === selectedBatchId.value) {
        startRealtimePollingFallback();
      }
    };
  } catch {
    startRealtimePollingFallback();
  }
};

const openTenantWorkspace = async (
  tenantId: string,
  preferredProjectId?: string,
  preferredBatchId?: string,
) => {
  selectedTenantId.value = tenantId;
  session.setTenantId(tenantId);
  showWorkspace.value = true;

  await loadProjectsForTenant(tenantId);

  const preferred = preferredProjectId || session.projectId.value || "";
  selectedProjectId.value =
    projects.value.find((project) => project.id === preferred)?.id ||
    projects.value[0]?.id ||
    "";
  session.setProjectId(selectedProjectId.value);

  await checkMatrix();
  await loadHistory();
  if (preferredBatchId) {
    const existing = history.value.find(
      (batch) => batch.id === preferredBatchId,
    );
    if (existing) {
      selectedBatchId.value = existing.id;
    }
  }
  await syncRoute();
};

const closeWorkspace = async () => {
  showWorkspace.value = false;
  showResultModal.value = false;
  clearSelectedJobAudioUrl();
  resetResultModalScoreState();
  selectedProjectId.value = "";
  projects.value = [];
  history.value = [];
  selectedBatchId.value = "";
  batchDetails.value = null;
  await syncRoute();
};

const openManageForMatrixSetup = async () => {
  await router.push("/manage");
};

const selectWorkspaceProject = async (projectId: string) => {
  selectedProjectId.value = projectId;
  session.setProjectId(projectId);
  batchName.value = defaultBatchName();
  await checkMatrix();
  await loadHistory();
  await syncRoute();
};

const createBatchMetadata = async () => {
  if (!canManageJobs.value) {
    toast.error("You do not have permission to create batches.");
    return;
  }
  if (!selectedTenantId.value || !selectedProjectId.value) {
    toast.error("Select tenant and project first.");
    return;
  }
  if (!hasMatrixForProject.value) {
    toast.error("Matrix not found for selected project.");
    return;
  }

  const safeName = batchName.value.trim() || defaultBatchName();

  creatingBatch.value = true;
  try {
    const created = await createProjectBatch({
      tenantId: selectedTenantId.value,
      projectId: selectedProjectId.value,
      callType: inferredCallType.value,
      name: safeName,
    });
    if (String(created.name || "").trim() !== safeName) {
      await updateBatchName({ batchId: created.id, name: safeName });
    }
    saveBatchName(created.id, safeName);
    batchName.value = defaultBatchName();
    toast.success("Batch metadata created");

    await loadHistory();
    selectedBatchId.value = created.id;
    await loadSelectedBatchDetail();
    showCreateBatchModal.value = false;
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to create batch",
    );
  } finally {
    creatingBatch.value = false;
  }
};

const openCreateBatchModal = () => {
  batchName.value = defaultBatchName();
  showCreateBatchModal.value = true;
};

const closeCreateBatchModal = () => {
  if (creatingBatch.value) return;
  showCreateBatchModal.value = false;
};

const resetResultModalScoreState = () => {
  scoreEdits.value = {};
  addScoreEditsToRag.value = true;
  scoreHistory.value = [];
  scoreHistoryLoadedForJobId.value = "";
  resultModalTab.value = "result";
  resultDetailTab.value = "matrix";
};

const hydrateScoreEditsFromDetail = () => {
  const rows = selectedJobDetail.value?.analysis?.evaluation_table || [];
  const next: Record<string, { score: number; note: string }> = {};
  for (const row of rows) {
    next[row.id] = { score: Number(row.score ?? 0), note: "" };
  }
  scoreEdits.value = next;
};

const setRowDraftScore = (rowId: string, score: number) => {
  const current = scoreEdits.value[rowId] || { score, note: "" };
  scoreEdits.value = {
    ...scoreEdits.value,
    [rowId]: { score, note: current.note || "" },
  };
};

const setRowDraftNote = (rowId: string, note: string) => {
  const current = scoreEdits.value[rowId] || { score: 0, note: "" };
  scoreEdits.value = {
    ...scoreEdits.value,
    [rowId]: { score: current.score, note },
  };
};

const loadScoreHistory = async () => {
  if (!canManageScores.value || !selectedJobId.value) return;
  if (scoreHistoryLoadedForJobId.value === selectedJobId.value) return;
  loadingScoreHistory.value = true;
  try {
    scoreHistory.value = await listJobScoreHistory(selectedJobId.value);
    scoreHistoryLoadedForJobId.value = selectedJobId.value;
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to load scoring history",
    );
  } finally {
    loadingScoreHistory.value = false;
  }
};

const submitScoreEdits = async () => {
  if (!selectedJobId.value || !selectedJobDetail.value?.analysis) return;
  const edits = resultScoreRows.value
    .map((row) => {
      const draft = scoreEdits.value[row.id];
      if (!draft || Number(draft.score) === Number(row.score)) return null;
      return {
        rowId: row.id,
        score: Number(draft.score),
        note: String(draft.note || "").trim(),
      };
    })
    .filter((item): item is { rowId: string; score: number; note: string } =>
      Boolean(item),
    );

  if (!edits.length) {
    toast.error("No score changes to save.");
    return;
  }
  if (edits.some((edit) => !edit.note)) {
    toast.error("Each edited row requires a note.");
    return;
  }

  savingScoreEdits.value = true;
  try {
    const result = await updateJobScores(selectedJobId.value, {
      edits,
      addToRag: addScoreEditsToRag.value,
    });
    toast.success(
      `Saved ${result.updatedRows} row update(s)${
        result.strictAutoAdjustedRows
          ? ` (${result.strictAutoAdjustedRows} CE strict auto-adjusted)`
          : ""
      }${
        addScoreEditsToRag.value
          ? `, queued ${result.ragEnqueued} RAG doc(s)`
          : ""
      }`,
    );

    await loadSelectedJobDetail({ silent: true, keepContent: true });
    if (selectedJobDetail.value) {
      jobsWithAnalysis.value[selectedJobId.value] = selectedJobDetail.value;
      hydrateScoreEditsFromDetail();
    }
    scoreHistoryLoadedForJobId.value = "";
    if (resultModalTab.value === "history") {
      await loadScoreHistory();
    }
    await loadSelectedBatchDetail({ silent: true });
    await loadHistory({ silent: true, preserveSelection: true });
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to update scores",
    );
  } finally {
    savingScoreEdits.value = false;
  }
};

const openResultForJob = async (jobId: string) => {
  const shouldHandleSelectionInWatcher = selectedJobId.value !== jobId;
  if (shouldHandleSelectionInWatcher) {
    suppressSelectedJobWatcher = true;
  }
  try {
    selectedJobId.value = jobId;
    resetResultModalScoreState();
    await loadSelectedJobDetail();

    if (!selectedJobDetail.value) {
      toast.error("Could not load recording result.");
      return;
    }

    hydrateScoreEditsFromDetail();
    showResultModal.value = true;
    void loadSelectedJobAudio();
  } finally {
    suppressSelectedJobWatcher = false;
  }
};

const closeResultModal = () => {
  showResultModal.value = false;
  clearSelectedJobAudioUrl();
  resetResultModalScoreState();
};

const openConfirm = (
  title: string,
  message: string,
  action: () => Promise<void>,
) => {
  confirmTitle.value = title;
  confirmMessage.value = message;
  confirmAction = action;
  showConfirmModal.value = true;
};

const closeConfirmModal = () => {
  if (confirmBusy.value) return;
  showConfirmModal.value = false;
  confirmAction = null;
};

const runConfirmAction = async () => {
  if (!confirmAction) return;
  confirmBusy.value = true;
  try {
    await confirmAction();
    showConfirmModal.value = false;
    confirmAction = null;
  } finally {
    confirmBusy.value = false;
  }
};

const loadTenantPreviewStats = async (targetTenants: Tenant[]) => {
  loadingTenantPreviewStats.value = true;
  try {
    const pairs = await Promise.all(
      targetTenants.map(async (tenant) => {
        let tenantProjects: Project[] = [];
        try {
          tenantProjects = await listProjects(tenant.id);
        } catch {
          return [
            tenant.id,
            {
              projects: 0,
              batches: 0,
              recordings: 0,
              completed: 0,
              failed: 0,
              inProgress: 0,
            },
          ] as const;
        }

        const projectSummaries = await Promise.all(
          tenantProjects.map(async (project) => {
            try {
              return await getProjectBatchSummary(project.id);
            } catch {
              return null;
            }
          }),
        );
        const summaries = projectSummaries.filter(
          (summary): summary is Awaited<ReturnType<typeof getProjectBatchSummary>> =>
            Boolean(summary),
        );
        const recordings = summaries.reduce(
          (sum, summary) => sum + Number(summary.totalJobs || 0),
          0,
        );
        const completed = summaries.reduce(
          (sum, summary) => sum + Number(summary.completedJobs || 0),
          0,
        );
        const failed = summaries.reduce(
          (sum, summary) => sum + Number(summary.failedJobs || 0),
          0,
        );
        const batches = summaries.reduce(
          (sum, summary) => sum + Number(summary.totalBatches || 0),
          0,
        );

        return [
          tenant.id,
          {
            projects: tenantProjects.length,
            batches,
            recordings,
            completed,
            failed,
            inProgress: Math.max(0, recordings - completed - failed),
          },
        ] as const;
      }),
    );

    tenantPreviewStats.value = Object.fromEntries(pairs);
  } finally {
    loadingTenantPreviewStats.value = false;
  }
};

const seekFromScorecardEvidence = (seconds: number) => {
  resultTranscriptRef.value?.seekTo(seconds);
};

const revokeBlobAudioUrl = (audioUrl: string | null) => {
  if (audioUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(audioUrl);
  }
};

const clearSelectedJobAudioUrl = () => {
  selectedJobAudioRequestId += 1;
  if (selectedJobAudioAbortController) {
    selectedJobAudioAbortController.abort();
    selectedJobAudioAbortController = null;
  }
  revokeBlobAudioUrl(selectedJobAudioUrl.value);
  selectedJobAudioUrl.value = null;
};

const loadSelectedJobAudio = async () => {
  const jobId = selectedJobId.value;
  if (!jobId || !showResultModal.value) {
    return;
  }
  const previousAudioUrl = selectedJobAudioUrl.value;
  if (selectedJobAudioAbortController) {
    selectedJobAudioAbortController.abort();
  }
  const abortController = new AbortController();
  selectedJobAudioAbortController = abortController;
  const requestId = ++selectedJobAudioRequestId;

  try {
    const audioUrl = await getJobAudioBlobUrl(jobId, abortController.signal);
    const isStale =
      requestId !== selectedJobAudioRequestId ||
      selectedJobAudioAbortController !== abortController ||
      abortController.signal.aborted ||
      selectedJobId.value !== jobId ||
      !showResultModal.value;
    if (isStale) {
      revokeBlobAudioUrl(audioUrl);
      return;
    }
    selectedJobAudioUrl.value = audioUrl;
    if (previousAudioUrl && previousAudioUrl !== audioUrl) {
      revokeBlobAudioUrl(previousAudioUrl);
    }
  } catch (error) {
    const isAbort =
      abortController.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError");
    const isStale =
      requestId !== selectedJobAudioRequestId ||
      selectedJobAudioAbortController !== abortController;
    if (isAbort || isStale) {
      return;
    }
    revokeBlobAudioUrl(selectedJobAudioUrl.value);
    selectedJobAudioUrl.value = null;
    toast.error(
      error instanceof Error ? error.message : "Failed to load recording audio",
    );
  } finally {
    if (selectedJobAudioAbortController === abortController) {
      selectedJobAudioAbortController = null;
    }
  }
};

const uploadToSelectedBatch = async (files: File[], analyzeNow: boolean) => {
  if (!canManageJobs.value) {
    toast.error("You do not have permission to upload recordings.");
    return;
  }
  if (!selectedBatchId.value) {
    toast.error("Create or select a batch first.");
    return;
  }
  if (!files.length) return;
  if (isBatchViewOnlyLocked.value) {
    toast.error("This batch is locked and now view-only.");
    return;
  }
  if (isDailyUploadLimitReached.value) {
    toast.error(
      `Daily upload limit reached (${projectDailyUploadCount.value}/${projectDailyUploadLimit.value}).`,
    );
    return;
  }
  if (files.length > projectDailyUploadRemaining.value) {
    toast.error(
      `Only ${projectDailyUploadRemaining.value} recording(s) remaining for this project today.`,
    );
    return;
  }

  uploading.value = true;
  try {
    const result = await uploadBatchFiles({
      batchId: selectedBatchId.value,
      files,
      analyzeNow,
    });
    toast.success(
      `Uploaded ${result.jobIds.length} recording(s) for later analysis`,
    );
    if (selectedTenantId.value) {
      await loadProjectsForTenant(selectedTenantId.value);
    }
    await loadHistory();
    await loadSelectedBatchDetail();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    if (
      selectedTenantId.value &&
      message.toLowerCase().includes("daily upload limit")
    ) {
      await loadProjectsForTenant(selectedTenantId.value);
    }
    toast.error(message);
  } finally {
    uploading.value = false;
  }
};

const onFilesSelected = async (files: File[]) => {
  await uploadToSelectedBatch(files, false);
};

const startAnalyzeQueued = async () => {
  if (!canManageJobs.value) {
    toast.error("You do not have permission to run analysis.");
    return;
  }
  if (!selectedBatchId.value) return;
  if (isBatchViewOnlyLocked.value) {
    toast.error("This batch is locked and now view-only.");
    return;
  }
  requestingAnalyze.value = true;
  try {
    const res = await analyzeBatchNow(selectedBatchId.value);
    if (res.enqueued > 0) {
      lockedBatchId.value = selectedBatchId.value;
    }
    toast.success(`Queued ${res.enqueued} recording(s) for analysis`);
    await loadHistory();
    await loadSelectedBatchDetail();
    startRealtime();
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to start analysis",
    );
  } finally {
    requestingAnalyze.value = false;
  }
};

const canDeleteJob = (job: { status: string }) => {
  if (isBatchViewOnlyLocked.value) return false;
  return job.status === "completed" || job.status === "failed";
};

const canRetryJob = (job: { status: string }) => {
  if (isBatchViewOnlyLocked.value) return false;
  return job.status === "failed";
};

const deleteJobAction = async (job: { id: string; status: string }) => {
  if (!canManageJobs.value) {
    toast.error("You do not have permission to delete recordings.");
    return;
  }
  if (!canDeleteJob(job)) {
    toast.error(
      isBatchViewOnlyLocked.value
        ? "This batch is locked and now view-only."
        : "Recording can be deleted only after processing is completed.",
    );
    return;
  }
  openConfirm(
    "Delete Recording",
    "Delete this QA recording and all related analysis data? This action cannot be undone.",
    async () => {
      try {
        await deleteJob(job.id);
        toast.success("Recording deleted");
        await loadHistory();
        await loadSelectedBatchDetail();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to delete recording",
        );
      }
    },
  );
};

const retryJobAction = async (job: { id: string; status: string }) => {
  if (!canManageJobs.value) {
    toast.error("You do not have permission to retry recordings.");
    return;
  }
  if (!canRetryJob(job)) {
    toast.error(
      isBatchViewOnlyLocked.value
        ? "This batch is locked and now view-only."
        : "Only failed recordings can be retried.",
    );
    return;
  }

  try {
    await retryJob(job.id);
    toast.success("Recording re-queued for processing");
    if (selectedBatchId.value) {
      lockedBatchId.value = selectedBatchId.value;
    }
    await loadHistory({ preserveSelection: true });
    await loadSelectedBatchDetail();
    startRealtime();
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Failed to retry recording",
    );
  }
};

const deleteBatchAction = async (batch: BatchHistoryItem) => {
  if (!canManageJobs.value) {
    toast.error("You do not have permission to delete batches.");
    return;
  }
  if (!canDeleteBatch(batch)) {
    toast.error(
      batch.isLocked && !isSuperAdmin.value
        ? "Locked batch can only be deleted by super admin."
        : "Batch can be deleted only when all recordings are processed.",
    );
    return;
  }
  openConfirm(
    "Delete Batch",
    "Delete this QA batch and all recordings/results inside it? This action cannot be undone.",
    async () => {
      try {
        await deleteBatch(batch.id);
        toast.success("Batch deleted");

        if (selectedBatchId.value === batch.id) {
          selectedBatchId.value = "";
          batchDetails.value = null;
        }
        await loadHistory();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to delete batch",
        );
      }
    },
  );
};

watch(selectedBatchId, async () => {
  jobsCurrentPage.value = 1;
  showResultModal.value = false;
  clearSelectedJobAudioUrl();
  resetResultModalScoreState();
  await syncRoute();
  await loadSelectedBatchDetail();
  startRealtime();
});

watch(selectedJobId, async () => {
  if (suppressSelectedJobWatcher) {
    return;
  }
  const selectedIndex = selectedBatchJobs.value.findIndex(
    (job) => job.id === selectedJobId.value,
  );
  if (selectedIndex >= 0) {
    jobsCurrentPage.value = Math.floor(selectedIndex / jobsPageSize) + 1;
  }
  clearSelectedJobAudioUrl();
  await loadSelectedJobDetail();
  if (showResultModal.value) {
    hydrateScoreEditsFromDetail();
    if (resultModalTab.value === "history") {
      await loadScoreHistory();
    }
  }
  if (showResultModal.value) {
    await loadSelectedJobAudio();
  }
});

watch(resultModalTab, async (tab) => {
  if (!showResultModal.value) return;
  if (tab === "history") {
    await loadScoreHistory();
  }
});

watch(
  () => selectedBatchJobs.value.length,
  () => {
    if (jobsCurrentPage.value > jobsTotalPages.value) {
      jobsCurrentPage.value = jobsTotalPages.value;
    }
  },
);

// When the user clicks the "QA Calculation" nav link while already inside a workspace,
// the URL drops to /batch (no query params). Detect this and reset the view.
watch(
  () => route.query,
  async (query) => {
    const tenantParam = query.tenant as string | undefined;
    if (!tenantParam && showWorkspace.value) {
      // URL has no tenant — user navigated away to plain /batch; reset the workspace
      showWorkspace.value = false;
      showResultModal.value = false;
      clearSelectedJobAudioUrl();
      resetResultModalScoreState();
      selectedProjectId.value = "";
      projects.value = [];
      history.value = [];
      selectedBatchId.value = "";
      batchDetails.value = null;
      stopRealtime();
    }
  },
  { deep: true },
);

onMounted(async () => {
  try {
    const me = await getAuthMeCached();
    if (!me.isRestricted) {
      isSuperAdmin.value = true;
      canManageJobs.value = true;
      canManageScores.value = true;
      canViewMatrices.value = true;
    } else {
      isSuperAdmin.value = false;
      const permissions = new Set(me.permissions);
      canManageJobs.value = permissions.has("jobs:manage");
      canManageScores.value = permissions.has("scores:manage");
      canViewMatrices.value =
        permissions.has("matrices:view") || permissions.has("matrices:manage");
    }
  } catch {
    isSuperAdmin.value = false;
    canManageJobs.value = false;
    canManageScores.value = false;
    canViewMatrices.value = false;
  }

  loadBatchNames();
  batchName.value = defaultBatchName();
  await loadTenants();

  const tenantQuery = normalizeUuidParam(route.query.tenant);
  const projectQuery = normalizeUuidParam(route.query.project);
  const batchQuery = normalizeUuidParam(route.query.batch);

  if (
    tenantQuery &&
    tenants.value.some((tenant) => tenant.id === tenantQuery)
  ) {
    await openTenantWorkspace(
      tenantQuery,
      projectQuery || undefined,
      batchQuery || undefined,
    );
    return;
  }

  const preferredTenant = session.tenantId.value;
  if (
    preferredTenant &&
    tenants.value.some((tenant) => tenant.id === preferredTenant)
  ) {
    selectedTenantId.value = preferredTenant;
  }
});

onUnmounted(() => {
  clearSelectedJobAudioUrl();
  stopRealtime();
});
</script>

<template>
  <section class="manage-shell">
    <div class="hero">
      <p class="hero-kicker">Nexto VoiceGuard</p>
      <h2 class="hero-title">Batch Analytics Dashboard</h2>
      <p class="hero-sub">
        Pick a tenant card to open its Intelligent QA workspace, choose a
        project, then upload recordings to start batch automated scoring.
      </p>
    </div>

    <div v-if="!showWorkspace">
      <p v-if="loading" class="msg-muted">Loading tenants...</p>
      <div v-else-if="!tenants.length" class="empty-home">
        No tenants found. Create a tenant in Manage first.
      </div>
      <div v-else class="tenant-grid">
        <button
          v-for="tenant in tenants"
          :key="tenant.id"
          class="tenant-card"
          @click="openTenantWorkspace(tenant.id)"
        >
          <div class="tenant-card-main">
            <div
              class="tenant-logo"
              :style="
                tenant.logoUrl
                  ? getLogoBgStyle(resolveTenantLogoUrl(tenant.logoUrl))
                  : undefined
              "
            >
              <img
                v-if="tenant.logoUrl"
                :src="resolveTenantLogoUrl(tenant.logoUrl)"
                :alt="`${tenant.name} logo`"
                crossorigin="anonymous"
                @load="applyDominantLogoColor"
              />
              <ImageIcon v-else class="w-4 h-4" />
            </div>
            <div>
              <p class="tenant-name">{{ tenant.name }}</p>
              <p class="tenant-meta">Open QA Workspace</p>
            </div>
          </div>
          <div class="tenant-stats">
            <template v-if="tenantPreviewStats[tenant.id]">
              <span class="tenant-stat-chip"
                >Projects
                {{ tenantPreviewStats[tenant.id]?.projects ?? 0 }}</span
              >
              <span class="tenant-stat-chip"
                >Batches {{ tenantPreviewStats[tenant.id]?.batches ?? 0 }}</span
              >
              <span class="tenant-stat-chip"
                >Samples
                {{ tenantPreviewStats[tenant.id]?.recordings ?? 0 }}</span
              >
              <span class="tenant-stat-chip"
                >Done {{ tenantPreviewStats[tenant.id]?.completed ?? 0 }}</span
              >
              <span class="tenant-stat-chip"
                >Failed {{ tenantPreviewStats[tenant.id]?.failed ?? 0 }}</span
              >
              <span class="tenant-stat-chip"
                >In Progress
                {{ tenantPreviewStats[tenant.id]?.inProgress ?? 0 }}</span
              >
            </template>
            <span v-else class="tenant-meta">{{
              loadingTenantPreviewStats
                ? "Loading tenant metrics..."
                : "No metrics yet"
            }}</span>
          </div>
        </button>
      </div>
    </div>

    <div v-else class="workspace-modal" @click.self="closeWorkspace">
      <div class="workspace-surface">
        <div class="workspace-head">
          <div>
            <p class="workspace-title">
              {{ workspaceTitle }}
            </p>
            <p class="workspace-subtitle">
              Build batches, drop recordings, and track QA performance live
            </p>
          </div>
          <button class="btn-ghost" @click="closeWorkspace">
            Exit Workspace
          </button>
        </div>

        <div
          class="workspace-body"
          :class="{ 'workspace-body-single-project': !showProjectSelector }"
        >
          <aside v-if="showProjectSelector" class="project-panel">
            <div class="project-panel-head">
              <p>Choose Project</p>
            </div>
            <div v-if="!projects.length" class="msg-muted">
              No projects in this tenant.
            </div>
            <button
              v-for="project in projects"
              :key="project.id"
              class="project-row"
              :class="{
                'project-row-active': selectedProjectId === project.id,
              }"
              @click="selectWorkspaceProject(project.id)"
            >
              <div>
                <p class="project-name">{{ project.name }}</p>
                <p class="project-meta">
                  {{ project.supportsInbound ? "Inbound" : "Outbound" }}
                </p>
              </div>
            </button>
          </aside>

          <section class="qa-panel">
            <p v-if="!selectedProjectId" class="msg-muted">
              Select a project to open QA batch workspace.
            </p>
            <div v-else-if="checkingMatrix" class="msg-muted">
              Checking matrix...
            </div>
            <template v-else>
              <div v-if="!hasMatrixForProject" class="matrix-empty-state">
                <div class="matrix-empty-hero">
                  <div class="matrix-empty-icon-wrap">
                    <AlertTriangle class="w-5 h-5" />
                  </div>
                  <div>
                    <p class="matrix-empty-kicker">Batch QA Blocked</p>
                    <h3 class="matrix-empty-title">No Active Matrix Found</h3>
                    <p class="matrix-empty-desc">
                      This workspace is ready, but scoring cannot start until a
                      matrix version is active for
                      <strong>{{ inferredCallType.toUpperCase() }}</strong
                      >.
                    </p>
                  </div>
                </div>

                <div class="matrix-empty-steps">
                  <div class="matrix-step-chip">
                    <span class="matrix-step-num">1</span>
                    <span>Open <strong>Manage</strong></span>
                  </div>
                  <div class="matrix-step-chip">
                    <span class="matrix-step-num">2</span>
                    <span
                      >Create or update {{ inferredCallType }} matrix rows</span
                    >
                  </div>
                  <div class="matrix-step-chip">
                    <span class="matrix-step-num">3</span>
                    <span>Activate latest matrix version</span>
                  </div>
                </div>

                <p v-if="matrixMessage" class="matrix-empty-detail">
                  Backend detail: {{ matrixMessage }}
                </p>

                <div class="matrix-empty-actions">
                  <button class="btn-primary" @click="openManageForMatrixSetup">
                    Configure Matrix
                    <ArrowRight class="w-3.5 h-3.5" />
                  </button>
                  <button class="btn-ghost" @click="checkMatrix">
                    I Activated It, Recheck
                  </button>
                </div>
              </div>
              <div v-else class="qa-layout">
                <div class="history-panel panel-card">
                  <div class="history-head">
                    <p class="panel-title">Batch Timeline</p>
                    <button
                      v-if="canManageJobs"
                      class="btn-primary"
                      @click="openCreateBatchModal"
                    >
                      + New Batch
                    </button>
                  </div>
                  <p v-if="loadingHistory" class="msg-muted">
                    Loading history...
                  </p>
                  <div v-else class="history-list">
                    <div
                      v-for="batch in history"
                      :key="batch.id"
                      class="history-row"
                      :class="{
                        'history-row-active': selectedBatchId === batch.id,
                        'history-row-locked': batch.isLocked,
                      }"
                    >
                      <button
                        class="history-main"
                        @click="selectedBatchId = batch.id"
                      >
                        <div class="history-main-head">
                          <span class="history-name">{{
                            getBatchName(batch)
                          }}</span>
                        </div>
                        <span class="history-meta"
                          >{{ new Date(batch.createdAt).toLocaleString() }} |
                          {{ batch.totalJobs }} files</span
                        >
                      </button>
                      <div
                        v-if="
                          batch.isLocked ||
                          (canManageJobs && canDeleteBatch(batch))
                        "
                        class="history-actions"
                      >
                        <span
                          v-if="batch.isLocked"
                          class="history-lock-indicator"
                          title="Locked (view-only)"
                          aria-label="Locked (view-only)"
                        >
                          <Lock :size="12" aria-hidden="true" />
                        </span>
                        <button
                          v-if="canManageJobs && canDeleteBatch(batch)"
                          class="history-delete-btn"
                          title="Delete batch"
                          aria-label="Delete batch"
                          @click="deleteBatchAction(batch)"
                        >
                          <Trash2 :size="13" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <p v-if="!history.length" class="msg-muted">
                      No batches yet. Create your first batch to get started.
                    </p>
                  </div>
                </div>

                <div class="work-panel panel-card">
                  <p class="panel-title">{{ liveQaDashboardTitle }}</p>
                  <div class="dashboard-grid">
                    <div class="dashboard-item">
                      <span>Total</span>
                      <strong>{{ batchDashboard.total }}</strong>
                    </div>
                    <div class="dashboard-item">
                      <span>Completed</span>
                      <strong>{{ batchDashboard.completed }}</strong>
                    </div>
                    <div class="dashboard-item">
                      <span>Failed</span>
                      <strong>{{ batchDashboard.failed }}</strong>
                    </div>
                    <div class="dashboard-item">
                      <span>Progress</span>
                      <strong>{{ batchDashboard.progress }}%</strong>
                    </div>

                    <template
                      v-if="
                        batchDashboard.completed > 0 ||
                        batchDashboard.failed > 0
                      "
                    >
                      <div class="dashboard-item">
                        <span>CE Defects</span>
                        <strong>{{ ceNceScores.ceDefectSamples }}</strong>
                      </div>
                      <div class="dashboard-item">
                        <span>NCE Defects</span>
                        <strong>{{ ceNceScores.totalNCEDefects }}</strong>
                      </div>
                      <div class="dashboard-item">
                        <span>NCE Params</span>
                        <strong>{{ ceNceScores.nceParametersCount }}</strong>
                      </div>
                      <div class="dashboard-item">
                        <span>CE Accuracy</span>
                        <strong>{{ ceNceScores.ceAccuracy }}%</strong>
                      </div>
                      <div class="dashboard-item">
                        <span>NCE Accuracy</span>
                        <strong>{{ ceNceScores.nceAccuracy }}%</strong>
                      </div>
                      <div
                        class="dashboard-item highlight-item"
                        :class="{
                          'score-pass': ceNceScores.targetMet,
                          'score-fail': !ceNceScores.targetMet,
                        }"
                      >
                        <span>QA Score</span>
                        <strong>{{ ceNceScores.integratedQAScore }}%</strong>
                      </div>
                    </template>
                  </div>

                  <div class="upload-box">
                    <div class="upload-head">
                      <div>
                        <p>Add Recordings</p>
                        <p class="upload-counter">
                          Today: {{ projectDailyUploadCount }} /
                          {{ projectDailyUploadLimit }}
                        </p>
                      </div>
                      <div class="upload-action-row">
                        <button
                          class="btn-ghost"
                          :disabled="!selectedBatchId"
                          @click="() => loadSelectedBatchDetail()"
                        >
                          Refresh
                        </button>
                        <button
                          class="btn-analyze"
                          :disabled="
                            !canManageJobs || !hasQueuedJobs || isBatchLocked
                          "
                          @click="startAnalyzeQueued"
                          :title="
                            isBatchViewOnlyLocked
                              ? 'Batch is locked and view-only'
                              : !hasQueuedJobs
                                ? 'No queued recordings ready'
                                : 'Run QA on queued recordings'
                          "
                        >
                          Run QA
                        </button>
                      </div>
                    </div>
                    <p v-if="!selectedBatchId" class="msg-muted">
                      Create or select a batch first.
                    </p>
                    <p v-else-if="isBatchViewOnlyLocked" class="msg-muted">
                      Locked after {{ selectedBatchLockDays }} day(s)
                      <span v-if="selectedBatchLockAt">
                        (since
                        {{ new Date(selectedBatchLockAt).toLocaleString() }})
                      </span>
                      . View only mode is active.
                    </p>
                    <div v-else>
                      <AudioUploader
                        :is-processing="uploading"
                        :multiple="true"
                        :disabled="
                          !canManageJobs ||
                          !selectedBatchId ||
                          isBatchLocked ||
                          isDailyUploadLimitReached
                        "
                        :disabled-message="uploadBlockedMessage"
                        button-label="Browse Files"
                        :disabled-button-label="
                          isDailyUploadLimitReached
                            ? 'Limit Reached'
                            : 'Browse Files'
                        "
                        @files-selected="onFilesSelected"
                      />
                    </div>
                  </div>

                  <div class="jobs-box">
                    <p class="jobs-title">Recording Queue & Results</p>
                    <div v-if="!batchDetails?.jobs?.length" class="msg-muted">
                      No recordings in this batch yet.
                    </div>
                    <div v-else class="jobs-list">
                      <div
                        v-for="job in pagedBatchJobs"
                        :key="job.id"
                        class="job-row"
                        :class="{
                          'job-row-active': selectedJobId === job.id,
                          'job-row-failed': job.status === 'failed',
                        }"
                        :title="
                          job.status === 'failed'
                            ? normalizeJobErrorMessage(job.errorMessage) ||
                              'Processing failed.'
                            : ''
                        "
                        @click="selectedJobId = job.id"
                      >
                        <div class="job-main">
                          <span class="job-name">{{ job.fileName }}</span>
                          <span class="job-meta"
                            >{{ job.status }} ({{ job.progress }}%)</span
                          >
                          <p
                            v-if="job.status === 'failed'"
                            class="job-error"
                          >
                            {{ getJobFailurePreview(job) }}
                          </p>
                          <div class="job-progress">
                            <div
                              class="job-progress-fill"
                              :style="{
                                width: `${Math.max(0, Math.min(100, Number(job.progress || 0)))}%`,
                              }"
                            ></div>
                          </div>
                        </div>
                        <div class="job-actions">
                          <button
                            v-if="job.status === 'completed'"
                            class="btn-primary"
                            @click.stop="openResultForJob(job.id)"
                          >
                            View Result
                          </button>
                          <button
                            v-if="canManageJobs && canDeleteJob(job)"
                            class="btn-danger"
                            @click.stop="deleteJobAction(job)"
                          >
                            Delete
                          </button>
                          <button
                            v-if="canManageJobs && canRetryJob(job)"
                            class="btn-ghost"
                            @click.stop="retryJobAction(job)"
                          >
                            Retry
                          </button>
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="batchDetails?.jobs?.length"
                      class="jobs-pagination"
                    >
                      <button
                        class="btn-ghost"
                        :disabled="jobsCurrentPage <= 1"
                        @click="jobsCurrentPage -= 1"
                      >
                        Prev
                      </button>
                      <button
                        v-for="page in jobsPageNumbers"
                        :key="page"
                        class="jobs-page-btn"
                        :class="{
                          'jobs-page-btn-active': page === jobsCurrentPage,
                        }"
                        @click="jobsCurrentPage = page"
                      >
                        {{ page }}
                      </button>
                      <button
                        class="btn-ghost"
                        :disabled="jobsCurrentPage >= jobsTotalPages"
                        @click="jobsCurrentPage += 1"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div
                v-if="showCreateBatchModal"
                class="create-modal-backdrop"
                @click.self="closeCreateBatchModal"
              >
                <div class="create-modal">
                  <p class="create-modal-title">Create QA Batch</p>
                  <input
                    v-model="batchName"
                    class="input"
                    placeholder="Batch name"
                  />
                  <div class="create-modal-actions">
                    <button
                      class="btn-ghost"
                      :disabled="creatingBatch"
                      @click="closeCreateBatchModal"
                    >
                      Cancel
                    </button>
                    <button
                      class="btn-primary"
                      :disabled="creatingBatch"
                      @click="createBatchMetadata"
                    >
                      {{ creatingBatch ? "Creating..." : "Create Batch" }}
                    </button>
                  </div>
                </div>
              </div>

              <Teleport to="body">
                <div
                  v-if="showResultModal"
                  class="result-modal-backdrop"
                  @click.self="closeResultModal"
                >
                  <div class="result-modal">
                    <div class="result-modal-head">
                      <div>
                        <p class="result-modal-title">Recording Result</p>
                        <p class="result-modal-meta">
                          {{ selectedJobMeta?.status || "unknown"
                          }}{{
                            selectedJobDetail?.fileName
                              ? ` | ${selectedJobDetail.fileName}`
                              : ""
                          }}
                        </p>
                      </div>
                      <button class="btn-ghost" @click="closeResultModal">
                        Close
                      </button>
                    </div>

                    <div class="result-modal-tabs">
                      <button
                        class="result-tab-btn"
                        :class="{
                          'result-tab-btn-active': resultModalTab === 'result',
                        }"
                        @click="resultModalTab = 'result'"
                      >
                        <FileText :size="14" aria-hidden="true" />
                        Result
                      </button>
                      <button
                        class="result-tab-btn"
                        :class="{
                          'result-tab-btn-active': resultModalTab === 'history',
                        }"
                        @click="resultModalTab = 'history'"
                      >
                        <History :size="14" aria-hidden="true" />
                        Scoring History
                      </button>
                    </div>

                    <div
                      class="result-modal-body"
                      :class="{
                        'result-modal-body-lock-scroll':
                          resultModalTab === 'result',
                      }"
                    >
                      <p v-if="loadingJobDetail" class="msg-muted">
                        Loading result...
                      </p>
                      <template v-else-if="resultModalTab === 'result'">
                        <div
                          v-if="
                            selectedJobDetail?.transcript ||
                            selectedJobDetail?.analysis
                          "
                          class="result-layout"
                        >
                          <div class="result-panel">
                            <div class="result-panel-content-fixed">
                              <TranscriptViewer
                                ref="resultTranscriptRef"
                                :transcript="selectedJobDetail.transcript || ''"
                                :segments="transcriptSegments"
                                :file="null"
                                :audio-url="selectedJobAudioUrl"
                                :show-resize="false"
                              />
                            </div>
                          </div>
                          <div class="result-panel">
                            <div
                              class="result-panel-content-scroll result-panel-content-scroll-no-outer-scroll"
                            >
                              <div class="result-detail-tabs">
                                <button
                                  class="result-tab-btn"
                                  :class="{
                                    'result-tab-btn-active':
                                      resultDetailTab === 'matrix',
                                  }"
                                  @click="resultDetailTab = 'matrix'"
                                >
                                  <Table2 :size="14" aria-hidden="true" />
                                  Evaluation Matrix
                                </button>
                                <button
                                  class="result-tab-btn"
                                  :class="{
                                    'result-tab-btn-active':
                                      resultDetailTab === 'manual',
                                  }"
                                  @click="resultDetailTab = 'manual'"
                                >
                                  <SlidersHorizontal
                                    :size="14"
                                    aria-hidden="true"
                                  />
                                  Manual Scoring
                                </button>
                              </div>

                              <template v-if="resultDetailTab === 'matrix'">
                                <AnalysisPanel
                                  v-if="selectedJobDetail.analysis"
                                  :analysis="selectedJobDetail.analysis"
                                  :show-resize="false"
                                  :show-heading="false"
                                  :flat="true"
                                  @seek-to="seekFromScorecardEvidence"
                                />
                                <p v-else class="msg-muted">
                                  No analysis output found.
                                </p>
                              </template>

                              <template v-else>
                                <div
                                  v-if="
                                    selectedJobDetail.analysis?.evaluation_table
                                      ?.length
                                  "
                                  class="score-editor score-editor-standalone"
                                >
                                  <div class="score-editor-head">
                                    <p class="score-editor-title">
                                      Manual Score Override
                                    </p>
                                    <div class="score-editor-head-actions">
                                      <label class="score-rag-toggle">
                                        <input
                                          v-model="addScoreEditsToRag"
                                          type="checkbox"
                                          :disabled="savingScoreEdits"
                                        />
                                        Add to Knowledge Base
                                      </label>
                                      <button
                                        class="btn-primary"
                                        :disabled="!canSubmitScoreEdits"
                                        @click="submitScoreEdits"
                                      >
                                        {{
                                          savingScoreEdits
                                            ? "Saving..."
                                            : "Save Score Edits"
                                        }}
                                      </button>
                                    </div>
                                  </div>

                                  <p v-if="!canManageScores" class="msg-muted">
                                    You do not have permission to edit scores.
                                  </p>
                                  <p
                                    v-else-if="isBatchViewOnlyLocked"
                                    class="msg-muted"
                                  >
                                    This batch is locked and now view-only.
                                  </p>
                                  <p
                                    v-else-if="
                                      selectedJobDetail.status !== 'completed'
                                    "
                                    class="msg-muted"
                                  >
                                    Scores can only be edited for completed
                                    recordings.
                                  </p>
                                  <p
                                    v-else-if="hasMissingScoreNotes"
                                    class="msg-muted"
                                  >
                                    Add notes for each edited row before saving.
                                  </p>

                                  <div class="score-editor-list">
                                    <div
                                      v-for="row in resultScoreRows"
                                      :key="row.id"
                                      class="score-editor-row"
                                    >
                                      <div class="score-editor-row-head">
                                        <p class="score-editor-row-title">
                                          {{ row.area }}
                                        </p>
                                        <p class="score-editor-row-meta">
                                          {{ row.parameter }} | Current:
                                          {{ row.score }}/{{ row.max_score }}
                                        </p>
                                      </div>
                                      <div class="score-editor-controls">
                                        <button
                                          class="btn-ghost score-toggle-btn"
                                          :class="{
                                            'score-toggle-active':
                                              scoreEdits[row.id]?.score === 0,
                                          }"
                                          :disabled="
                                            !canManageScores ||
                                            isBatchViewOnlyLocked ||
                                            selectedJobDetail.status !==
                                              'completed'
                                          "
                                          @click="setRowDraftScore(row.id, 0)"
                                        >
                                          Fail (0/{{ row.max_score }})
                                        </button>
                                        <button
                                          class="btn-ghost score-toggle-btn"
                                          :class="{
                                            'score-toggle-active':
                                              scoreEdits[row.id]?.score ===
                                              row.max_score,
                                          }"
                                          :disabled="
                                            !canManageScores ||
                                            isBatchViewOnlyLocked ||
                                            selectedJobDetail.status !==
                                              'completed'
                                          "
                                          @click="
                                            setRowDraftScore(
                                              row.id,
                                              row.max_score,
                                            )
                                          "
                                        >
                                          Pass ({{ row.max_score }}/{{
                                            row.max_score
                                          }})
                                        </button>
                                      </div>
                                      <textarea
                                        class="input score-edit-note"
                                        :disabled="
                                          !canManageScores ||
                                          isBatchViewOnlyLocked ||
                                          selectedJobDetail.status !==
                                            'completed' ||
                                          (scoreEdits[row.id]?.score ??
                                            row.score) === row.score
                                        "
                                        :value="scoreEdits[row.id]?.note || ''"
                                        placeholder="Required note for edited score"
                                        @input="
                                          setRowDraftNote(
                                            row.id,
                                            (
                                              $event.target as HTMLTextAreaElement
                                            ).value,
                                          )
                                        "
                                      />
                                    </div>
                                  </div>
                                </div>
                                <p v-else class="msg-muted">
                                  No score rows available for manual editing.
                                </p>
                              </template>
                            </div>
                          </div>
                        </div>
                        <div v-else class="msg-muted">
                          Result not ready. Current status:
                          {{ selectedJobMeta?.status || "unknown" }}.
                        </div>
                      </template>
                      <template v-else>
                        <p v-if="!canManageScores" class="msg-muted">
                          You do not have permission to view scoring history.
                        </p>
                        <p v-else-if="loadingScoreHistory" class="msg-muted">
                          Loading scoring history...
                        </p>
                        <div
                          v-else-if="scoreHistory.length"
                          class="score-history-list"
                        >
                          <div
                            v-for="entry in scoreHistory"
                            :key="entry.id"
                            class="score-history-row"
                          >
                            <div class="score-history-head">
                              <p class="score-history-title">
                                {{ entry.area }} ({{ entry.parameter }})
                              </p>
                              <span
                                class="score-history-source"
                                :class="{
                                  'score-history-source-auto':
                                    entry.changeSource === 'ce_strict_auto',
                                }"
                              >
                                {{
                                  entry.changeSource === "manual"
                                    ? "Manual"
                                    : "CE Strict Auto"
                                }}
                              </span>
                            </div>
                            <p class="score-history-meta">
                              {{ entry.oldScore }}/{{ entry.maxScore }} ->
                              {{ entry.newScore }}/{{ entry.maxScore }} | Row
                              #{{ entry.rowIndex + 1 }}
                            </p>
                            <p class="score-history-meta">
                              {{ new Date(entry.createdAt).toLocaleString() }} |
                              {{
                                entry.editedByFullname ||
                                entry.editedByEmail ||
                                entry.editedBy ||
                                "User"
                              }}
                            </p>
                            <p class="score-history-note">
                              {{ entry.reasonNote }}
                            </p>
                          </div>
                        </div>
                        <p v-else class="msg-muted">
                          No scoring edits recorded yet.
                        </p>
                      </template>
                    </div>
                  </div>
                </div>
              </Teleport>

              <Teleport to="body">
                <div
                  v-if="showConfirmModal"
                  class="confirm-modal-backdrop"
                  @click.self="closeConfirmModal"
                >
                  <div class="confirm-modal popup-in">
                    <h3 class="confirm-modal-title">{{ confirmTitle }}</h3>
                    <p class="confirm-modal-message">{{ confirmMessage }}</p>
                    <div class="confirm-modal-actions">
                      <button
                        class="btn-ghost"
                        :disabled="confirmBusy"
                        @click="closeConfirmModal"
                      >
                        Cancel
                      </button>
                      <button
                        class="btn-danger"
                        :disabled="confirmBusy"
                        @click="runConfirmAction"
                      >
                        {{ confirmBusy ? "Deleting..." : "Delete" }}
                      </button>
                    </div>
                  </div>
                </div>
              </Teleport>
            </template>
          </section>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.manage-shell {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.hero {
  border-radius: 1rem;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: radial-gradient(
    circle at 10% 0%,
    rgba(56, 189, 248, 0.2),
    rgba(15, 23, 42, 0.92)
  );
  padding: 0.9rem 1rem;
}

.hero-kicker {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: rgba(186, 230, 253, 0.78);
}

.hero-title {
  margin-top: 0.2rem;
  font-size: 1.35rem;
  font-weight: 700;
  color: #f8fafc;
}

.hero-sub {
  margin-top: 0.35rem;
  color: #cbd5e1;
  font-size: 0.83rem;
}

.tenant-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0.75rem;
}

.tenant-card {
  text-align: left;
  border-radius: 0.95rem;
  border: 1px solid rgba(100, 116, 139, 0.42);
  background: rgba(15, 23, 42, 0.7);
  padding: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tenant-card:hover {
  border-color: rgba(34, 211, 238, 0.65);
  background: rgba(15, 23, 42, 0.82);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.5);
}

.tenant-card-main {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.tenant-logo {
  width: 2.25rem;
  aspect-ratio: 1 / 1;
  border-radius: 0.5rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(2, 6, 23, 0.65);
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.tenant-logo img {
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
  object-position: center center;
}

.tenant-name {
  color: #e2e8f0;
  font-weight: 700;
}

.tenant-meta {
  margin-top: 0.2rem;
  color: #94a3b8;
  font-size: 0.78rem;
}

.tenant-stats {
  margin-top: 0.65rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tenant-stat-chip {
  border-radius: 999px;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(2, 6, 23, 0.48);
  color: #cbd5e1;
  font-size: 0.66rem;
  padding: 0.14rem 0.45rem;
  letter-spacing: 0.03em;
}

.workspace-modal {
  position: fixed;
  inset: 0;
  z-index: 60;
  padding: 0.8rem;
  padding-top: calc(68px + 0.8rem); /* Leave room for the sticky navbar */
  background: rgba(2, 6, 23, 0.78);
  backdrop-filter: blur(6px);
}

.workspace-surface {
  height: calc(100vh - 68px - 1.6rem);
  border-radius: 1rem;
  border: 1px solid rgba(100, 116, 139, 0.35);
  background: rgba(2, 6, 23, 0.95);
  padding: 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  overflow: hidden;
}

.workspace-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.7rem;
}

.workspace-title {
  color: #f8fafc;
  font-weight: 700;
}

.workspace-subtitle {
  margin-top: 0.2rem;
  color: #94a3b8;
  font-size: 0.78rem;
}

.workspace-body {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 0.75rem;
}

.workspace-body-single-project {
  grid-template-columns: 1fr;
}

.project-panel {
  border-radius: 0.9rem;
  border: 1px solid rgba(100, 116, 139, 0.3);
  background: rgba(15, 23, 42, 0.55);
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  overflow-y: auto;
}

.project-panel-head {
  color: #cbd5e1;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.project-row {
  text-align: left;
  border-radius: 0.7rem;
  border: 1px solid rgba(100, 116, 139, 0.34);
  background: rgba(2, 6, 23, 0.45);
  padding: 0.6rem;
}

.project-row-active {
  border-color: rgba(34, 211, 238, 0.72);
  box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.34);
}

.project-name {
  color: #e2e8f0;
  font-size: 0.84rem;
  font-weight: 600;
}

.project-meta {
  margin-top: 0.18rem;
  color: #94a3b8;
  font-size: 0.72rem;
}

.qa-panel {
  border-radius: 0.9rem;
  border: 1px solid rgba(100, 116, 139, 0.3);
  background: rgba(15, 23, 42, 0.52);
  padding: 0.7rem;
  overflow-y: auto;
  min-height: 0;
}

.qa-layout {
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 0.7rem;
}

.panel-card {
  border-radius: 0.8rem;
  border: 1px solid rgba(100, 116, 139, 0.28);
  background: rgba(15, 23, 42, 0.58);
  padding: 0.7rem;
}

.panel-title {
  color: #e2e8f0;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  margin-bottom: 0.55rem;
}

.history-panel,
.work-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.work-panel {
  overflow-y: auto;
}

.history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.45rem;
}

.history-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.history-row {
  border-radius: 0.65rem;
  border: 1px solid rgba(100, 116, 139, 0.4);
  background: rgba(2, 6, 23, 0.48);
  padding: 0.38rem 0.42rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
}

.history-row-active {
  border-color: rgba(34, 211, 238, 0.7);
}

.history-row-locked {
  border-color: rgba(251, 191, 36, 0.56);
  box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.2);
}

.history-row-active.history-row-locked {
  border-color: rgba(245, 158, 11, 0.85);
}

.history-main {
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 0.16rem;
  flex: 1;
}

.history-main-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.history-actions {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  border-radius: 0.62rem;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(15, 23, 42, 0.4);
}

.history-lock-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  inline-size: 2rem;
  block-size: 1.9rem;
  border-right: 1px solid rgba(148, 163, 184, 0.28);
  color: #fb923c;
  background: rgba(248, 250, 252, 0.08);
}

.history-delete-btn {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  inline-size: 2rem;
  block-size: 1.9rem;
  color: #ffe4e6;
  background: linear-gradient(
    180deg,
    rgba(244, 63, 94, 0.95),
    rgba(225, 29, 72, 0.95)
  );
  transition:
    filter 0.18s ease,
    transform 0.18s ease;
}

.history-delete-btn:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
}

.history-name,
.job-name {
  color: #e2e8f0;
  font-size: 0.8rem;
}

.history-meta,
.job-meta {
  color: #94a3b8;
  font-size: 0.7rem;
}

.job-error {
  color: #fecdd3;
  font-size: 0.7rem;
  line-height: 1.35;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.input {
  width: 100%;
  border-radius: 0.58rem;
  border: 1px solid rgba(100, 116, 139, 0.5);
  background: rgba(15, 23, 42, 0.65);
  color: #e2e8f0;
  padding: 0.45rem 0.62rem;
}

.upload-box,
.jobs-box,
.result-box {
  margin-top: 0.6rem;
  border-radius: 0.7rem;
  border: 1px solid rgba(100, 116, 139, 0.42);
  background: rgba(2, 6, 23, 0.5);
  padding: 0.6rem;
}

.upload-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.55rem;
}

.upload-head p,
.jobs-title {
  color: #e2e8f0;
  font-size: 0.8rem;
  font-weight: 600;
}

.upload-counter {
  margin-top: 0.18rem;
  color: #94a3b8;
  font-size: 0.7rem;
  font-weight: 500;
}

.upload-action-row {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.upload-actions {
  margin-top: 0.45rem;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.btn-analyze {
  padding: 0.42rem 0.82rem;
  border-radius: 0.56rem;
  font-size: 0.76rem;
  font-weight: 700;
  color: #f0fdf4;
  border: 1px solid rgba(34, 197, 94, 0.5);
  background: linear-gradient(
    180deg,
    rgba(34, 197, 94, 0.82),
    rgba(21, 128, 61, 0.88)
  );
  transition: opacity 0.15s;
}

.btn-analyze:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-analyze:not(:disabled):hover {
  filter: brightness(1.1);
}

.jobs-list {
  margin-top: 0.45rem;
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.jobs-pagination {
  margin-top: 0.6rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.35rem;
}

.jobs-page-btn {
  border-radius: 0.55rem;
  border: 1px solid rgba(100, 116, 139, 0.4);
  background: rgba(15, 23, 42, 0.45);
  color: #e2e8f0;
  padding: 0.28rem 0.58rem;
  font-size: 0.74rem;
  font-weight: 600;
}

.jobs-page-btn-active {
  color: #082f49;
  border-color: transparent;
  background: linear-gradient(
    180deg,
    rgba(34, 211, 238, 0.95),
    rgba(8, 145, 178, 0.95)
  );
}

.job-row {
  border-radius: 0.58rem;
  border: 1px solid rgba(100, 116, 139, 0.4);
  background: rgba(2, 6, 23, 0.45);
  padding: 0.45rem 0.56rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.job-row-active {
  border-color: rgba(34, 211, 238, 0.68);
  box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.3);
}

.job-row-failed {
  border-color: rgba(244, 63, 94, 0.42);
  background: rgba(76, 5, 25, 0.18);
}

.job-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.14rem;
  flex: 1; /* allow main content to occupy available space */
}

.job-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.job-progress {
  margin-top: 0.2rem;
  width: 100%;
  height: 0.32rem;
  border-radius: 999px;
  background: rgba(51, 65, 85, 0.7);
  overflow: hidden;
}

.job-progress-fill {
  height: 100%;
  background: linear-gradient(
    90deg,
    rgba(34, 211, 238, 0.95),
    rgba(14, 116, 144, 0.95)
  );
  transition: width 0.35s ease;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.45rem;
}

.dashboard-item {
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.36);
  background: rgba(2, 6, 23, 0.42);
  padding: 0.4rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.dashboard-item span {
  color: #94a3b8;
  font-size: 0.67rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.dashboard-item strong {
  color: #e2e8f0;
  font-size: 0.92rem;
}

.dashboard-item.highlight-item {
  background: rgba(15, 23, 42, 0.6);
  border-color: rgba(148, 163, 184, 0.3);
}

.score-pass strong {
  color: #34d399 !important; /* Emerald 400 */
}

.score-fail strong {
  color: #fb7185 !important; /* Rose 400 */
}

.result-layout {
  margin-top: 0.5rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
  min-height: 0;
  height: 100%; /* Force grid to fill available vertical space */
}

.result-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: 0.65rem;
  border: 1px solid rgba(100, 116, 139, 0.36);
  background: rgba(2, 6, 23, 0.45);
  overflow: hidden; /* Do not let the panel itself scroll, let children scroll */
}

.result-panel-header {
  padding: 0.45rem 0.45rem 0 0.45rem;
  flex-shrink: 0;
}

.result-panel-content-fixed {
  flex: 1;
  min-height: 0;
  overflow: hidden; /* Give TranscriptViewer control over its internal scroll */
}

.result-panel-content-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto; /* Let the Scorecard scroll natively */
  padding: 0.45rem;
  --result-tabs-sticky-offset: 2.5rem;
}

.result-panel-content-scroll-no-outer-scroll {
  overflow: hidden;
}

.score-editor {
  margin-top: 0.55rem;
  border-radius: 0.6rem;
  border: 1px solid rgba(100, 116, 139, 0.35);
  background: rgba(2, 6, 23, 0.4);
  padding: 0.55rem;
}

.score-editor-standalone {
  margin-top: 0.45rem;
  height: calc(100% - 2.8rem);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.result-detail-tabs {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
  position: sticky;
  top: 0;
  z-index: 20;
  background: rgba(2, 6, 23, 0.92);
  border-bottom: 1px solid rgba(100, 116, 139, 0.35);
  padding: 0.22rem 0 0.45rem 0;
}

.score-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.45rem;
  margin-bottom: 0.5rem;
  position: sticky;
  top: 0;
  z-index: 19;
  background: rgba(2, 6, 23, 0.9);
  border-bottom: 1px solid rgba(100, 116, 139, 0.35);
  padding: 0.2rem 0 0.42rem 0;
}

.score-editor-head-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.score-editor-title {
  color: #e2e8f0;
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.score-rag-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  color: #cbd5e1;
  font-size: 0.72rem;
}

.score-rag-toggle input[type="checkbox"] {
  accent-color: #06b6d4;
}

.score-editor-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  margin-top: 0.45rem;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 0.1rem;
}

.score-editor-row {
  border-radius: 0.56rem;
  border: 1px solid rgba(100, 116, 139, 0.32);
  background: rgba(15, 23, 42, 0.65);
  padding: 0.46rem;
}

.score-editor-row-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.6rem;
}

.score-editor-row-title {
  color: #e2e8f0;
  font-size: 0.76rem;
  font-weight: 600;
}

.score-editor-row-meta {
  color: #94a3b8;
  font-size: 0.7rem;
}

.score-editor-controls {
  margin-top: 0.38rem;
  display: flex;
  gap: 0.4rem;
}

.score-toggle-btn {
  padding: 0.34rem 0.48rem;
  font-size: 0.7rem;
}

.score-toggle-active {
  border-color: rgba(34, 211, 238, 0.68);
  background: rgba(8, 47, 73, 0.45);
  color: #bae6fd;
}

.score-edit-note {
  margin-top: 0.4rem;
  min-height: 2.2rem;
  resize: vertical;
  font-size: 0.72rem;
}

.score-history-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.score-history-row {
  border-radius: 0.62rem;
  border: 1px solid rgba(100, 116, 139, 0.36);
  background: rgba(2, 6, 23, 0.45);
  padding: 0.56rem;
}

.score-history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.score-history-title {
  color: #e2e8f0;
  font-size: 0.78rem;
  font-weight: 600;
}

.score-history-source {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  border: 1px solid rgba(34, 197, 94, 0.4);
  color: #86efac;
  background: rgba(22, 101, 52, 0.25);
  padding: 0.1rem 0.46rem;
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.score-history-source-auto {
  border-color: rgba(245, 158, 11, 0.45);
  color: #fcd34d;
  background: rgba(146, 64, 14, 0.26);
}

.score-history-meta {
  margin-top: 0.25rem;
  color: #94a3b8;
  font-size: 0.72rem;
}

.score-history-note {
  margin-top: 0.3rem;
  color: #e2e8f0;
  font-size: 0.75rem;
}

.result-summary {
  margin-top: 0.45rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.55rem;
}

.result-title {
  color: #cbd5e1;
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-bottom: 0.35rem;
}

.btn-primary {
  padding: 0.42rem 0.66rem;
  border-radius: 0.56rem;
  font-size: 0.76rem;
  font-weight: 700;
  color: #082f49;
  background: linear-gradient(
    180deg,
    rgba(34, 211, 238, 0.95),
    rgba(8, 145, 178, 0.95)
  );
}

.btn-danger {
  padding: 0.34rem 0.56rem;
  border-radius: 0.52rem;
  font-size: 0.72rem;
  color: #fecaca;
  border: 1px solid rgba(244, 63, 94, 0.55);
  background: rgba(127, 29, 29, 0.35);
}

.btn-ghost {
  padding: 0.38rem 0.62rem;
  border-radius: 0.54rem;
  font-size: 0.74rem;
  color: #cbd5e1;
  border: 1px solid rgba(100, 116, 139, 0.56);
}

.msg-muted {
  color: #94a3b8;
  font-size: 0.78rem;
}

.empty-home {
  border-radius: 0.8rem;
  border: 1px dashed rgba(148, 163, 184, 0.35);
  color: #94a3b8;
  padding: 0.8rem;
}

.matrix-empty-state {
  border-radius: 0.95rem;
  border: 1px solid rgba(251, 146, 60, 0.5);
  background:
    radial-gradient(
      circle at 0% 0%,
      rgba(251, 146, 60, 0.18),
      rgba(15, 23, 42, 0.94) 45%
    ),
    linear-gradient(180deg, rgba(30, 41, 59, 0.7), rgba(2, 6, 23, 0.84));
  padding: 0.95rem;
}

.matrix-empty-hero {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
}

.matrix-empty-icon-wrap {
  inline-size: 2rem;
  block-size: 2rem;
  border-radius: 0.65rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fdba74;
  border: 1px solid rgba(251, 146, 60, 0.55);
  background: rgba(124, 45, 18, 0.45);
}

.matrix-empty-kicker {
  color: #fdba74;
  font-size: 0.67rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.matrix-empty-title {
  margin-top: 0.15rem;
  color: #ffedd5;
  font-weight: 700;
  font-size: 1rem;
}

.matrix-empty-desc {
  margin-top: 0.35rem;
  color: #fed7aa;
  font-size: 0.8rem;
  line-height: 1.45;
}

.matrix-empty-steps {
  margin-top: 0.7rem;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.42rem;
}

.matrix-step-chip {
  border-radius: 0.62rem;
  border: 1px solid rgba(251, 146, 60, 0.36);
  background: rgba(124, 45, 18, 0.22);
  color: #ffedd5;
  font-size: 0.76rem;
  padding: 0.35rem 0.48rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.matrix-step-num {
  inline-size: 1.15rem;
  block-size: 1.15rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.68rem;
  font-weight: 700;
  color: #431407;
  background: #fdba74;
}

.matrix-empty-detail {
  margin-top: 0.62rem;
  border-radius: 0.58rem;
  border: 1px dashed rgba(251, 146, 60, 0.45);
  background: rgba(2, 6, 23, 0.38);
  color: #fcd34d;
  padding: 0.4rem 0.48rem;
  font-size: 0.72rem;
}

.matrix-empty-actions {
  margin-top: 0.7rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.48rem;
}

.create-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(2, 6, 23, 0.64);
  display: grid;
  place-items: center;
}

.create-modal {
  width: min(420px, calc(100vw - 2rem));
  border-radius: 0.8rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(15, 23, 42, 0.96);
  padding: 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.confirm-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483001;
  background: rgba(2, 6, 23, 0.72);
  display: grid;
  place-items: center;
  padding: 0.7rem;
}

.confirm-modal {
  width: min(460px, calc(100vw - 1.4rem));
  border-radius: 0.9rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(15, 23, 42, 0.98);
  padding: 0.85rem;
}

.confirm-modal-title {
  color: #f8fafc;
  font-size: 0.98rem;
  font-weight: 700;
}

.confirm-modal-message {
  margin-top: 0.35rem;
  color: #cbd5e1;
  font-size: 0.82rem;
  line-height: 1.45;
}

.confirm-modal-actions {
  margin-top: 0.75rem;
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
}

.result-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  background: rgba(2, 6, 23, 0.72);
  display: grid;
  place-items: center;
  padding: 0.7rem;
  pointer-events: auto;
}

.result-modal {
  width: min(1600px, calc(100vw - 1.4rem));
  height: calc(100vh - 1.4rem);
  border-radius: 0.95rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  background: rgba(15, 23, 42, 0.98);
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.result-modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.65rem;
}

.result-modal-tabs {
  display: flex;
  align-items: center;
  gap: 0.38rem;
}

.result-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.34rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(100, 116, 139, 0.45);
  color: #cbd5e1;
  background: rgba(30, 41, 59, 0.5);
  padding: 0.32rem 0.56rem;
  font-size: 0.72rem;
}

.result-tab-btn-active {
  border-color: rgba(34, 211, 238, 0.7);
  color: #bae6fd;
  background: rgba(8, 47, 73, 0.56);
}

.result-modal-title {
  color: #e2e8f0;
  font-size: 0.95rem;
  font-weight: 700;
}

.result-modal-meta {
  margin-top: 0.18rem;
  color: #94a3b8;
  font-size: 0.75rem;
}

.result-modal-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
}

.result-modal-body-lock-scroll {
  overflow: hidden;
}

.result-modal-body .result-layout {
  margin-top: 0;
  min-height: 100%;
}

.create-modal-title {
  color: #e2e8f0;
  font-size: 0.9rem;
  font-weight: 700;
}

.create-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.45rem;
}

@media (max-width: 1100px) {
  .workspace-body {
    grid-template-columns: 1fr;
  }

  .qa-layout {
    grid-template-columns: 1fr;
  }

  .dashboard-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .result-layout {
    grid-template-columns: 1fr;
  }

  .result-summary {
    align-items: flex-start;
    flex-direction: column;
  }

  .score-editor-head {
    align-items: flex-start;
    flex-direction: column;
  }

  .score-editor-head-actions {
    width: 100%;
    justify-content: space-between;
  }

  .score-editor-controls {
    flex-direction: column;
  }
}
</style>
