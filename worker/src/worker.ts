import { and, eq } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { db, pool } from "./db.js";
import { env } from "./config.js";
import {
  batches,
  jobAnalyses,
  jobEvaluationRows,
  jobs,
  jobSegments,
  jobTranscripts,
  projectMatrixRows,
  projectProviderSettings,
} from "./schema.js";
import { transcribeAudioFile } from "./services/transcribe.js";
import { analyzeConversation } from "./services/analyze.js";

const QUEUES = {
  TRANSCRIBE: "job.transcribe",
  ANALYZE: "job.analyze",
  FINALIZE: "job.finalize",
  WS_EVENTS: "ws.events",
} as const;

const boss = new PgBoss({ connectionString: env.DATABASE_URL });

const emitWsEvent = async (event: Record<string, unknown>) => {
  await boss.send(QUEUES.WS_EVENTS, event);
};

const getProviderConfig = async (projectId: string) => {
  const settings = await db.query.projectProviderSettings.findFirst({
    where: eq(projectProviderSettings.projectId, projectId),
  });

  const elevenlabsApiKey = settings?.elevenlabsApiKey || env.ELEVENLABS_API_KEY;
  const xaiApiKey = settings?.xaiApiKey || env.XAI_API_KEY;
  const xaiModel = settings?.xaiModel || env.XAI_MODEL;

  if (!elevenlabsApiKey) throw new Error("Missing ElevenLabs API key in project settings");
  if (!xaiApiKey) throw new Error("Missing xAI API key in project settings");

  return { elevenlabsApiKey, xaiApiKey, xaiModel };
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
  await boss.createQueue(QUEUES.WS_EVENTS);

  await boss.work(QUEUES.TRANSCRIBE, async (job: any) => {
    const jobId = String(job.data.jobId);

    try {
      const current = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
      if (!current) return;

      const provider = await getProviderConfig(current.projectId);

      await updateJobStatus(jobId, "transcribing", 35);
      const transcription = await transcribeAudioFile(current.filePath, provider.elevenlabsApiKey);

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
      throw error;
    }
  });

  await boss.work(QUEUES.ANALYZE, async (job: any) => {
    const jobId = String(job.data.jobId);

    try {
      const current = await db.query.jobs.findFirst({ where: eq(jobs.id, jobId) });
      if (!current) return;

      const provider = await getProviderConfig(current.projectId);

      await updateJobStatus(jobId, "analyzing", 78);

      const segments = await db.query.jobSegments.findMany({
        where: eq(jobSegments.jobId, jobId),
        orderBy: (t, { asc }) => [asc(t.segmentIndex)],
      });

      const matrixRows = await db.query.projectMatrixRows.findMany({
        where: eq(projectMatrixRows.matrixVersionId, current.matrixVersionId),
        orderBy: (t, { asc }) => [asc(t.rowIndex)],
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
      );

      for (let idx = 0; idx < segments.length; idx++) {
        const cleaned = result.transcript_cleanup.find((c) => c.id === idx);
        if (!cleaned) continue;
        await db
          .update(jobSegments)
          .set({
            role: cleaned.role,
            cleanedText: cleaned.cleaned_text,
            sentiment: cleaned.sentiment,
          })
          .where(and(eq(jobSegments.jobId, jobId), eq(jobSegments.segmentIndex, idx)));
      }

      const totalScore = result.qa_scorecard.evaluation_table.reduce(
        (sum, row) => sum + Number(row.score || 0),
        0,
      );

      await db.insert(jobAnalyses).values({
        jobId,
        summary: result.qa_scorecard.summary,
        routing: result.qa_scorecard.routing,
        redFlags: result.qa_scorecard.red_flags,
        totalScore,
        rawJson: result.qa_scorecard,
      });

      await db.insert(jobEvaluationRows).values(
        result.qa_scorecard.evaluation_table.map((row, idx) => ({
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
      throw error;
    }
  });

  await boss.work(QUEUES.FINALIZE, async (job: any) => {
    const jobId = String(job.data.jobId);
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
