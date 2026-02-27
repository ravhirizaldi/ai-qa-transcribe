import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import {
  batches,
  globalProviderSettings,
  jobAnalyses,
  jobEvaluationRows,
  jobs,
  jobSegments,
  jobTranscripts,
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
  assertTenantAccess,
  listAccessibleProjects,
  listAccessibleTenants,
} from "../repos/access.js";
import { toSlug } from "../utils/slug.js";
import inboundMatrix from "../data/inbound.json";
import outboundMatrix from "../data/outbound.json";

const CreateTenantSchema = z.object({
  name: z.string().min(2),
  logoUrl: z.string().url().nullable().optional(),
});

const UpdateTenantSchema = z.object({
  name: z.string().min(2).optional(),
  logoUrl: z.string().url().nullable().optional(),
});

const CreateProjectSchema = z.object({
  name: z.string().min(2),
  supportsInbound: z.boolean().default(true),
  supportsOutbound: z.boolean().default(false),
});

const UpdateProjectSchema = z.object({
  name: z.string().min(2).optional(),
  supportsInbound: z.boolean().optional(),
  supportsOutbound: z.boolean().optional(),
});

const GlobalSettingsSchema = z.object({
  elevenlabsApiKey: z.string().optional(),
  xaiApiKey: z.string().optional(),
  xaiModel: z.string().optional(),
});

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

const deleteProjectCascade = async (projectId: string) => {
  const projectJobs = await db.query.jobs.findMany({
    where: eq(jobs.projectId, projectId),
    columns: { id: true },
  });
  const jobIds = projectJobs.map((job) => job.id);

  if (jobIds.length) {
    await db.delete(jobEvaluationRows).where(inArray(jobEvaluationRows.jobId, jobIds));
    await db.delete(jobSegments).where(inArray(jobSegments.jobId, jobIds));
    await db.delete(jobTranscripts).where(inArray(jobTranscripts.jobId, jobIds));
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
    await db.delete(projectMatrixRows).where(
      inArray(projectMatrixRows.matrixVersionId, versionIds),
    );
  }

  await db.delete(projectMatrixVersions).where(eq(projectMatrixVersions.projectId, projectId));
  await db.delete(projectMemberships).where(eq(projectMemberships.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
};

export const tenantRoutes: FastifyPluginAsync = async (app) => {
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

  app.patch("/tenants/:tenantId", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ tenantId: z.string().uuid() }).parse(request.params);
    const payload = UpdateTenantSchema.parse(request.body);
    const actor = await assertTenantAccess(params.tenantId, (request.user as any).sub, {
      requireMembership: true,
    });

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
        ...(payload.logoUrl !== undefined ? { logoUrl: payload.logoUrl } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, params.tenantId))
      .returning();

    return updated;
  });

  app.delete("/tenants/:tenantId", { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ tenantId: z.string().uuid() }).parse(request.params);
    const actor = await assertTenantAccess(params.tenantId, (request.user as any).sub, {
      requireMembership: true,
    });

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

    await db.delete(tenantMemberships).where(eq(tenantMemberships.tenantId, params.tenantId));
    await db.delete(tenants).where(eq(tenants.id, params.tenantId));

    return { ok: true };
  });

  app.get("/tenants/:tenantId/projects", { preHandler: app.authenticate }, async (request) => {
    const params = z.object({ tenantId: z.string().uuid() }).parse(request.params);
    await assertTenantAccess(params.tenantId, (request.user as any).sub);

    return listAccessibleProjects(params.tenantId, (request.user as any).sub);
  });

  app.post(
    "/tenants/:tenantId/projects",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({ tenantId: z.string().uuid() }).parse(request.params);
      const payload = CreateProjectSchema.parse(request.body);
      const actor = await assertTenantAccess(params.tenantId, (request.user as any).sub, {
        requireMembership: true,
      });

      if (!actor) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      try {
        assertManageRole(actor.role);
      } catch {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      const [project] = await db
        .insert(projects)
        .values({
          tenantId: params.tenantId,
          name: payload.name,
          slug: toSlug(payload.name),
          supportsInbound: payload.supportsInbound,
          supportsOutbound: payload.supportsOutbound,
        })
        .returning();

      const seedVersion = async (
        callType: "inbound" | "outbound",
        rows: Array<{ area: string; parameter: string; description: string; weight: number }>,
      ) => {
        const [version] = await db
          .insert(projectMatrixVersions)
          .values({
            projectId: project.id,
            callType,
            versionNumber: 1,
            isActive: true,
            createdBy: (request.user as any).sub,
          })
          .returning();

        await db.insert(projectMatrixRows).values(
          rows.map((row, idx) => ({
            matrixVersionId: version.id,
            rowIndex: idx,
            area: row.area,
            parameter: row.parameter,
            description: row.description,
            weight: row.weight,
          })),
        );
      };

      if (payload.supportsInbound) {
        await seedVersion("inbound", inboundMatrix);
      }
      if (payload.supportsOutbound) {
        await seedVersion("outbound", outboundMatrix);
      }

      return project;
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
      const actor = await assertTenantAccess(params.tenantId, (request.user as any).sub, {
        requireMembership: true,
      });

      if (!actor) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      try {
        assertManageRole(actor.role);
      } catch {
        return reply.code(403).send({ message: "Insufficient permissions" });
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
          ...(payload.supportsInbound !== undefined
            ? { supportsInbound: payload.supportsInbound }
            : {}),
          ...(payload.supportsOutbound !== undefined
            ? { supportsOutbound: payload.supportsOutbound }
            : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(projects.id, params.projectId), eq(projects.tenantId, params.tenantId)))
        .returning();

      return updated;
    },
  );

  app.delete(
    "/tenants/:tenantId/projects/:projectId",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ tenantId: z.string().uuid(), projectId: z.string().uuid() })
        .parse(request.params);
      const actor = await assertTenantAccess(params.tenantId, (request.user as any).sub, {
        requireMembership: true,
      });

      if (!actor) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      try {
        assertManageRole(actor.role);
      } catch {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      await assertProjectAccess(params.tenantId, params.projectId, (request.user as any).sub);
      await deleteProjectCascade(params.projectId);
      return { ok: true };
    },
  );

  app.get("/settings/global", { preHandler: app.authenticate }, async () => {
    const settings = await db.query.globalProviderSettings.findFirst({
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
    });

    return {
      hasElevenlabsApiKey: Boolean(settings?.elevenlabsApiKey),
      hasXaiApiKey: Boolean(settings?.xaiApiKey),
      xaiModel: settings?.xaiModel || "grok-4-1-fast-non-reasoning",
    };
  });

  app.put("/settings/global", { preHandler: app.authenticate }, async (request) => {
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
        payload.xaiApiKey !== undefined ? payload.xaiApiKey || null : existing?.xaiApiKey || null,
      xaiModel:
        payload.xaiModel !== undefined
          ? payload.xaiModel || null
          : existing?.xaiModel || "grok-4-1-fast-non-reasoning",
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
      xaiModel: nextValues.xaiModel,
    };
  });

  app.post(
    "/tenants/:tenantId/members",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z.object({ tenantId: z.string().uuid() }).parse(request.params);
      const body = z
        .object({
          email: z.string().email(),
          role: z.enum(["owner", "admin", "member", "viewer"]),
        })
        .parse(request.body);

      const actor = await assertTenantAccess(params.tenantId, (request.user as any).sub, {
        requireMembership: true,
      });
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

      const actor = await assertTenantAccess(params.tenantId, (request.user as any).sub, {
        requireMembership: true,
      });
      if (!actor || !["owner", "admin"].includes(actor.role)) {
        return reply.code(403).send({ message: "Insufficient permissions" });
      }

      const target = await db.query.users.findFirst({ where: eq(users.id, params.userId) });
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
          .set({ role: body.role || existingMembership.role, updatedAt: new Date() })
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

      if (tenantProjectIds.length) {
        await db.delete(projectMemberships).where(
          and(
            eq(projectMemberships.userId, params.userId),
            inArray(projectMemberships.projectId, tenantProjectIds),
          ),
        );
      }

      if (body.projectIds.length) {
        await db.insert(projectMemberships).values(
          body.projectIds.map((projectId) => ({
            projectId,
            userId: params.userId,
          })),
        );
      }

      return { ok: true };
    },
  );
};
