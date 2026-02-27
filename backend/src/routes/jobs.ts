import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
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
import { saveUpload } from "../storage.js";
import { boss, QUEUES } from "../queue.js";
type CallType = "inbound" | "outbound";

export const jobRoutes: FastifyPluginAsync = async (app) => {
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
};
