import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { basename, extname } from "node:path";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { db } from "../db.js";
import {
  batches,
  jobAnalyses,
  jobScoreEditHistory,
  jobEvaluationRows,
  jobs,
  jobSegments,
  jobTranscripts,
  projects,
  users,
} from "../../drizzle/schema.js";
import {
  assertProjectAccess,
  assertProjectPermission,
  getActiveMatrixVersion,
  isSuperAdminUser,
} from "../repos/access.js";
import { deleteUploadFile, saveUpload } from "../storage.js";
import { boss, QUEUES } from "../queue.js";
type CallType = "inbound" | "outbound";

const ACTIVE_JOB_STATUSES = ["queued", "uploading", "transcribing", "analyzing"] as const;
const DEFAULT_BATCH_HISTORY_LOCK_DAYS = 2;
const BATCH_HISTORY_LOCKED_MESSAGE =
  "Batch is locked (view-only) after the configured lock period.";
const STRICT_CE_POLICY = "strict_zero_all_ce_if_any_fail" as const;
const SCORE_EDIT_SOURCE_MANUAL = "manual" as const;
const SCORE_EDIT_SOURCE_STRICT_AUTO = "ce_strict_auto" as const;
const resolveUserFullname = (value: string | null | undefined) => {
  const name = String(value || "").trim();
  return name || "User";
};

const normalizeBatchHistoryLockDays = (value: number | null | undefined) => {
  const days = Number(value ?? DEFAULT_BATCH_HISTORY_LOCK_DAYS);
  if (!Number.isFinite(days)) return DEFAULT_BATCH_HISTORY_LOCK_DAYS;
  return Math.max(1, Math.floor(days));
};

const getBatchLockMeta = (createdAt: Date, lockDays: number) => {
  const lockAt = new Date(createdAt.getTime() + lockDays * 24 * 60 * 60 * 1000);
  return {
    lockDays,
    lockAt,
    isLocked: Date.now() >= lockAt.getTime(),
  };
};

export const jobRoutes: FastifyPluginAsync = async (app) => {
  const hasActiveJobsInBatch = async (batchId: string) => {
    const activeJob = await db.query.jobs.findFirst({
      where: and(eq(jobs.batchId, batchId), inArray(jobs.status, [...ACTIVE_JOB_STATUSES])),
      columns: { id: true },
    });
    return Boolean(activeJob);
  };

  app.get(
    "/projects/:projectId/batches",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const userId = (request.user as any).sub as string;
      const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
      const project = await db.query.projects.findFirst({ where: eq(projects.id, params.projectId) });
      if (!project) {
        return reply.code(404).send({ message: "Project not found" });
      }
      await assertProjectPermission(project.tenantId, project.id, userId, "qa.read");
      const lockDays = normalizeBatchHistoryLockDays(project.batchHistoryLockDays);

      const projectBatches = await db.query.batches.findMany({
        where: eq(batches.projectId, params.projectId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });
      const creatorIds = [...new Set(projectBatches.map((batch) => batch.userId))];
      const creators =
        creatorIds.length > 0
          ? await db.query.users.findMany({
              where: inArray(users.id, creatorIds),
              columns: { id: true, fullname: true },
            })
          : [];
      const creatorsById = new Map(creators.map((user) => [user.id, user]));

      const batchIds = projectBatches.map((batch) => batch.id);
      const allJobs =
        batchIds.length > 0
          ? await db.query.jobs.findMany({
              where: inArray(jobs.batchId, batchIds),
            })
          : [];

      return projectBatches.map((batch) => {
        const batchJobs = allJobs.filter((job) => job.batchId === batch.id);
        const completedJobs = batchJobs.filter((job) => job.status === "completed").length;
        const failedJobs = batchJobs.filter((job) => job.status === "failed").length;
        return {
          id: batch.id,
          tenantId: batch.tenantId,
          projectId: batch.projectId,
          callType: batch.callType,
          status: batch.status,
          createdAt: batch.createdAt,
          updatedAt: batch.updatedAt,
          createdBy: batch.userId,
          createdByFullname: resolveUserFullname(
            creatorsById.get(batch.userId)?.fullname,
          ),
          ...getBatchLockMeta(batch.createdAt, lockDays),
          totalJobs: batchJobs.length,
          completedJobs,
          failedJobs,
        };
      });
    },
  );

  app.post(
    "/projects/:projectId/batches",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
      const payload = z
        .object({
          tenantId: z.string().uuid(),
          callType: z.enum(["inbound", "outbound"]),
          name: z.string().min(1).optional(),
        })
        .parse(request.body);

      const project = await assertProjectAccess(
        payload.tenantId,
        params.projectId,
        (request.user as any).sub,
      );
      await assertProjectPermission(
        payload.tenantId,
        params.projectId,
        (request.user as any).sub,
        "jobs:manage",
      );

      const supportsCallType =
        (payload.callType === "inbound" && project.supportsInbound) ||
        (payload.callType === "outbound" && project.supportsOutbound);
      if (!supportsCallType) {
        return reply.code(400).send({ message: "Project does not support selected call type" });
      }

      const [batch] = await db
        .insert(batches)
        .values({
          tenantId: payload.tenantId,
          projectId: params.projectId,
          userId: (request.user as any).sub,
          callType: payload.callType,
          status: "queued",
        })
        .returning();

      return {
        id: batch.id,
        tenantId: batch.tenantId,
        projectId: batch.projectId,
        callType: batch.callType,
        status: batch.status,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
      };
    },
  );

  app.post("/batches", { preHandler: app.authenticate }, async (request, reply) => {
    const files: Array<{ fileName: string; filePath: string }> = [];
    let tenantId = "";
    let projectId = "";
    let callType = "inbound" as CallType;

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const saved = await saveUpload(part);
        files.push(saved);
      } else {
        if (part.fieldname === "tenantId") tenantId = String(part.value ?? "");
        if (part.fieldname === "projectId") projectId = String(part.value ?? "");
        if (part.fieldname === "callType") callType = z.enum(["inbound", "outbound"]).parse(part.value);
      }
    }

    const tenantUuid = z.string().uuid().parse(tenantId);
    const projectUuid = z.string().uuid().parse(projectId);

    if (!files.length) {
      return reply.code(400).send({ message: "No files uploaded" });
    }

    const project = await assertProjectAccess(
      tenantUuid,
      projectUuid,
      (request.user as any).sub,
    );
    await assertProjectPermission(tenantUuid, projectUuid, (request.user as any).sub, "jobs:manage");

    const supportsCallType =
      (callType === "inbound" && project.supportsInbound) ||
      (callType === "outbound" && project.supportsOutbound);
    if (!supportsCallType) {
      return reply.code(400).send({ message: "Project does not support selected call type" });
    }

    const activeMatrix = await getActiveMatrixVersion(projectUuid, callType);

    const [batch] = await db
      .insert(batches)
      .values({
        tenantId: tenantUuid,
        projectId: projectUuid,
        userId: (request.user as any).sub,
        callType,
        status: "queued",
      })
      .returning();

    const createdJobs = await db
      .insert(jobs)
      .values(
        files.map((f) => ({
          batchId: batch.id,
          tenantId: tenantUuid,
          projectId: projectUuid,
          userId: (request.user as any).sub,
          matrixVersionId: activeMatrix.id,
          fileName: f.fileName,
          filePath: f.filePath,
          callType,
          status: "queued" as const,
          progress: 0,
          maxAttempts: 3,
        })),
      )
      .returning();

    for (const job of createdJobs) {
      await boss.send(
        QUEUES.TRANSCRIBE,
        { jobId: job.id },
        { retryLimit: 3, retryDelay: 20, retryBackoff: true },
      );
    }

    return {
      batchId: batch.id,
      jobIds: createdJobs.map((j) => j.id),
    };
  });

  app.post("/batches/:batchId/files", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const files: Array<{ fileName: string; filePath: string }> = [];
    let analyzeNow = true;

    const batch = await db.query.batches.findFirst({ where: eq(batches.id, params.batchId) });
    if (!batch) {
      return reply.code(404).send({ message: "Batch not found" });
    }

    await assertProjectPermission(batch.tenantId, batch.projectId, (request.user as any).sub, "jobs:manage");
    const project = await assertProjectAccess(batch.tenantId, batch.projectId, (request.user as any).sub);
    const supportsCallType =
      (batch.callType === "inbound" && project.supportsInbound) ||
      (batch.callType === "outbound" && project.supportsOutbound);
    if (!supportsCallType) {
      return reply.code(400).send({ message: "Project does not support selected call type" });
    }
    const lockMeta = getBatchLockMeta(
      batch.createdAt,
      normalizeBatchHistoryLockDays(project.batchHistoryLockDays),
    );
    if (lockMeta.isLocked) {
      return reply.code(403).send({ message: BATCH_HISTORY_LOCKED_MESSAGE });
    }

    const parts = request.parts();
    for await (const part of parts) {
      if (part.type === "file") {
        const saved = await saveUpload(part);
        files.push(saved);
      } else if (part.fieldname === "analyzeNow") {
        analyzeNow = String(part.value ?? "true").toLowerCase() !== "false";
      }
    }

    if (!files.length) {
      return reply.code(400).send({ message: "No files uploaded" });
    }

    const activeMatrix = await getActiveMatrixVersion(batch.projectId, batch.callType);

    const createdJobs = await db
      .insert(jobs)
      .values(
        files.map((f) => ({
          batchId: batch.id,
          tenantId: batch.tenantId,
          projectId: batch.projectId,
          userId: (request.user as any).sub,
          matrixVersionId: activeMatrix.id,
          fileName: f.fileName,
          filePath: f.filePath,
          callType: batch.callType,
          status: "queued" as const,
          progress: 0,
          maxAttempts: 3,
        })),
      )
      .returning();

    await db
      .update(batches)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(batches.id, batch.id));

    if (analyzeNow) {
      for (const job of createdJobs) {
        await boss.send(
          QUEUES.TRANSCRIBE,
          { jobId: job.id },
          { retryLimit: 3, retryDelay: 20, retryBackoff: true },
        );
      }
    }

    return {
      batchId: batch.id,
      jobIds: createdJobs.map((j) => j.id),
      analyzeNow,
    };
  });

  app.post("/batches/:batchId/analyze", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const batch = await db.query.batches.findFirst({ where: eq(batches.id, params.batchId) });
    if (!batch) {
      return reply.code(404).send({ message: "Batch not found" });
    }
    await assertProjectPermission(batch.tenantId, batch.projectId, (request.user as any).sub, "jobs:manage");
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, batch.projectId),
      columns: { batchHistoryLockDays: true },
    });
    const lockMeta = getBatchLockMeta(
      batch.createdAt,
      normalizeBatchHistoryLockDays(project?.batchHistoryLockDays),
    );
    if (lockMeta.isLocked) {
      return reply.code(403).send({ message: BATCH_HISTORY_LOCKED_MESSAGE });
    }

    const queuedJobs = await db.query.jobs.findMany({
      where: and(eq(jobs.batchId, batch.id), eq(jobs.status, "queued")),
    });

    if (!queuedJobs.length) {
      return { ok: true, enqueued: 0 };
    }

    for (const job of queuedJobs) {
      await boss.send(
        QUEUES.TRANSCRIBE,
        { jobId: job.id },
        { retryLimit: 3, retryDelay: 20, retryBackoff: true },
      );
    }

    await db
      .update(batches)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(batches.id, batch.id));

    return { ok: true, enqueued: queuedJobs.length };
  });

  app.delete("/batches/:batchId", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);
    const userId = (request.user as any).sub as string;
    const batch = await db.query.batches.findFirst({ where: eq(batches.id, params.batchId) });
    if (!batch) {
      return reply.code(404).send({ message: "Batch not found" });
    }
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, batch.projectId),
      columns: { batchHistoryLockDays: true },
    });
    const lockMeta = getBatchLockMeta(
      batch.createdAt,
      normalizeBatchHistoryLockDays(project?.batchHistoryLockDays),
    );
    const isSuperAdmin = await isSuperAdminUser(userId);

    if (lockMeta.isLocked && !isSuperAdmin) {
      return reply.code(403).send({ message: BATCH_HISTORY_LOCKED_MESSAGE });
    }

    if (!lockMeta.isLocked || !isSuperAdmin) {
      await assertProjectPermission(batch.tenantId, batch.projectId, userId, "jobs:manage");
    }

    const batchJobs = await db.query.jobs.findMany({
      where: eq(jobs.batchId, batch.id),
      columns: { id: true, status: true, filePath: true },
    });

    const isEmptyBatch = batchJobs.length === 0;
    const hasActiveJobs = batchJobs.some((job) =>
      ACTIVE_JOB_STATUSES.includes(job.status as (typeof ACTIVE_JOB_STATUSES)[number]),
    );
    if (!isEmptyBatch && hasActiveJobs) {
      return reply
        .code(409)
        .send({ message: "Batch can be deleted only when queue is empty and all recordings are processed" });
    }

    if (!isEmptyBatch) {
      const jobIds = batchJobs.map((job) => job.id);

      for (const job of batchJobs) {
        await deleteUploadFile(job.filePath);
      }

      await db.delete(jobScoreEditHistory).where(inArray(jobScoreEditHistory.jobId, jobIds));
      await db.delete(jobEvaluationRows).where(inArray(jobEvaluationRows.jobId, jobIds));
      await db.delete(jobAnalyses).where(inArray(jobAnalyses.jobId, jobIds));
      await db.delete(jobSegments).where(inArray(jobSegments.jobId, jobIds));
      await db.delete(jobTranscripts).where(inArray(jobTranscripts.jobId, jobIds));
      await db.delete(jobs).where(inArray(jobs.id, jobIds));
    }

    await db.delete(batches).where(eq(batches.id, batch.id));
    return { ok: true };
  });

  app.get("/batches/:batchId", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = (request.user as any).sub as string;
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);

    const batch = await db.query.batches.findFirst({ where: eq(batches.id, params.batchId) });
    if (!batch) {
      return reply.code(404).send({ message: "Batch not found" });
    }
    await assertProjectPermission(batch.tenantId, batch.projectId, userId, "qa.read");
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, batch.projectId),
      columns: { batchHistoryLockDays: true },
    });
    const lockMeta = getBatchLockMeta(
      batch.createdAt,
      normalizeBatchHistoryLockDays(project?.batchHistoryLockDays),
    );
    const creator = await db.query.users.findFirst({
      where: eq(users.id, batch.userId),
      columns: { id: true, fullname: true },
    });

    const batchJobs = await db.query.jobs.findMany({
      where: eq(jobs.batchId, params.batchId),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });

    return {
      id: batch.id,
      tenantId: batch.tenantId,
      projectId: batch.projectId,
      callType: batch.callType,
      status: batch.status,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      createdBy: batch.userId,
      createdByFullname: resolveUserFullname(creator?.fullname),
      ...lockMeta,
      jobs: batchJobs.map((j) => ({
        id: j.id,
        status: j.status,
        fileName: j.fileName,
        progress: j.progress,
        errorMessage: j.errorMessage,
      })),
    };
  });

  app.get("/jobs", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = (request.user as any).sub as string;
    const query = z.object({ batchId: z.string().uuid() }).parse(request.query);

    const batch = await db.query.batches.findFirst({ where: eq(batches.id, query.batchId) });
    if (!batch) {
      return reply.code(404).send({ message: "Batch not found" });
    }
    await assertProjectPermission(batch.tenantId, batch.projectId, userId, "qa.read");

    const list = await db.query.jobs.findMany({
      where: eq(jobs.batchId, query.batchId),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });

    return list;
  });

  app.get("/jobs/:jobId", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = (request.user as any).sub as string;
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.jobId) });
    if (!job) {
      return reply.code(404).send({ message: "Job not found" });
    }
    await assertProjectPermission(job.tenantId, job.projectId, userId, "qa.read");
    const batch = await db.query.batches.findFirst({
      where: eq(batches.id, job.batchId),
      columns: { id: true, userId: true },
    });

    const [transcript, segments, analysis, rows] = await Promise.all([
      db.query.jobTranscripts.findFirst({ where: eq(jobTranscripts.jobId, job.id) }),
      db.query.jobSegments.findMany({
        where: eq(jobSegments.jobId, job.id),
        orderBy: (t, { asc }) => [asc(t.segmentIndex)],
      }),
      db.query.jobAnalyses.findFirst({ where: eq(jobAnalyses.jobId, job.id) }),
      db.query.jobEvaluationRows.findMany({
        where: eq(jobEvaluationRows.jobId, job.id),
        orderBy: (t, { asc }) => [asc(t.rowIndex)],
      }),
    ]);
    const scoreEdits = await db.query.jobScoreEditHistory.findMany({
      where: eq(jobScoreEditHistory.jobId, job.id),
      columns: { jobEvaluationRowId: true },
    });
    const editedRowIds = new Set(scoreEdits.map((item) => item.jobEvaluationRowId));

    return {
      id: job.id,
      batchId: job.batchId,
      tenantId: job.tenantId,
      projectId: job.projectId,
      matrixVersionId: job.matrixVersionId,
      callType: job.callType,
      status: job.status,
      fileName: job.fileName,
      transcript: transcript?.fullText ?? null,
      segments,
      analysis: analysis
        ? {
            summary: analysis.summary,
            routing: analysis.routing,
            red_flags: analysis.redFlags,
            evaluation_table: rows.map((row) => ({
              id: row.id,
              row_index: row.rowIndex,
              area: row.area,
              parameter: row.parameter,
              description: row.description,
              evidence_timestamp: row.evidenceTimestamp,
              note: row.note,
              score: row.score,
              max_score: row.maxScore,
              is_edited: editedRowIds.has(row.id),
            })),
          }
        : null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      errorMessage: job.errorMessage,
    };
  });

  app.patch("/jobs/:jobId/scores", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = (request.user as any).sub as string;
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        edits: z
          .array(
            z.object({
              rowId: z.string().uuid(),
              score: z.number().int(),
              note: z.string(),
            }),
          )
          .min(1),
      })
      .parse(request.body);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.jobId) });
    if (!job) {
      return reply.code(404).send({ message: "Job not found" });
    }

    await assertProjectPermission(job.tenantId, job.projectId, userId, "scores:manage");
    if (job.status !== "completed") {
      return reply.code(409).send({ message: "Score can only be edited for completed recording" });
    }

    const batch = await db.query.batches.findFirst({
      where: eq(batches.id, job.batchId),
      columns: { id: true, createdAt: true, projectId: true },
    });
    if (!batch) {
      return reply.code(404).send({ message: "Batch not found" });
    }
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, batch.projectId),
      columns: { batchHistoryLockDays: true, ceScoringPolicy: true },
    });
    const lockMeta = getBatchLockMeta(
      batch.createdAt,
      normalizeBatchHistoryLockDays(project?.batchHistoryLockDays),
    );
    if (lockMeta.isLocked) {
      return reply.code(403).send({ message: BATCH_HISTORY_LOCKED_MESSAGE });
    }

    const [analysis, rows] = await Promise.all([
      db.query.jobAnalyses.findFirst({ where: eq(jobAnalyses.jobId, job.id) }),
      db.query.jobEvaluationRows.findMany({
        where: eq(jobEvaluationRows.jobId, job.id),
        orderBy: (t, { asc }) => [asc(t.rowIndex)],
      }),
    ]);
    if (!analysis || !rows.length) {
      return reply.code(409).send({ message: "Scorecard not available for this recording" });
    }

    const rowsById = new Map(rows.map((row) => [row.id, { ...row }]));
    const seenRowIds = new Set<string>();
    const manualEntries: Array<{
      jobEvaluationRowId: string;
      rowIndex: number;
      area: string;
      parameter: string;
      oldScore: number;
      newScore: number;
      maxScore: number;
      reasonNote: string;
      changeSource: "manual" | "ce_strict_auto";
    }> = [];

    for (const edit of body.edits) {
      if (seenRowIds.has(edit.rowId)) {
        return reply.code(400).send({ message: "Duplicate score edit row detected" });
      }
      seenRowIds.add(edit.rowId);

      const row = rowsById.get(edit.rowId);
      if (!row) {
        return reply.code(400).send({ message: `Invalid rowId: ${edit.rowId}` });
      }

      const note = String(edit.note || "").trim();
      if (!note) {
        return reply.code(400).send({ message: "Each edited row requires a non-empty note" });
      }
      const nextScore = Number(edit.score);
      if (!Number.isFinite(nextScore) || (nextScore !== 0 && nextScore !== row.maxScore)) {
        return reply.code(400).send({
          message: `Score for row "${row.area}" must be either 0 or ${row.maxScore}`,
        });
      }
      if (nextScore === row.score) {
        continue;
      }

      manualEntries.push({
        jobEvaluationRowId: row.id,
        rowIndex: row.rowIndex,
        area: row.area,
        parameter: row.parameter,
        oldScore: row.score,
        newScore: nextScore,
        maxScore: row.maxScore,
        reasonNote: note,
        changeSource: SCORE_EDIT_SOURCE_MANUAL,
      });
      row.score = nextScore;
    }

    const strictAutoEntries: typeof manualEntries = [];
    if (project?.ceScoringPolicy === STRICT_CE_POLICY) {
      const hasCeDefect = [...rowsById.values()].some((row) => {
        if (String(row.parameter || "").toUpperCase() !== "CE") return false;
        return row.score < row.maxScore;
      });
      for (const row of rowsById.values()) {
        if (String(row.parameter || "").toUpperCase() !== "CE") continue;
        const strictScore = hasCeDefect ? 0 : row.maxScore;
        if (row.score === strictScore) continue;
        strictAutoEntries.push({
          jobEvaluationRowId: row.id,
          rowIndex: row.rowIndex,
          area: row.area,
          parameter: row.parameter,
          oldScore: row.score,
          newScore: strictScore,
          maxScore: row.maxScore,
          reasonNote: "Auto-adjusted by CE Strict policy after manual edit",
          changeSource: SCORE_EDIT_SOURCE_STRICT_AUTO,
        });
        row.score = strictScore;
      }
    }

    const updates = [...rowsById.values()].filter((row) => {
      const original = rows.find((initial) => initial.id === row.id);
      return Boolean(original && original.score !== row.score);
    });
    const totalScore = [...rowsById.values()].reduce(
      (sum, row) => sum + Number(row.score || 0),
      0,
    );
    const rawJson = analysis.rawJson as any;
    const nextRawJson =
      rawJson && typeof rawJson === "object"
        ? JSON.parse(JSON.stringify(rawJson))
        : {};
    if (Array.isArray(nextRawJson?.qa_scorecard?.evaluation_table)) {
      for (let idx = 0; idx < nextRawJson.qa_scorecard.evaluation_table.length; idx += 1) {
        const entry = nextRawJson.qa_scorecard.evaluation_table[idx];
        const rowIndex =
          typeof entry?.row_index === "number" ? Number(entry.row_index) : idx;
        const updated = [...rowsById.values()].find((row) => row.rowIndex === rowIndex);
        if (updated) {
          entry.score = updated.score;
          entry.max_score = updated.maxScore;
        }
      }
    }

    await db.transaction(async (tx) => {
      for (const row of updates) {
        await tx
          .update(jobEvaluationRows)
          .set({ score: row.score })
          .where(eq(jobEvaluationRows.id, row.id));
      }

      await tx
        .update(jobAnalyses)
        .set({ totalScore, rawJson: nextRawJson })
        .where(eq(jobAnalyses.jobId, job.id));

      const historyValues = [...manualEntries, ...strictAutoEntries].map((entry) => ({
        jobId: job.id,
        jobEvaluationRowId: entry.jobEvaluationRowId,
        rowIndex: entry.rowIndex,
        area: entry.area,
        parameter: entry.parameter,
        oldScore: entry.oldScore,
        newScore: entry.newScore,
        maxScore: entry.maxScore,
        reasonNote: entry.reasonNote,
        changeSource: entry.changeSource,
        editedBy: userId,
      }));
      if (historyValues.length) {
        await tx.insert(jobScoreEditHistory).values(historyValues);
      }
    });

    return {
      ok: true,
      totalScore,
      updatedRows: updates.length,
      strictAutoAdjustedRows: strictAutoEntries.length,
    };
  });

  app.get("/jobs/:jobId/score-history", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = (request.user as any).sub as string;
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.jobId) });
    if (!job) {
      return reply.code(404).send({ message: "Job not found" });
    }
    await assertProjectPermission(job.tenantId, job.projectId, userId, "scores:manage");

    const historyRows = await db
      .select({
        id: jobScoreEditHistory.id,
        jobId: jobScoreEditHistory.jobId,
        rowIndex: jobScoreEditHistory.rowIndex,
        area: jobScoreEditHistory.area,
        parameter: jobScoreEditHistory.parameter,
        oldScore: jobScoreEditHistory.oldScore,
        newScore: jobScoreEditHistory.newScore,
        maxScore: jobScoreEditHistory.maxScore,
        reasonNote: jobScoreEditHistory.reasonNote,
        changeSource: jobScoreEditHistory.changeSource,
        createdAt: jobScoreEditHistory.createdAt,
        editedBy: jobScoreEditHistory.editedBy,
        editedByEmail: users.email,
        editedByFullname: users.fullname,
      })
      .from(jobScoreEditHistory)
      .leftJoin(users, eq(jobScoreEditHistory.editedBy, users.id))
      .where(eq(jobScoreEditHistory.jobId, job.id))
      .orderBy(desc(jobScoreEditHistory.createdAt));

    return historyRows.map((row) => ({
      ...row,
      editedByFullname: resolveUserFullname(row.editedByFullname),
    }));
  });

  app.get("/jobs/:jobId/audio", async (request: any, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const query = z.object({ token: z.string().optional() }).parse(request.query);

    let userId = "";
    try {
      await request.jwtVerify();
      userId = (request.user as any).sub;
    } catch {
      if (!query.token) {
        return reply.code(401).send({ message: "Unauthorized" });
      }
      try {
        const decoded = await app.jwt.verify(query.token);
        userId = (decoded as any).sub;
      } catch {
        return reply.code(401).send({ message: "Unauthorized" });
      }
    }

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.jobId) });
    if (!job) {
      return reply.code(404).send({ message: "Job not found" });
    }

    await assertProjectPermission(job.tenantId, job.projectId, userId, "qa.read");
    const batch = await db.query.batches.findFirst({
      where: eq(batches.id, job.batchId),
      columns: { id: true, userId: true },
    });

    const ext = extname(job.fileName).toLowerCase();
    const contentType =
      ext === ".wav"
        ? "audio/wav"
        : ext === ".m4a"
          ? "audio/mp4"
          : ext === ".mp3"
            ? "audio/mpeg"
            : "application/octet-stream";

    try {
      const fileStat = await stat(job.filePath);
      const fileSize = fileStat.size;
      const rangeHeader = String(request.headers.range || "");

      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "private, max-age=60");
      reply.header("Content-Disposition", `inline; filename="${basename(job.fileName)}"`);
      reply.header("Accept-Ranges", "bytes");

      if (rangeHeader.startsWith("bytes=")) {
        const [startRaw, endRaw] = rangeHeader.replace("bytes=", "").split("-");
        const parsedStart = Number.parseInt(startRaw || "0", 10);
        const parsedEnd = Number.parseInt(endRaw || `${fileSize - 1}`, 10);

        const start = Number.isFinite(parsedStart) ? parsedStart : 0;
        const end = Number.isFinite(parsedEnd) ? parsedEnd : fileSize - 1;

        if (start < 0 || end < start || start >= fileSize) {
          return reply
            .code(416)
            .header("Content-Range", `bytes */${fileSize}`)
            .send();
        }

        const safeEnd = Math.min(end, fileSize - 1);
        const chunkSize = safeEnd - start + 1;

        reply.code(206);
        reply.header("Content-Range", `bytes ${start}-${safeEnd}/${fileSize}`);
        reply.header("Content-Length", String(chunkSize));
        return reply.send(createReadStream(job.filePath, { start, end: safeEnd }));
      }

      reply.header("Content-Length", String(fileSize));
      return reply.send(createReadStream(job.filePath));
    } catch {
      return reply.code(404).send({ message: "Audio file not found" });
    }
  });

  app.delete("/jobs/:jobId", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.jobId) });
    if (!job) {
      return reply.code(404).send({ message: "Job not found" });
    }

    await assertProjectPermission(job.tenantId, job.projectId, (request.user as any).sub, "jobs:manage");
    const batch = await db.query.batches.findFirst({
      where: eq(batches.id, job.batchId),
      columns: { id: true, createdAt: true, projectId: true },
    });
    if (!batch) {
      return reply.code(404).send({ message: "Batch not found" });
    }
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, batch.projectId),
      columns: { batchHistoryLockDays: true },
    });
    const lockMeta = getBatchLockMeta(
      batch.createdAt,
      normalizeBatchHistoryLockDays(project?.batchHistoryLockDays),
    );
    if (lockMeta.isLocked) {
      return reply.code(403).send({ message: BATCH_HISTORY_LOCKED_MESSAGE });
    }

    if (
      ACTIVE_JOB_STATUSES.includes(
        job.status as (typeof ACTIVE_JOB_STATUSES)[number],
      )
    ) {
      return reply
        .code(409)
        .send({ message: "Recording cannot be deleted while it is being processed" });
    }

    await deleteUploadFile(job.filePath);
    await db.delete(jobScoreEditHistory).where(eq(jobScoreEditHistory.jobId, job.id));
    await db.delete(jobEvaluationRows).where(eq(jobEvaluationRows.jobId, job.id));
    await db.delete(jobAnalyses).where(eq(jobAnalyses.jobId, job.id));
    await db.delete(jobSegments).where(eq(jobSegments.jobId, job.id));
    await db.delete(jobTranscripts).where(eq(jobTranscripts.jobId, job.id));
    await db.delete(jobs).where(eq(jobs.id, job.id));

    return { ok: true };
  });

  app.post("/jobs/:jobId/retry", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.jobId) });
    if (!job) {
      return reply.code(404).send({ message: "Job not found" });
    }

    await assertProjectPermission(job.tenantId, job.projectId, (request.user as any).sub, "jobs:manage");
    const batch = await db.query.batches.findFirst({
      where: eq(batches.id, job.batchId),
      columns: { id: true, createdAt: true, projectId: true },
    });
    if (!batch) {
      return reply.code(404).send({ message: "Batch not found" });
    }
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, batch.projectId),
      columns: { batchHistoryLockDays: true },
    });
    const lockMeta = getBatchLockMeta(
      batch.createdAt,
      normalizeBatchHistoryLockDays(project?.batchHistoryLockDays),
    );
    if (lockMeta.isLocked) {
      return reply.code(403).send({ message: BATCH_HISTORY_LOCKED_MESSAGE });
    }

    if (job.status !== "failed") {
      return reply.code(409).send({ message: "Only failed recording can be retried" });
    }

    await db.delete(jobScoreEditHistory).where(eq(jobScoreEditHistory.jobId, job.id));
    await db.delete(jobEvaluationRows).where(eq(jobEvaluationRows.jobId, job.id));
    await db.delete(jobAnalyses).where(eq(jobAnalyses.jobId, job.id));
    await db.delete(jobSegments).where(eq(jobSegments.jobId, job.id));
    await db.delete(jobTranscripts).where(eq(jobTranscripts.jobId, job.id));

    await db
      .update(jobs)
      .set({
        status: "queued",
        progress: 0,
        attempt: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));

    await db
      .update(batches)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(batches.id, job.batchId));

    await boss.send(
      QUEUES.TRANSCRIBE,
      { jobId: job.id },
      { retryLimit: 3, retryDelay: 20, retryBackoff: true },
    );

    return { ok: true };
  });
};
