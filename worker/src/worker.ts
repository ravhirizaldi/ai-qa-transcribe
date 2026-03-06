import { and, eq } from "drizzle-orm";
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

  return {
    elevenlabsApiKey,
    xaiApiKey,
    xaiModel,
    xaiManagementApiKey,
    xaiRagModel,
  };
};

const publishBatchProgress = async (batchId: string, tenantId: string, projectId: string) => {
  const batchJobs = await db.query.jobs.findMany({ where: eq(jobs.batchId, batchId) });
  const total = batchJobs.length;
  const completed = batchJobs.filter((job) => job.status === "completed").length;
  const failed = batchJobs.filter((job) => job.status === "failed").length;
  const running = batchJobs.filter((job) => ["uploading", "transcribing", "analyzing"].includes(job.status)).length;

  await emitWsEvent({
    event: "batch.progress",
    tenantId,
    projectId,
    batchId,
    total,
    completed,
    failed,
    running,
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

  await publishBatchProgress(job.batchId, job.tenantId, job.projectId);
  await maybeUpdateBatchStatus(job.batchId);
};

const maybeUpdateBatchStatus = async (batchId: string) => {
  const rows = await db.query.jobs.findMany({ where: eq(jobs.batchId, batchId) });
  if (!rows.length) return;

  let status: "queued" | "uploading" | "transcribing" | "analyzing" | "completed" | "failed" = "queued";
  if (rows.every((row) => row.status === "completed")) status = "completed";
  else if (rows.some((row) => row.status === "failed")) status = "failed";
  else if (rows.some((row) => row.status === "analyzing")) status = "analyzing";
  else if (rows.some((row) => row.status === "transcribing")) status = "transcribing";
  else if (rows.some((row) => row.status === "uploading")) status = "uploading";

  await db
    .update(batches)
    .set({ status, updatedAt: new Date() })
    .where(eq(batches.id, batchId));
};

const start = async () => {
  await boss.start();
  await boss.createQueue(QUEUES.TRANSCRIBE);
  await boss.createQueue(QUEUES.ANALYZE);
  await boss.createQueue(QUEUES.FINALIZE);
  await boss.createQueue(QUEUES.RAG_SYNC_CORRECTION);
  await boss.createQueue(QUEUES.WS_EVENTS);

  await boss.work(QUEUES.TRANSCRIBE, async (payload: any) => {
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
  });

  await boss.work(QUEUES.ANALYZE, async (payload: any) => {
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

      for (let idx = 0; idx < segments.length; idx++) {
        const cleaned = result.transcript_cleanup.find((c) => c.id === idx);
        if (!cleaned) continue;
        await db
          .update(jobSegments)
          .set({
            role: cleaned.role,
            cleanedText: cleaned.cleaned_text,
            sentiment: null,
          })
          .where(and(eq(jobSegments.jobId, jobId), eq(jobSegments.segmentIndex, idx)));
      }

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
  });

  await boss.work(QUEUES.RAG_SYNC_CORRECTION, async (payload: any) => {
    const scoreEditHistoryId = extractFieldFromPayload(payload, "scoreEditHistoryId");
    if (!scoreEditHistoryId) {
      throw new Error("Invalid RAG sync payload: missing scoreEditHistoryId");
    }

    const provider = await getProviderConfig();
    await syncManualScoreEditToRag({
      scoreEditHistoryId,
      managementApiKey: String(provider.xaiManagementApiKey || ""),
    });
  });

  await boss.work(QUEUES.FINALIZE, async (payload: any) => {
    const jobId = extractJobIdFromPayload(payload);
    if (!jobId) {
      throw new Error("Invalid finalize payload: missing jobId");
    }
    const current = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
    if (!current) return;

    await updateJobStatus(jobId, "completed", 100, null);
  });

  console.log("Worker is running");
};

start().catch(async (error) => {
  console.error(error);
  await boss.stop();
  await pool.end();
  process.exit(1);
});
