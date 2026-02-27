import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";
import { db } from "../db.js";
import {
  batches,
  jobAnalyses,
  jobEvaluationRows,
  jobs,
  jobSegments,
  jobTranscripts,
  projects,
} from "../../drizzle/schema.js";
import { assertProjectAccess, getActiveMatrixVersion } from "../repos/access.js";
import { deleteUploadFile, saveUpload } from "../storage.js";
import { boss, QUEUES } from "../queue.js";
type CallType = "inbound" | "outbound";

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/batches",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({ projectId: z.string().uuid() }).parse(request.params);
      const project = await db.query.projects.findFirst({ where: eq(projects.id, params.projectId) });
      if (!project) {
        return reply.code(404).send({ message: "Project not found" });
      }
      await assertProjectAccess(project.tenantId, project.id, (request.user as any).sub);

      const projectBatches = await db.query.batches.findMany({
        where: and(eq(batches.projectId, params.projectId), eq(batches.userId, (request.user as any).sub)),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });

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
    if (!batch || batch.userId !== (request.user as any).sub) {
      return reply.code(404).send({ message: "Batch not found" });
    }

    const project = await assertProjectAccess(batch.tenantId, batch.projectId, (request.user as any).sub);
    const supportsCallType =
      (batch.callType === "inbound" && project.supportsInbound) ||
      (batch.callType === "outbound" && project.supportsOutbound);
    if (!supportsCallType) {
      return reply.code(400).send({ message: "Project does not support selected call type" });
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
    if (!batch || batch.userId !== (request.user as any).sub) {
      return reply.code(404).send({ message: "Batch not found" });
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
    const batch = await db.query.batches.findFirst({ where: eq(batches.id, params.batchId) });
    if (!batch || batch.userId !== (request.user as any).sub) {
      return reply.code(404).send({ message: "Batch not found" });
    }

    await assertProjectAccess(batch.tenantId, batch.projectId, (request.user as any).sub);

    const batchJobs = await db.query.jobs.findMany({
      where: eq(jobs.batchId, batch.id),
      columns: { id: true, status: true, filePath: true },
    });

    const isEmptyBatch = batchJobs.length === 0;
    const isAllFailedBatch = batchJobs.length > 0 && batchJobs.every((job) => job.status === "failed");

    if (!isEmptyBatch && !isAllFailedBatch) {
      return reply
        .code(409)
        .send({ message: "Batch can be deleted only when empty or all recordings are failed" });
    }

    if (isAllFailedBatch) {
      const jobIds = batchJobs.map((job) => job.id);

      for (const job of batchJobs) {
        await deleteUploadFile(job.filePath);
      }

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
    const params = z.object({ batchId: z.string().uuid() }).parse(request.params);

    const batch = await db.query.batches.findFirst({ where: eq(batches.id, params.batchId) });
    if (!batch || batch.userId !== (request.user as any).sub) {
      return reply.code(404).send({ message: "Batch not found" });
    }

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
    const query = z.object({ batchId: z.string().uuid() }).parse(request.query);

    const batch = await db.query.batches.findFirst({ where: eq(batches.id, query.batchId) });
    if (!batch || batch.userId !== (request.user as any).sub) {
      return reply.code(404).send({ message: "Batch not found" });
    }

    const list = await db.query.jobs.findMany({
      where: eq(jobs.batchId, query.batchId),
      orderBy: (t, { asc }) => [asc(t.createdAt)],
    });

    return list;
  });

  app.get("/jobs/:jobId", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.jobId) });
    if (!job || job.userId !== (request.user as any).sub) {
      return reply.code(404).send({ message: "Job not found" });
    }

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
              area: row.area,
              parameter: row.parameter,
              description: row.description,
              evidence_timestamp: row.evidenceTimestamp,
              note: row.note,
              score: row.score,
              max_score: row.maxScore,
            })),
          }
        : null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      errorMessage: job.errorMessage,
    };
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
    if (!job || job.userId !== userId) {
      return reply.code(404).send({ message: "Job not found" });
    }

    await assertProjectAccess(job.tenantId, job.projectId, userId);

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
      const data = await readFile(job.filePath);
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "private, max-age=60");
      reply.header("Content-Disposition", `inline; filename="${basename(job.fileName)}"`);
      return reply.send(data);
    } catch {
      return reply.code(404).send({ message: "Audio file not found" });
    }
  });

  app.delete("/jobs/:jobId", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.jobId) });
    if (!job || job.userId !== (request.user as any).sub) {
      return reply.code(404).send({ message: "Job not found" });
    }

    await assertProjectAccess(job.tenantId, job.projectId, (request.user as any).sub);

    if (!["queued", "uploading"].includes(job.status)) {
      return reply.code(409).send({ message: "Only unprocessed recordings can be deleted" });
    }

    await deleteUploadFile(job.filePath);
    await db.delete(jobs).where(eq(jobs.id, job.id));

    return { ok: true };
  });

  app.post("/jobs/:jobId/retry", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ jobId: z.string().uuid() }).parse(request.params);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.id, params.jobId) });
    if (!job || job.userId !== (request.user as any).sub) {
      return reply.code(404).send({ message: "Job not found" });
    }

    await assertProjectAccess(job.tenantId, job.projectId, (request.user as any).sub);

    if (job.status !== "failed") {
      return reply.code(409).send({ message: "Only failed recording can be retried" });
    }

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
