import { and, count, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import {
  accessRoles,
  batches,
  globalProviderSettings,
  jobAnalyses,
  jobEvaluationRows,
  jobScoreEditHistory,
  jobSegments,
  jobTranscripts,
  jobs,
  projectMemberships,
  projects,
  tenantMemberships,
  tenants,
  userRoleAssignments,
  users,
} from "../../drizzle/schema.js";
import {
  AVAILABLE_PERMISSION_KEYS,
  assertSystemPermission,
  normalizePermissionList,
  normalizeRoleScope,
} from "../repos/access.js";
import { hashPassword } from "../auth.js";
import { deleteUploadFile } from "../storage.js";

const SettingsRoleSchema = z.object({
  name: z.string().min(2),
  description: z.string().nullable().optional(),
  permissions: z.array(z.enum(AVAILABLE_PERMISSION_KEYS)).min(1),
});

const UserAccessSchema = z.object({
  isRestricted: z.boolean(),
  assignments: z
    .array(
      z.object({
        roleId: z.string().uuid(),
        scope: z
          .object({
            includeAllTenants: z.boolean().optional(),
            includeAllProjects: z.boolean().optional(),
            tenantIds: z.array(z.string().uuid()).default([]),
            projectIds: z.array(z.string().uuid()).default([]),
          })
          .default({ tenantIds: [], projectIds: [] }),
      }),
    )
    .default([]),
});

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullname: z.string().max(120).optional(),
  isRestricted: z.boolean().default(true),
});

const UpdateUserSchema = z
  .object({
    email: z.string().email().optional(),
    fullname: z.string().max(120).optional(),
    isRestricted: z.boolean().optional(),
  })
  .refine((data) => data.email !== undefined || data.fullname !== undefined || data.isRestricted !== undefined, {
    message: "No changes provided",
  });

const UpdatePasswordSchema = z.object({
  password: z.string().min(8),
});

const normalizeFullname = (value: string | null | undefined) => {
  const name = String(value || "").trim();
  return name || "User";
};

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const activeJobStatuses = new Set(["queued", "uploading", "transcribing", "analyzing"]);

  app.post("/settings/users", { preHandler: app.authenticate }, async (request, reply) => {
    await assertSystemPermission((request.user as any).sub, "users:manage");
    const body = CreateUserSchema.parse(request.body);

    const existing = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (existing) {
      return reply.code(409).send({ message: "Email already registered" });
    }

    const [created] = await db
      .insert(users)
      .values({
        email: body.email,
        fullname: normalizeFullname(body.fullname),
        passwordHash: await hashPassword(body.password),
        isRestricted: body.isRestricted,
      })
      .returning({
        id: users.id,
        email: users.email,
        fullname: users.fullname,
        isRestricted: users.isRestricted,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    return { ...created, assignments: [] };
  });

  app.get("/settings/users", { preHandler: app.authenticate }, async (request) => {
    await assertSystemPermission((request.user as any).sub, "users:manage");

    const [allUsers, assignmentRows, roleRows] = await Promise.all([
      db.query.users.findMany({
        columns: {
          id: true,
          email: true,
          fullname: true,
          isRestricted: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db
        .select({
          id: userRoleAssignments.id,
          userId: userRoleAssignments.userId,
          roleId: userRoleAssignments.roleId,
          scopeJson: userRoleAssignments.scopeJson,
        })
        .from(userRoleAssignments),
      db.query.accessRoles.findMany({
        columns: {
          id: true,
          name: true,
          description: true,
          permissionsJson: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const rolesById = new Map(roleRows.map((role) => [role.id, role]));
    const assignmentsByUser = new Map<
      string,
      Array<{
        id: string;
        roleId: string;
        roleName: string;
        permissions: string[];
        scope: ReturnType<typeof normalizeRoleScope>;
      }>
    >();

    for (const assignment of assignmentRows) {
      const role = rolesById.get(assignment.roleId);
      if (!role) continue;
      const list = assignmentsByUser.get(assignment.userId) || [];
      list.push({
        id: assignment.id,
        roleId: assignment.roleId,
        roleName: role.name,
        permissions: normalizePermissionList(role.permissionsJson),
        scope: normalizeRoleScope(assignment.scopeJson),
      });
      assignmentsByUser.set(assignment.userId, list);
    }

    return allUsers.map((user) => ({
      ...user,
      assignments: assignmentsByUser.get(user.id) || [],
    }));
  });

  app.patch("/settings/users/:userId", { preHandler: app.authenticate }, async (request, reply) => {
    await assertSystemPermission((request.user as any).sub, "users:manage");
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = UpdateUserSchema.parse(request.body);

    const existing = await db.query.users.findFirst({ where: eq(users.id, params.userId) });
    if (!existing) {
      return reply.code(404).send({ message: "User not found" });
    }

    if (body.email && body.email !== existing.email) {
      const duplicate = await db.query.users.findFirst({ where: eq(users.email, body.email) });
      if (duplicate) {
        return reply.code(409).send({ message: "Email already registered" });
      }
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.fullname !== undefined ? { fullname: normalizeFullname(body.fullname) } : {}),
        ...(body.isRestricted !== undefined ? { isRestricted: body.isRestricted } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, params.userId))
      .returning({
        id: users.id,
        email: users.email,
        fullname: users.fullname,
        isRestricted: users.isRestricted,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      });

    return updated;
  });

  app.put(
    "/settings/users/:userId/password",
    { preHandler: app.authenticate },
    async (request, reply) => {
      await assertSystemPermission((request.user as any).sub, "users:manage");
      const params = z.object({ userId: z.string().uuid() }).parse(request.params);
      const body = UpdatePasswordSchema.parse(request.body);

      const existing = await db.query.users.findFirst({ where: eq(users.id, params.userId) });
      if (!existing) {
        return reply.code(404).send({ message: "User not found" });
      }

      await db
        .update(users)
        .set({ passwordHash: await hashPassword(body.password), updatedAt: new Date() })
        .where(eq(users.id, params.userId));

      return { ok: true };
    },
  );

  app.delete("/settings/users/:userId", { preHandler: app.authenticate }, async (request, reply) => {
    await assertSystemPermission((request.user as any).sub, "users:manage");
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const actorId = (request.user as any).sub as string;

    if (params.userId === actorId) {
      return reply.code(400).send({ message: "You cannot delete your own account" });
    }

    const existing = await db.query.users.findFirst({ where: eq(users.id, params.userId) });
    if (!existing) {
      return reply.code(404).send({ message: "User not found" });
    }

    const [jobRef, tenantRef] = await Promise.all([
      db.query.jobs.findFirst({ where: eq(jobs.userId, params.userId), columns: { id: true } }),
      db.query.tenants.findFirst({ where: eq(tenants.createdBy, params.userId), columns: { id: true } }),
    ]);

    if (jobRef || tenantRef) {
      return reply.code(409).send({
        message:
          "Cannot delete user with existing job or tenant ownership records. Reassign ownership first.",
      });
    }

    await db.delete(projectMemberships).where(eq(projectMemberships.userId, params.userId));
    await db.delete(tenantMemberships).where(eq(tenantMemberships.userId, params.userId));
    await db.delete(userRoleAssignments).where(eq(userRoleAssignments.userId, params.userId));
    await db.delete(users).where(eq(users.id, params.userId));

    return { ok: true };
  });

  app.put("/settings/users/:userId/access", { preHandler: app.authenticate }, async (request, reply) => {
    await assertSystemPermission((request.user as any).sub, "users:manage");

    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = UserAccessSchema.parse(request.body);
    if (
      body.assignments.some(
        (assignment) =>
          assignment.scope.includeAllTenants === true || assignment.scope.includeAllProjects === true,
      )
    ) {
      return reply
        .code(400)
        .send({ message: "All tenants/projects shortcuts are disabled. Select scopes manually." });
    }
    const target = await db.query.users.findFirst({ where: eq(users.id, params.userId) });
    if (!target) {
      return reply.code(404).send({ message: "User not found" });
    }

    const roleIds = [...new Set(body.assignments.map((assignment) => assignment.roleId))];
    if (roleIds.length) {
      const existingRoles = await db.query.accessRoles.findMany({
        where: inArray(accessRoles.id, roleIds),
        columns: { id: true },
      });
      if (existingRoles.length !== roleIds.length) {
        return reply.code(400).send({ message: "One or more roles do not exist" });
      }
    }

    const scopedProjectIds = [
      ...new Set(body.assignments.flatMap((assignment) => assignment.scope.projectIds || [])),
    ];
    if (scopedProjectIds.length) {
      const existingProjects = await db.query.projects.findMany({
        where: inArray(projects.id, scopedProjectIds),
        columns: { id: true },
      });
      if (existingProjects.length !== scopedProjectIds.length) {
        return reply.code(400).send({ message: "One or more projectIds do not exist" });
      }
    }

    await db
      .update(users)
      .set({ isRestricted: body.isRestricted, updatedAt: new Date() })
      .where(eq(users.id, params.userId));

    await db.delete(userRoleAssignments).where(eq(userRoleAssignments.userId, params.userId));
    if (body.assignments.length) {
      await db.insert(userRoleAssignments).values(
        body.assignments.map((assignment) => ({
          userId: params.userId,
          roleId: assignment.roleId,
          scopeJson: normalizeRoleScope(assignment.scope),
        })),
      );
    }

    return { ok: true };
  });

  app.get("/settings/roles", { preHandler: app.authenticate }, async (request) => {
    await assertSystemPermission((request.user as any).sub, "settings:view");

    const roles = await db
      .select({
        id: accessRoles.id,
        name: accessRoles.name,
        description: accessRoles.description,
        permissionsJson: accessRoles.permissionsJson,
        createdBy: accessRoles.createdBy,
        createdAt: accessRoles.createdAt,
        updatedAt: accessRoles.updatedAt,
        assignmentCount: sql<number>`count(${userRoleAssignments.id})`,
      })
      .from(accessRoles)
      .leftJoin(userRoleAssignments, eq(accessRoles.id, userRoleAssignments.roleId))
      .groupBy(accessRoles.id);

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      permissions: normalizePermissionList(role.permissionsJson),
      createdBy: role.createdBy,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      assignmentCount: Number(role.assignmentCount || 0),
    }));
  });

  app.post("/settings/roles", { preHandler: app.authenticate }, async (request, reply) => {
    await assertSystemPermission((request.user as any).sub, "roles:manage");
    const body = SettingsRoleSchema.parse(request.body);

    const existing = await db.query.accessRoles.findFirst({ where: eq(accessRoles.name, body.name) });
    if (existing) {
      return reply.code(409).send({ message: "Role name already exists" });
    }

    const [created] = await db
      .insert(accessRoles)
      .values({
        name: body.name,
        description: body.description ?? null,
        permissionsJson: body.permissions,
        createdBy: (request.user as any).sub,
      })
      .returning();

    return {
      ...created,
      permissions: normalizePermissionList(created.permissionsJson),
      assignmentCount: 0,
    };
  });

  app.patch("/settings/roles/:roleId", { preHandler: app.authenticate }, async (request, reply) => {
    await assertSystemPermission((request.user as any).sub, "roles:manage");

    const params = z.object({ roleId: z.string().uuid() }).parse(request.params);
    const body = SettingsRoleSchema.partial().parse(request.body);

    const existing = await db.query.accessRoles.findFirst({ where: eq(accessRoles.id, params.roleId) });
    if (!existing) {
      return reply.code(404).send({ message: "Role not found" });
    }

    if (body.name && body.name !== existing.name) {
      const duplicate = await db.query.accessRoles.findFirst({
        where: and(eq(accessRoles.name, body.name), sql`${accessRoles.id} <> ${params.roleId}`),
      });
      if (duplicate) {
        return reply.code(409).send({ message: "Role name already exists" });
      }
    }

    const [updated] = await db
      .update(accessRoles)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.permissions !== undefined ? { permissionsJson: body.permissions } : {}),
        updatedAt: new Date(),
      })
      .where(eq(accessRoles.id, params.roleId))
      .returning();

    const [assignmentSummary] = await db
      .select({ total: count() })
      .from(userRoleAssignments)
      .where(eq(userRoleAssignments.roleId, params.roleId));

    return {
      ...updated,
      permissions: normalizePermissionList(updated.permissionsJson),
      assignmentCount: Number(assignmentSummary?.total ?? 0),
    };
  });

  app.delete("/settings/roles/:roleId", { preHandler: app.authenticate }, async (request, reply) => {
    await assertSystemPermission((request.user as any).sub, "roles:manage");
    const params = z.object({ roleId: z.string().uuid() }).parse(request.params);

    const existing = await db.query.accessRoles.findFirst({ where: eq(accessRoles.id, params.roleId) });
    if (!existing) {
      return reply.code(404).send({ message: "Role not found" });
    }

    await db.delete(accessRoles).where(eq(accessRoles.id, params.roleId));
    return { ok: true };
  });

  app.get("/settings/system", { preHandler: app.authenticate }, async (request) => {
    await assertSystemPermission((request.user as any).sub, "system:manage");
    const settings = await db.query.globalProviderSettings.findFirst({
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
    });

    return {
      hasElevenlabsApiKey: Boolean(settings?.elevenlabsApiKey),
      hasXaiApiKey: Boolean(settings?.xaiApiKey),
      hasXaiManagementApiKey: Boolean(settings?.xaiManagementApiKey),
      xaiModel: settings?.xaiModel || "grok-4-1-fast-non-reasoning",
      xaiRagModel: settings?.xaiRagModel || "grok-4-1-fast-reasoning",
    };
  });

  app.put("/settings/system", { preHandler: app.authenticate }, async (request) => {
    await assertSystemPermission((request.user as any).sub, "system:manage");
    const payload = z
      .object({
        elevenlabsApiKey: z.string().optional(),
        xaiApiKey: z.string().optional(),
        xaiModel: z.string().optional(),
        xaiManagementApiKey: z.string().optional(),
        xaiRagModel: z.string().optional(),
      })
      .parse(request.body);

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
          : existing?.xaiModel || "grok-4-1-fast-non-reasoning",
      xaiManagementApiKey:
        payload.xaiManagementApiKey !== undefined
          ? payload.xaiManagementApiKey || null
          : existing?.xaiManagementApiKey || null,
      xaiRagModel:
        payload.xaiRagModel !== undefined
          ? payload.xaiRagModel || null
          : existing?.xaiRagModel || "grok-4-1-fast-reasoning",
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
  });

  app.delete("/settings/system/qa-history", { preHandler: app.authenticate }, async (request, reply) => {
    await assertSystemPermission((request.user as any).sub, "system:manage");

    const [allJobs, allBatches] = await Promise.all([
      db.query.jobs.findMany({
        columns: { id: true, status: true, filePath: true },
      }),
      db.query.batches.findMany({
        columns: { id: true },
      }),
    ]);

    const activeJobs = allJobs.filter((job) => activeJobStatuses.has(String(job.status)));
    if (activeJobs.length) {
      return reply.code(409).send({
        message:
          "Cannot reset QA history while recordings are still processing. Wait for queue to finish first.",
        activeJobs: activeJobs.length,
      });
    }

    const jobIds = allJobs.map((job) => job.id);
    const batchCount = allBatches.length;
    let deletedFiles = 0;

    for (const job of allJobs) {
      try {
        await deleteUploadFile(job.filePath);
        deletedFiles += 1;
      } catch {
        // Continue deleting DB rows even if file is already missing.
      }
    }

    if (jobIds.length) {
      await db.delete(jobScoreEditHistory).where(inArray(jobScoreEditHistory.jobId, jobIds));
      await db.delete(jobEvaluationRows).where(inArray(jobEvaluationRows.jobId, jobIds));
      await db.delete(jobAnalyses).where(inArray(jobAnalyses.jobId, jobIds));
      await db.delete(jobSegments).where(inArray(jobSegments.jobId, jobIds));
      await db.delete(jobTranscripts).where(inArray(jobTranscripts.jobId, jobIds));
      await db.delete(jobs).where(inArray(jobs.id, jobIds));
    }

    await db.delete(batches);

    return {
      ok: true,
      deletedBatches: batchCount,
      deletedJobs: jobIds.length,
      deletedFiles,
    };
  });
};

