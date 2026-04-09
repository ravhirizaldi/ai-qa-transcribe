import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, resolve } from "node:path";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { env } from "../config.js";
import { boss, QUEUES } from "../queue.js";
import {
  batches,
  globalProviderSettings,
  jobAnalyses,
  jobScoreEditHistory,
  jobEvaluationRows,
  jobs,
  jobSegments,
  jobTranscripts,
  projectRagDocuments,
  projectMemberships,
  projectMatrixRows,
  projectMatrixVersions,
  projects,
  tenantMemberships,
  tenants,
  users,
} from "../../drizzle/schema.js";
import {
  assertProjectAccess,
  assertProjectPermission,
  assertSystemPermission,
  assertTenantAccess,
  isSuperAdminUser,
  listAccessibleProjects,
  listAccessibleTenants,
} from "../repos/access.js";
import { toSlug } from "../utils/slug.js";
import { saveImageUpload } from "../storage.js";
import { uploadRateLimit } from "../rate-limit.js";
import {
  DEFAULT_DAILY_UPLOAD_LIMIT,
  listProjectDailyUploadCounts,
  MAX_DAILY_UPLOAD_LIMIT,
  MIN_DAILY_UPLOAD_LIMIT,
} from "../utils/projectUploadLimits.js";

const CreateTenantSchema = z.object({
  name: z.string().min(2),
  logoUrl: z.string().trim().min(1).nullable().optional(),
});

const UpdateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  logoUrl: z.string().trim().min(1).nullable().optional(),
});

const CreateProjectSchema = z.object({
  name: z.string().min(2),
  logoUrl: z.string().trim().min(1).nullable().optional(),
  supportsInbound: z.boolean().default(true),
  supportsOutbound: z.boolean().default(false),
  batchHistoryLockDays: z.coerce.number().int().min(1).max(365).default(2),
  dailyUploadLimit: z.coerce
    .number()
    .int()
    .min(MIN_DAILY_UPLOAD_LIMIT)
    .max(MAX_DAILY_UPLOAD_LIMIT)
    .default(DEFAULT_DAILY_UPLOAD_LIMIT),
  ceScoringPolicy: z
    .enum(["strict_zero_all_ce_if_any_fail", "weighted_ce_independent"])
    .default("strict_zero_all_ce_if_any_fail"),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(2).optional(),
  logoUrl: z.string().trim().min(1).nullable().optional(),
  supportsInbound: z.boolean().optional(),
  supportsOutbound: z.boolean().optional(),
  batchHistoryLockDays: z.coerce.number().int().min(1).max(365).optional(),
  dailyUploadLimit: z.coerce
    .number()
    .int()
    .min(MIN_DAILY_UPLOAD_LIMIT)
    .max(MAX_DAILY_UPLOAD_LIMIT)
    .optional(),
  ceScoringPolicy: z
    .enum(["strict_zero_all_ce_if_any_fail", "weighted_ce_independent"])
    .optional(),
});

const GlobalSettingsSchema = z.object({
  elevenlabsApiKey: z.string().optional(),
  xaiApiKey: z.string().optional(),
  xaiModel: z.string().optional(),
  xaiManagementApiKey: z.string().optional(),
  xaiRagModel: z.string().optional(),
});
const RagDocStatusSchema = z.enum(["pending", "synced", "failed", "deleted"]);

const UserVisibilitySchema = z.object({
  isRestricted: z.boolean(),
  role: z.enum(["owner", "admin", "member", "viewer"]).optional(),
  projectIds: z.array(z.string().uuid()).default([]),
});

const assertManageRole = (role: string) => {
  if (!["owner", "admin"].includes(role)) {
    throw new Error("Insufficient permissions");
  }
};

  const XAI_MANAGEMENT_BASE_URL = "https://management-api.x.ai/v1";
  const DEFAULT_XAI_MODEL = "grok-4-1-fast-non-reasoning";
  const DEFAULT_RAG_MODEL = "grok-4-1-fast-reasoning";

  const listProjectsWithDailyUsage = async (tenantId: string, userId: string) => {
    const accessibleProjects = await listAccessibleProjects(tenantId, userId);
    const dailyUploadCounts = await listProjectDailyUploadCounts(
      accessibleProjects.map((project) => project.id),
    );
    return accessibleProjects.map((project) => ({
      ...project,
      dailyUploadLimit: Number(project.dailyUploadLimit || DEFAULT_DAILY_UPLOAD_LIMIT),
      dailyUploadCount: dailyUploadCounts[project.id] || 0,
    }));
  };

const resolveXaiManagementKey = (settings: {
  xaiManagementApiKey?: string | null;
}) => String(settings.xaiManagementApiKey || "").trim();

const deleteXaiCollectionBestEffort = async (collectionId: string) => {
  const settings = await db.query.globalProviderSettings.findFirst({
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
    columns: { xaiManagementApiKey: true },
  });
  const key = resolveXaiManagementKey(settings || {});
  if (!key || !collectionId) return false;
  try {
    const response = await fetch(
      `${XAI_MANAGEMENT_BASE_URL}/collections/${encodeURIComponent(collectionId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key}` },
      },
    );
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
};

const deleteProjectCascade = async (projectId: string) => {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { xaiCollectionId: true },
  });
  const collectionId = String(project?.xaiCollectionId || "").trim();
  if (collectionId) {
    const deleted = await deleteXaiCollectionBestEffort(collectionId);
    if (!deleted) {
      console.warn(
        `Failed to delete xAI collection ${collectionId} for project ${projectId}`,
      );
    }
  }

  await db
    .delete(projectRagDocuments)
    .where(eq(projectRagDocuments.projectId, projectId));

  const projectJobs = await db.query.jobs.findMany({
    where: eq(jobs.projectId, projectId),
    columns: { id: true },
  });
  const jobIds = projectJobs.map((job) => job.id);

  if (jobIds.length) {
    await db
      .delete(jobScoreEditHistory)
      .where(inArray(jobScoreEditHistory.jobId, jobIds));
    await db
      .delete(jobEvaluationRows)
      .where(inArray(jobEvaluationRows.jobId, jobIds));
    await db.delete(jobSegments).where(inArray(jobSegments.jobId, jobIds));
    await db
      .delete(jobTranscripts)
      .where(inArray(jobTranscripts.jobId, jobIds));
    await db.delete(jobAnalyses).where(inArray(jobAnalyses.jobId, jobIds));
    await db.delete(jobs).where(inArray(jobs.id, jobIds));
  }

  await db.delete(batches).where(eq(batches.projectId, projectId));

  const versions = await db.query.projectMatrixVersions.findMany({
    where: eq(projectMatrixVersions.projectId, projectId),
    columns: { id: true },
  });
  const versionIds = versions.map((version) => version.id);
  if (versionIds.length) {
    await db
      .delete(projectMatrixRows)
      .where(inArray(projectMatrixRows.matrixVersionId, versionIds));
  }

  await db
    .delete(projectMatrixVersions)
    .where(eq(projectMatrixVersions.projectId, projectId));
  await db
    .delete(projectMemberships)
    .where(eq(projectMemberships.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
};

export const tenantRoutes: FastifyPluginAsync = async (app) => {
  const imageMimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
  };

  app.post(
    "/uploads/images",
    { preHandler: [app.authenticate, uploadRateLimit] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ message: "No file uploaded" });
      }

      if (!file.mimetype || !file.mimetype.startsWith("image/")) {
        return reply
          .code(400)
          .send({ message: "Only image files are allowed" });
      }

      const saved = await saveImageUpload(file);
      return { path: saved.publicPath };
    },
  );

  app.get("/uploads/images/:fileName", async (request, reply) => {
    const params = z
      .object({ fileName: z.string().min(1) })
      .parse(request.params);
    if (!/^[a-zA-Z0-9._-]+$/.test(params.fileName)) {
      return reply.code(400).send({ message: "Invalid file name" });
    }

    const filePath = resolve(env.UPLOAD_DIR, "images", params.fileName);
    try {
      await access(filePath);
    } catch {
      return reply.code(404).send({ message: "File not found" });
    }

    reply.header("Cache-Control", "public, max-age=86400");
    reply.type(
      imageMimeTypes[extname(params.fileName).toLowerCase()] ||
        "application/octet-stream",
    );
    return reply.send(createReadStream(filePath));
  });

  app.get("/tenants", { preHandler: app.authenticate }, async (request) => {
    const rows = await listAccessibleTenants((request.user as any).sub);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      logoUrl: row.logoUrl,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  });

  app.post("/tenants", { preHandler: app.authenticate }, async (request) => {
    await assertSystemPermission((request.user as any).sub, "tenants:manage");
    const payload = CreateTenantSchema.parse(request.body);

    const [tenant] = await db
      .insert(tenants)
      .values({
        name: payload.name,
        logoUrl: payload.logoUrl ?? null,
        createdBy: (request.user as any).sub,
      })
      .returning();

    await db.insert(tenantMemberships).values({
      tenantId: tenant.id,
      userId: (request.user as any).sub,
      role: "owner",
    });

    return tenant;
  });

  app.patch(
    "/tenants/:tenantId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ tenantId: z.string().uuid() })
        .parse(request.params);
      const payload = UpdateTenantSchema.parse(request.body);
      const actor = await assertTenantAccess(
        params.tenantId,
        (request.user as any).sub,
        {
          requireMembership: true,
        },
      );

      if (!actor) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      try {
        assertManageRole(actor.role);
      } catch {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      const [updated] = await db
        .update(tenants)
        .set({
          ...(payload.name !== undefined ? { name: payload.name } : {}),
          ...(payload.logoUrl !== undefined
            ? { logoUrl: payload.logoUrl }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, params.tenantId))
        .returning();

      return updated;
    },
  );

  app.delete(
    "/tenants/:tenantId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ tenantId: z.string().uuid() })
        .parse(request.params);
      const actor = await assertTenantAccess(
        params.tenantId,
        (request.user as any).sub,
        {
          requireMembership: true,
        },
      );

      if (!actor) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      try {
        assertManageRole(actor.role);
      } catch {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      const tenantProjects = await db.query.projects.findMany({
        where: eq(projects.tenantId, params.tenantId),
        columns: { id: true },
      });

      for (const project of tenantProjects) {
        await deleteProjectCascade(project.id);
      }

      await db
        .delete(tenantMemberships)
        .where(eq(tenantMemberships.tenantId, params.tenantId));
      await db.delete(tenants).where(eq(tenants.id, params.tenantId));

      return { ok: true };
    },
  );

  app.get(
    "/tenants/:tenantId/projects",
    { preHandler: app.authenticate },
    async (request) => {
      const params = z
        .object({ tenantId: z.string().uuid() })
        .parse(request.params);
      await assertTenantAccess(params.tenantId, (request.user as any).sub);

      return listProjectsWithDailyUsage(params.tenantId, (request.user as any).sub);
    },
  );

  app.post(
    "/tenants/:tenantId/projects",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ tenantId: z.string().uuid() })
        .parse(request.params);
      const payload = CreateProjectSchema.parse(request.body);
      const actor = await assertTenantAccess(
        params.tenantId,
        (request.user as any).sub,
        {
          requireMembership: true,
        },
      );

      if (!actor) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      try {
        assertManageRole(actor.role);
      } catch {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      const isSuperAdmin = await isSuperAdminUser((request.user as any).sub);
      if (payload.dailyUploadLimit !== DEFAULT_DAILY_UPLOAD_LIMIT && !isSuperAdmin) {
        return reply.code(403).send({
          message: "Only super admin can change the daily upload limit.",
        });
      }

      const [project] = await db
        .insert(projects)
        .values({
          tenantId: params.tenantId,
          name: payload.name,
          slug: toSlug(payload.name),
          logoUrl: payload.logoUrl ?? null,
          supportsInbound: payload.supportsInbound,
          supportsOutbound: payload.supportsOutbound,
          batchHistoryLockDays: payload.batchHistoryLockDays,
          dailyUploadLimit: payload.dailyUploadLimit,
          ceScoringPolicy: payload.ceScoringPolicy,
        })
        .returning();

      await db.insert(projectMemberships).values({
        projectId: project.id,
        userId: (request.user as any).sub,
      });

      return {
        ...project,
        dailyUploadLimit: Number(project.dailyUploadLimit || DEFAULT_DAILY_UPLOAD_LIMIT),
        dailyUploadCount: 0,
      };
    },
  );

  app.patch(
    "/tenants/:tenantId/projects/:projectId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ tenantId: z.string().uuid(), projectId: z.string().uuid() })
        .parse(request.params);
      const payload = UpdateProjectSchema.parse(request.body);
      const actor = await assertTenantAccess(
        params.tenantId,
        (request.user as any).sub,
        {
          requireMembership: true,
        },
      );

      if (!actor) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      try {
        assertManageRole(actor.role);
      } catch {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      if (payload.dailyUploadLimit !== undefined) {
        const isSuperAdmin = await isSuperAdminUser((request.user as any).sub);
        if (!isSuperAdmin) {
          return reply.code(403).send({
            message: "Only super admin can change the daily upload limit.",
          });
        }
      }

      const [updated] = await db
        .update(projects)
        .set({
          ...(payload.name !== undefined
            ? {
                name: payload.name,
                slug: toSlug(payload.name),
              }
            : {}),
          ...(payload.logoUrl !== undefined
            ? { logoUrl: payload.logoUrl }
            : {}),
          ...(payload.supportsInbound !== undefined
            ? { supportsInbound: payload.supportsInbound }
            : {}),
          ...(payload.supportsOutbound !== undefined
            ? { supportsOutbound: payload.supportsOutbound }
            : {}),
          ...(payload.batchHistoryLockDays !== undefined
            ? { batchHistoryLockDays: payload.batchHistoryLockDays }
            : {}),
          ...(payload.dailyUploadLimit !== undefined
            ? { dailyUploadLimit: payload.dailyUploadLimit }
            : {}),
          ...(payload.ceScoringPolicy !== undefined
            ? { ceScoringPolicy: payload.ceScoringPolicy }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projects.id, params.projectId),
            eq(projects.tenantId, params.tenantId),
          ),
        )
        .returning();

      const [dailyUploadCounts, normalizedLimit] = await Promise.all([
        listProjectDailyUploadCounts([updated.id]),
        Promise.resolve(
          Number(updated.dailyUploadLimit || DEFAULT_DAILY_UPLOAD_LIMIT),
        ),
      ]);
      return {
        ...updated,
        dailyUploadLimit: normalizedLimit,
        dailyUploadCount: dailyUploadCounts[updated.id] || 0,
      };
    },
  );

  app.delete(
    "/tenants/:tenantId/projects/:projectId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ tenantId: z.string().uuid(), projectId: z.string().uuid() })
        .parse(request.params);
      const actor = await assertTenantAccess(
        params.tenantId,
        (request.user as any).sub,
        {
          requireMembership: true,
        },
      );

      if (!actor) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      try {
        assertManageRole(actor.role);
      } catch {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      await assertProjectAccess(
        params.tenantId,
        params.projectId,
        (request.user as any).sub,
      );
      await deleteProjectCascade(params.projectId);
      return { ok: true };
    },
  );

  app.get(
    "/tenants/:tenantId/projects/:projectId/rag/summary",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ tenantId: z.string().uuid(), projectId: z.string().uuid() })
        .parse(request.params);
      const userId = (request.user as any).sub as string;
      const project = await assertProjectAccess(
        params.tenantId,
        params.projectId,
        userId,
      );

      const rows = await db.query.projectRagDocuments.findMany({
        where: eq(projectRagDocuments.projectId, project.id),
        columns: {
          syncStatus: true,
          uploadedAt: true,
        },
      });

      const counts = { pending: 0, synced: 0, failed: 0, deleted: 0 };
      let lastSyncedAt: string | null = null;
      for (const row of rows) {
        counts[row.syncStatus] += 1;
        if (row.syncStatus !== "synced" || !row.uploadedAt) continue;
        if (!lastSyncedAt || row.uploadedAt.toISOString() > lastSyncedAt) {
          lastSyncedAt = row.uploadedAt.toISOString();
        }
      }

      return {
        projectId: project.id,
        collectionId: project.xaiCollectionId || null,
        counts,
        lastSyncedAt,
      };
    },
  );

  app.get(
    "/tenants/:tenantId/projects/:projectId/rag/docs",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ tenantId: z.string().uuid(), projectId: z.string().uuid() })
        .parse(request.params);
      const query = z
        .object({
          status: RagDocStatusSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          cursor: z.string().datetime().optional(),
        })
        .parse(request.query);
      const userId = (request.user as any).sub as string;
      await assertProjectAccess(params.tenantId, params.projectId, userId);

      const whereClauses = [
        eq(projectRagDocuments.projectId, params.projectId),
      ];
      if (query.status) {
        whereClauses.push(eq(projectRagDocuments.syncStatus, query.status));
      }
      if (query.cursor) {
        whereClauses.push(
          lt(projectRagDocuments.createdAt, new Date(query.cursor)),
        );
      }

      const items = await db.query.projectRagDocuments.findMany({
        where: and(...whereClauses),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
        limit: query.limit,
      });

      const last = items[items.length - 1];
      const nextCursor =
        items.length === query.limit && last
          ? last.createdAt.toISOString()
          : null;

      return {
        items: items.map((item) => ({
          id: item.id,
          tenantId: item.tenantId,
          projectId: item.projectId,
          jobId: item.jobId,
          rowIndex: item.rowIndex,
          area: item.area,
          parameter: item.parameter,
          oldScore: item.oldScore,
          newScore: item.newScore,
          maxScore: item.maxScore,
          reasonNote: item.reasonNote,
          fileName: item.fileName,
          syncStatus: item.syncStatus,
          xaiCollectionId: item.xaiCollectionId,
          xaiFileId: item.xaiFileId,
          uploadedAt: item.uploadedAt,
          deletedAt: item.deletedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
        nextCursor,
      };
    },
  );

  app.get(
    "/tenants/:tenantId/projects/:projectId/rag/docs/:ragDocId/preview",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({
          tenantId: z.string().uuid(),
          projectId: z.string().uuid(),
          ragDocId: z.string().uuid(),
        })
        .parse(request.params);
      const userId = (request.user as any).sub as string;

      await assertProjectAccess(params.tenantId, params.projectId, userId);

      const doc = await db.query.projectRagDocuments.findFirst({
        where: and(
          eq(projectRagDocuments.id, params.ragDocId),
          eq(projectRagDocuments.projectId, params.projectId),
        ),
      });
      if (!doc) {
        return reply.code(404).send({ message: "RAG document not found" });
      }

      const collectionId = String(doc.xaiCollectionId || "").trim();
      const fileId = String(doc.xaiFileId || "").trim();
      if (!collectionId || !fileId) {
        return reply
          .code(400)
          .send({ message: "Document has no associated xAI file" });
      }

      const settings = await db.query.globalProviderSettings.findFirst({
        orderBy: (t, { desc }) => [desc(t.updatedAt)],
        columns: { xaiManagementApiKey: true },
      });
      const managementKey = resolveXaiManagementKey(settings || {});
      if (!managementKey) {
        return reply
          .code(500)
          .send({ message: "xAI Management API key not configured" });
      }

      const response = await fetch(
        `${XAI_MANAGEMENT_BASE_URL}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(fileId)}`,
        {
          headers: { Authorization: `Bearer ${managementKey}` },
        },
      );

      if (!response.ok) {
        const body = await response.text();
        return reply
          .code(response.status)
          .send({ message: `Failed to fetch from xAI: ${body}` });
      }

      const payload = await response.json();
      return payload;
    },
  );

  app.delete(
    "/tenants/:tenantId/projects/:projectId/rag/docs/:ragDocId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({
          tenantId: z.string().uuid(),
          projectId: z.string().uuid(),
          ragDocId: z.string().uuid(),
        })
        .parse(request.params);
      const userId = (request.user as any).sub as string;

      await assertProjectAccess(params.tenantId, params.projectId, userId);
      await assertProjectPermission(
        params.tenantId,
        params.projectId,
        userId,
        "scores:manage",
      );

      const doc = await db.query.projectRagDocuments.findFirst({
        where: and(
          eq(projectRagDocuments.id, params.ragDocId),
          eq(projectRagDocuments.projectId, params.projectId),
        ),
      });
      if (!doc) {
        return reply.code(404).send({ message: "RAG document not found" });
      }

      let remoteDeleted = false;
      const collectionId = String(doc.xaiCollectionId || "").trim();
      const fileId = String(doc.xaiFileId || "").trim();
      const settings = await db.query.globalProviderSettings.findFirst({
        orderBy: (t, { desc }) => [desc(t.updatedAt)],
        columns: { xaiManagementApiKey: true },
      });
      const managementKey = resolveXaiManagementKey(settings || {});

      if (collectionId && fileId && managementKey) {
        try {
          const response = await fetch(
            `${XAI_MANAGEMENT_BASE_URL}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(fileId)}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${managementKey}` },
            },
          );
          remoteDeleted = response.ok || response.status === 404;
        } catch {
          remoteDeleted = false;
        }
      }

      await db
        .update(projectRagDocuments)
        .set({
          syncStatus: "deleted",
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projectRagDocuments.id, doc.id));

      return { ok: true, remoteDeleted };
    },
  );

  app.post(
    "/tenants/:tenantId/projects/:projectId/rag/docs/:ragDocId/retry",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({
          tenantId: z.string().uuid(),
          projectId: z.string().uuid(),
          ragDocId: z.string().uuid(),
        })
        .parse(request.params);
      const userId = (request.user as any).sub as string;

      await assertProjectAccess(params.tenantId, params.projectId, userId);
      await assertProjectPermission(
        params.tenantId,
        params.projectId,
        userId,
        "scores:manage",
      );

      const doc = await db.query.projectRagDocuments.findFirst({
        where: and(
          eq(projectRagDocuments.id, params.ragDocId),
          eq(projectRagDocuments.projectId, params.projectId),
        ),
      });
      if (!doc) {
        return reply.code(404).send({ message: "RAG document not found" });
      }
      if (doc.syncStatus !== "failed") {
        return reply.code(400).send({
          message: "Only failed RAG documents can be retried",
        });
      }

      await db
        .update(projectRagDocuments)
        .set({
          syncStatus: "pending",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(projectRagDocuments.id, doc.id));

      await boss.send(QUEUES.RAG_SYNC_CORRECTION, {
        scoreEditHistoryId: doc.jobScoreEditHistoryId,
        jobId: doc.jobId,
        tenantId: doc.tenantId,
        projectId: doc.projectId,
      });

      return { ok: true };
    },
  );

  app.get(
    "/settings/global",
    { preHandler: app.authenticate },
    async (request) => {
      await assertSystemPermission((request.user as any).sub, "settings:view");
      const settings = await db.query.globalProviderSettings.findFirst({
        orderBy: (t, { desc }) => [desc(t.updatedAt)],
      });

      return {
        hasElevenlabsApiKey: Boolean(settings?.elevenlabsApiKey),
        hasXaiApiKey: Boolean(settings?.xaiApiKey),
        hasXaiManagementApiKey: Boolean(settings?.xaiManagementApiKey),
        xaiModel: settings?.xaiModel || DEFAULT_XAI_MODEL,
        xaiRagModel: settings?.xaiRagModel || DEFAULT_RAG_MODEL,
      };
    },
  );

  app.put(
    "/settings/global",
    { preHandler: app.authenticate },
    async (request) => {
      await assertSystemPermission((request.user as any).sub, "system:manage");
      const payload = GlobalSettingsSchema.parse(request.body);
      const existing = await db.query.globalProviderSettings.findFirst({
        orderBy: (t, { desc }) => [desc(t.updatedAt)],
      });

      const nextValues = {
        elevenlabsApiKey:
          payload.elevenlabsApiKey !== undefined
            ? payload.elevenlabsApiKey || null
            : existing?.elevenlabsApiKey || null,
        xaiApiKey:
          payload.xaiApiKey !== undefined
            ? payload.xaiApiKey || null
            : existing?.xaiApiKey || null,
        xaiModel:
          payload.xaiModel !== undefined
            ? payload.xaiModel || null
            : existing?.xaiModel || DEFAULT_XAI_MODEL,
        xaiManagementApiKey:
          payload.xaiManagementApiKey !== undefined
            ? payload.xaiManagementApiKey || null
            : existing?.xaiManagementApiKey || null,
        xaiRagModel:
          payload.xaiRagModel !== undefined
            ? payload.xaiRagModel || null
            : existing?.xaiRagModel || DEFAULT_RAG_MODEL,
        updatedBy: (request.user as any).sub,
      };

      if (existing) {
        await db
          .update(globalProviderSettings)
          .set({ ...nextValues, updatedAt: new Date() })
          .where(eq(globalProviderSettings.id, existing.id));
      } else {
        await db.insert(globalProviderSettings).values(nextValues);
      }

      return {
        ok: true,
        hasElevenlabsApiKey: Boolean(nextValues.elevenlabsApiKey),
        hasXaiApiKey: Boolean(nextValues.xaiApiKey),
        hasXaiManagementApiKey: Boolean(nextValues.xaiManagementApiKey),
        xaiModel: nextValues.xaiModel,
        xaiRagModel: nextValues.xaiRagModel,
      };
    },
  );

  app.post(
    "/tenants/:tenantId/members",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ tenantId: z.string().uuid() })
        .parse(request.params);
      const body = z
        .object({
          email: z.string().email(),
          role: z.enum(["owner", "admin", "member", "viewer"]),
        })
        .parse(request.body);

      const actor = await assertTenantAccess(
        params.tenantId,
        (request.user as any).sub,
        {
          requireMembership: true,
        },
      );
      if (!actor || !["owner", "admin"].includes(actor.role)) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      const target = await db.query.users.findFirst({
        where: (u, op) => op.eq(u.email, body.email),
      });
      if (!target) {
        return reply.code(404).send({ message: "User not found" });
      }

      const existing = await db.query.tenantMemberships.findFirst({
        where: and(
          eq(tenantMemberships.tenantId, params.tenantId),
          eq(tenantMemberships.userId, target.id),
        ),
      });
      if (existing) {
        return reply.code(409).send({ message: "Membership already exists" });
      }

      const [membership] = await db
        .insert(tenantMemberships)
        .values({
          tenantId: params.tenantId,
          userId: target.id,
          role: body.role,
        })
        .returning();

      return membership;
    },
  );

  app.put(
    "/tenants/:tenantId/members/:userId/access",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ tenantId: z.string().uuid(), userId: z.string().uuid() })
        .parse(request.params);
      const body = UserVisibilitySchema.parse(request.body);

      const actor = await assertTenantAccess(
        params.tenantId,
        (request.user as any).sub,
        {
          requireMembership: true,
        },
      );
      if (!actor || !["owner", "admin"].includes(actor.role)) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      const target = await db.query.users.findFirst({
        where: eq(users.id, params.userId),
      });
      if (!target) {
        return reply.code(404).send({ message: "User not found" });
      }

      const existingMembership = await db.query.tenantMemberships.findFirst({
        where: and(
          eq(tenantMemberships.tenantId, params.tenantId),
          eq(tenantMemberships.userId, params.userId),
        ),
      });

      if (existingMembership) {
        await db
          .update(tenantMemberships)
          .set({
            role: body.role || existingMembership.role,
            updatedAt: new Date(),
          })
          .where(eq(tenantMemberships.id, existingMembership.id));
      } else {
        await db.insert(tenantMemberships).values({
          tenantId: params.tenantId,
          userId: params.userId,
          role: body.role || "member",
        });
      }

      await db
        .update(users)
        .set({ isRestricted: body.isRestricted, updatedAt: new Date() })
        .where(eq(users.id, params.userId));

      const tenantProjects = await db.query.projects.findMany({
        where: eq(projects.tenantId, params.tenantId),
        columns: { id: true },
      });
      const tenantProjectIds = tenantProjects.map((project) => project.id);
      const requestedProjectIds = [...new Set(body.projectIds)];

      if (requestedProjectIds.length) {
        const validProjects = await db.query.projects.findMany({
          where: and(
            eq(projects.tenantId, params.tenantId),
            inArray(projects.id, requestedProjectIds),
          ),
          columns: { id: true },
        });

        if (validProjects.length !== requestedProjectIds.length) {
          return reply
            .code(400)
            .send({
              message: "One or more projectIds do not belong to the tenant",
            });
        }
      }

      if (tenantProjectIds.length) {
        await db
          .delete(projectMemberships)
          .where(
            and(
              eq(projectMemberships.userId, params.userId),
              inArray(projectMemberships.projectId, tenantProjectIds),
            ),
          );
      }

      if (requestedProjectIds.length) {
        await db.insert(projectMemberships).values(
          requestedProjectIds.map((projectId) => ({
            projectId,
            userId: params.userId,
          })),
        );
      }

      return { ok: true };
    },
  );
};
