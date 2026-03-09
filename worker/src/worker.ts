import { eq, sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "./db.js";
import { env } from "./config.js";
import {
  batches,
  globalProviderSettings,
  jobAnalyses,
  jobEvaluationRows,
  jobs,
  jobSegments,
  jobTranscripts,
  projects,
  projectMatrixRows,
} from "./schema.js";
import { transcribeAudioFile } from "./services/transcribe.js";
import { analyzeConversation } from "./services/analyze.js";
import { syncManualScoreEditToRag } from "./services/rag.js";
import { fetchRagGuidance } from "./services/ragRetrieve.js";

const QUEUES = {
  TRANSCRIBE: "job.transcribe",
  ANALYZE: "job.analyze",
  FINALIZE: "job.finalize",
  RAG_SYNC_CORRECTION: "rag.sync.correction",
  WS_EVENTS: "ws.events",
} as const;

const STRICT_CE_POLICY = "strict_zero_all_ce_if_any_fail" as const;
const WEIGHTED_CE_POLICY = "weighted_ce_independent" as const;

const boss = new PgBoss({ connectionString: env.DATABASE_URL });
const moduleDir = dirname(fileURLToPath(import.meta.url));
type ProviderConfig = {
  elevenlabsApiKey: string;
  xaiApiKey: string;
  xaiModel: string;
  xaiManagementApiKey?: string;
  xaiRagModel: string;
};
type BatchJobCounts = {
  total: number;
  completed: number;
  failed: number;
  running: number;
  transcribing: number;
  analyzing: number;
  uploading: number;
  queued: number;
};
let providerConfigCache: { value: ProviderConfig; expiresAt: number } | null = null;

const extractJobIdFromPayload = (payload: unknown): string | null => {
  const jobLike = Array.isArray(payload) ? payload[0] : payload;
  const data = (jobLike as any)?.data;
  const raw = data?.jobId;
  if (!raw) return null;
  return String(raw);
};

const extractFieldFromPayload = (
  payload: unknown,
  key: string,
): string | null => {
  const jobLike = Array.isArray(payload) ? payload[0] : payload;
  const data = (jobLike as any)?.data;
  const raw = data?.[key];
  if (!raw) return null;
  return String(raw);
};

const resolveJobFilePath = (rawPath: string) => {
  if (isAbsolute(rawPath)) return rawPath;

  const candidates = [
    resolve(process.cwd(), rawPath),
    resolve(moduleDir, "../", rawPath),
    resolve(moduleDir, "../../backend", rawPath),
    resolve(moduleDir, "../../", rawPath),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return resolve(process.cwd(), rawPath);
};

const emitWsEvent = async (event: Record<string, unknown>) => {
  await boss.send(QUEUES.WS_EVENTS, event);
};

const getProviderConfig = async () => {
  if (providerConfigCache && providerConfigCache.expiresAt > Date.now()) {
    return providerConfigCache.value;
  }

  const settings = await db.query.globalProviderSettings.findFirst({
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
  });

  const elevenlabsApiKey = settings?.elevenlabsApiKey || env.ELEVENLABS_API_KEY;
  const xaiApiKey = settings?.xaiApiKey || env.XAI_API_KEY;
  const xaiModel = settings?.xaiModel || env.XAI_MODEL;
  const xaiManagementApiKey =
    settings?.xaiManagementApiKey || env.XAI_MANAGEMENT_API_KEY;
  const xaiRagModel = settings?.xaiRagModel || env.XAI_RAG_MODEL;

  if (!elevenlabsApiKey) throw new Error("Missing global ElevenLabs API key");
  if (!xaiApiKey) throw new Error("Missing global xAI API key");

  const nextConfig = {
    elevenlabsApiKey,
    xaiApiKey,
    xaiModel,
    xaiManagementApiKey,
    xaiRagModel,
  };
  providerConfigCache = {
    value: nextConfig,
    expiresAt: Date.now() + env.WORKER_PROVIDER_CACHE_TTL_MS,
  };
  return nextConfig;
};

const queryBatchJobCounts = async (batchId: string): Promise<BatchJobCounts> => {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${jobs.status} = 'completed')::int`,
      failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')::int`,
      running: sql<number>`count(*) filter (where ${jobs.status} in ('uploading', 'transcribing', 'analyzing'))::int`,
      transcribing: sql<number>`count(*) filter (where ${jobs.status} = 'transcribing')::int`,
      analyzing: sql<number>`count(*) filter (where ${jobs.status} = 'analyzing')::int`,
      uploading: sql<number>`count(*) filter (where ${jobs.status} = 'uploading')::int`,
      queued: sql<number>`count(*) filter (where ${jobs.status} = 'queued')::int`,
    })
    .from(jobs)
    .where(eq(jobs.batchId, batchId));

  return {
    total: Number(counts?.total || 0),
    completed: Number(counts?.completed || 0),
    failed: Number(counts?.failed || 0),
    running: Number(counts?.running || 0),
    transcribing: Number(counts?.transcribing || 0),
    analyzing: Number(counts?.analyzing || 0),
    uploading: Number(counts?.uploading || 0),
    queued: Number(counts?.queued || 0),
  };
};

const publishBatchProgress = async (
  batchId: string,
  tenantId: string,
  projectId: string,
  counts: BatchJobCounts,
) => {
  await emitWsEvent({
    event: "batch.progress",
    tenantId,
    projectId,
    batchId,
    total: counts.total,
    completed: counts.completed,
    failed: counts.failed,
    running: counts.running,
    updatedAt: new Date().toISOString(),
  });
};

const updateJobStatus = async (
  jobId: string,
  status: "queued" | "uploading" | "transcribing" | "analyzing" | "completed" | "failed",
  progress: number,
  errorMessage: string | null = null,
) => {
  const [job] = await db
    .update(jobs)
    .set({
      status,
      progress,
      errorMessage,
      updatedAt: new Date(),
      ...(status === "transcribing" ? { startedAt: new Date() } : {}),
      ...(status === "completed" ? { completedAt: new Date() } : {}),
    })
    .where(eq(jobs.id, jobId))
    .returning();

  await emitWsEvent({
    event: "job.status.changed",
    tenantId: job.tenantId,
    projectId: job.projectId,
    batchId: job.batchId,
    jobId: job.id,
    status: job.status,
    progress: job.progress,
    updatedAt: job.updatedAt.toISOString(),
  });

  if (status === "failed") {
    await emitWsEvent({
      event: "job.failed",
      tenantId: job.tenantId,
      projectId: job.projectId,
      batchId: job.batchId,
      jobId: job.id,
      message: errorMessage ?? "Processing failed",
      updatedAt: new Date().toISOString(),
    });
  }

  if (status === "completed") {
    const analysis = await db.query.jobAnalyses.findFirst({ where: eq(jobAnalyses.jobId, job.id) });
    await emitWsEvent({
      event: "job.completed",
      tenantId: job.tenantId,
      projectId: job.projectId,
      batchId: job.batchId,
      jobId: job.id,
      totalScore: analysis?.totalScore ?? 0,
      updatedAt: new Date().toISOString(),
    });
  }

  const counts = await queryBatchJobCounts(job.batchId);
  await publishBatchProgress(job.batchId, job.tenantId, job.projectId, counts);
  await maybeUpdateBatchStatus(job.batchId, counts);
};

const maybeUpdateBatchStatus = async (
  batchId: string,
  counts?: BatchJobCounts,
) => {
  const batchCounts = counts ?? (await queryBatchJobCounts(batchId));
  if (!batchCounts.total) return;
  let status: "queued" | "uploading" | "transcribing" | "analyzing" | "completed" | "failed" = "queued";
  if (batchCounts.completed === batchCounts.total) status = "completed";
  else if (batchCounts.failed > 0) status = "failed";
  else if (batchCounts.analyzing > 0) status = "analyzing";
  else if (batchCounts.transcribing > 0) status = "transcribing";
  else if (batchCounts.uploading > 0) status = "uploading";

  await db
    .update(batches)
    .set({ status, updatedAt: new Date() })
    .where(eq(batches.id, batchId));
};

const buildWorkOptions = (input: {
  localConcurrency: number;
  batchSize: number;
  pollingIntervalSeconds?: number;
}) => ({
  localConcurrency: Math.max(1, Math.floor(input.localConcurrency || 1)),
  batchSize: Math.max(1, Math.floor(input.batchSize || 1)),
  pollingIntervalSeconds:
    input.pollingIntervalSeconds ?? env.WORKER_POLLING_INTERVAL_SECONDS,
});

const applyTranscriptCleanup = async (
  jobId: string,
  cleanup: Array<{ id: number; role: "CS" | "Customer"; cleaned_text: string }>,
) => {
  const updates = cleanup
    .map((entry) => ({
      id: Number(entry.id),
      role: entry.role,
      cleanedText: String(entry.cleaned_text || ""),
    }))
    .filter(
      (entry) =>
        Number.isInteger(entry.id) &&
        entry.id >= 0 &&
        (entry.role === "CS" || entry.role === "Customer"),
    );

  if (!updates.length) return;

  const payload = JSON.stringify(
    updates.map((entry) => ({
      segment_index: entry.id,
      next_role: entry.role,
      next_cleaned_text: entry.cleanedText,
    })),
  );

  await db.execute(sql`
    UPDATE ${jobSegments} AS js
    SET
      role = v.next_role,
      cleaned_text = v.next_cleaned_text,
      sentiment = NULL
    FROM (
      SELECT *
      FROM jsonb_to_recordset(${payload}::jsonb) AS x(
        segment_index integer,
        next_role text,
        next_cleaned_text text
      )
    ) AS v
    WHERE js.job_id = ${jobId}
      AND js.segment_index = v.segment_index
  `);
};

const start = async () => {
  await boss.start();
  await boss.createQueue(QUEUES.TRANSCRIBE);
  await boss.createQueue(QUEUES.ANALYZE);
  await boss.createQueue(QUEUES.FINALIZE);
  await boss.createQueue(QUEUES.RAG_SYNC_CORRECTION);
  await boss.createQueue(QUEUES.WS_EVENTS);

  await boss.work(
    QUEUES.TRANSCRIBE,
    buildWorkOptions({
      localConcurrency: env.WORKER_TRANSCRIBE_LOCAL_CONCURRENCY,
      batchSize: env.WORKER_TRANSCRIBE_BATCH_SIZE,
      pollingIntervalSeconds:
        env.WORKER_TRANSCRIBE_POLLING_INTERVAL_SECONDS,
    }),
    async (payload: any) => {
    const jobId = extractJobIdFromPayload(payload);
    if (!jobId) {
      throw new Error("Invalid transcribe payload: missing jobId");
    }

    try {
      const current = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
      if (!current) return;

      const provider = await getProviderConfig();

      await updateJobStatus(jobId, "transcribing", 35);
      const filePath = resolveJobFilePath(current.filePath);
      const transcription = await transcribeAudioFile(filePath, provider.elevenlabsApiKey, {
        jobId,
        batchId: current.batchId,
      });

      await db.insert(jobTranscripts).values({
        jobId,
        fullText: transcription.text,
        provider: "elevenlabs",
        language: "ind",
      });

      await db.insert(jobSegments).values(
        transcription.segments.map((seg, idx) => ({
          jobId,
          segmentIndex: idx,
          speakerId: seg.speakerId,
          startSec: seg.start,
          endSec: seg.end,
          rawText: seg.text,
          cleanedText: seg.text,
          wordsJson: seg.words,
        })),
      );

      await boss.send(
        QUEUES.ANALYZE,
        { jobId },
        { retryLimit: 3, retryDelay: 20, retryBackoff: true },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcription failed";
      await updateJobStatus(jobId, "failed", 100, message);
      // Keep failed state final; manual retry is handled by API/UI.
      return;
    }
    },
  );

  await boss.work(
    QUEUES.ANALYZE,
    buildWorkOptions({
      localConcurrency: env.WORKER_ANALYZE_LOCAL_CONCURRENCY,
      batchSize: env.WORKER_ANALYZE_BATCH_SIZE,
      pollingIntervalSeconds: env.WORKER_ANALYZE_POLLING_INTERVAL_SECONDS,
    }),
    async (payload: any) => {
    const jobId = extractJobIdFromPayload(payload);
    if (!jobId) {
      throw new Error("Invalid analyze payload: missing jobId");
    }

    try {
      const current = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
      if (!current) return;

      const provider = await getProviderConfig();

      await updateJobStatus(jobId, "analyzing", 78);

      const segments = await db.query.jobSegments.findMany({
        where: eq(jobSegments.jobId, jobId),
        orderBy: (t, { asc }) => [asc(t.segmentIndex)],
      });

      const matrixRows = await db.query.projectMatrixRows.findMany({
        where: eq(projectMatrixRows.matrixVersionId, current.matrixVersionId),
        orderBy: (t, { asc }) => [asc(t.rowIndex)],
      });
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, current.projectId),
        columns: { ceScoringPolicy: true, xaiCollectionId: true },
      });
      const ceScoringPolicy =
        project?.ceScoringPolicy === WEIGHTED_CE_POLICY
          ? WEIGHTED_CE_POLICY
          : STRICT_CE_POLICY;
      const ragGuidance = await fetchRagGuidance({
        xaiApiKey: provider.xaiApiKey,
        ragModel: provider.xaiRagModel,
        collectionId: project?.xaiCollectionId || null,
        callType: current.callType,
        matrixRows: matrixRows.map((row) => ({
          area: row.area,
          parameter: row.parameter,
          description: row.description,
          weight: row.weight,
        })),
        jobId,
        batchId: current.batchId,
      });

      const result = await analyzeConversation(
        segments.map((seg, idx) => ({
          id: idx,
          speakerId: seg.speakerId,
          text: seg.cleanedText || seg.rawText,
          start: seg.startSec,
          end: seg.endSec,
        })),
        current.callType,
        matrixRows.map((row) => ({
          area: row.area,
          parameter: row.parameter,
          description: row.description,
          weight: row.weight,
        })),
        provider.xaiApiKey,
        provider.xaiModel,
        ragGuidance,
        { jobId, batchId: current.batchId },
      );
      const adjustedEvaluationTable = result.qa_scorecard.evaluation_table.map(
        (row) => ({ ...row }),
      );
      const hasCeDefect = adjustedEvaluationTable.some((row) => {
        if (String(row.parameter || "").toUpperCase() !== "CE") return false;
        const score = Number(row.score ?? 0);
        const maxScore = Number(row.max_score ?? 0);
        if (!Number.isFinite(score) || !Number.isFinite(maxScore)) return false;
        return score < maxScore;
      });
      if (ceScoringPolicy === STRICT_CE_POLICY && hasCeDefect) {
        for (const row of adjustedEvaluationTable) {
          if (String(row.parameter || "").toUpperCase() === "CE") {
            row.score = 0;
          }
        }
      }
      const adjustedScorecard = {
        ...result.qa_scorecard,
        evaluation_table: adjustedEvaluationTable,
      };

      await applyTranscriptCleanup(jobId, result.transcript_cleanup);

      const totalScore = adjustedEvaluationTable.reduce(
        (sum, row) => sum + Number(row.score || 0),
        0,
      );

      await db.insert(jobAnalyses).values({
        jobId,
        summary: result.qa_scorecard.summary,
        routing: result.qa_scorecard.routing,
        redFlags: result.qa_scorecard.red_flags,
        totalScore,
        rawJson: adjustedScorecard,
      });

      await db.insert(jobEvaluationRows).values(
        adjustedEvaluationTable.map((row, idx) => ({
          jobId,
          rowIndex: idx,
          area: row.area,
          parameter: row.parameter,
          description: row.description,
          evidenceTimestamp: row.evidence_timestamp,
          note: row.note,
          score: Number(row.score),
          maxScore: Number(row.max_score || 0),
        })),
      );

      await boss.send(QUEUES.FINALIZE, { jobId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed";
      await updateJobStatus(jobId, "failed", 100, message);
      // Keep failed state final; manual retry is handled by API/UI.
      return;
    }
    },
  );

  await boss.work(
    QUEUES.RAG_SYNC_CORRECTION,
    buildWorkOptions({
      localConcurrency: env.WORKER_RAG_LOCAL_CONCURRENCY,
      batchSize: env.WORKER_RAG_BATCH_SIZE,
      pollingIntervalSeconds: env.WORKER_RAG_POLLING_INTERVAL_SECONDS,
    }),
    async (payload: any) => {
    const scoreEditHistoryId = extractFieldFromPayload(payload, "scoreEditHistoryId");
    if (!scoreEditHistoryId) {
      throw new Error("Invalid RAG sync payload: missing scoreEditHistoryId");
    }

    const provider = await getProviderConfig();
    await syncManualScoreEditToRag({
      scoreEditHistoryId,
      managementApiKey: String(provider.xaiManagementApiKey || ""),
    });
    },
  );

  await boss.work(
    QUEUES.FINALIZE,
    buildWorkOptions({
      localConcurrency: env.WORKER_FINALIZE_LOCAL_CONCURRENCY,
      batchSize: env.WORKER_FINALIZE_BATCH_SIZE,
      pollingIntervalSeconds: env.WORKER_FINALIZE_POLLING_INTERVAL_SECONDS,
    }),
    async (payload: any) => {
    const jobId = extractJobIdFromPayload(payload);
    if (!jobId) {
      throw new Error("Invalid finalize payload: missing jobId");
    }
    const current = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!current) return;

    await updateJobStatus(jobId, "completed", 100, null);
    },
  );

  console.log("Worker is running");
};

start().catch(async (error) => {
  console.error(error);
  await boss.stop();
  await pool.end();
  process.exit(1);
});
