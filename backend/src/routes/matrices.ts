import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { projectMatrixRows, projectMatrixVersions, projects } from "../../drizzle/schema.js";
import { assertProjectAccess } from "../repos/access.js";

const MatrixRowsSchema = z.array(
  z.object({
    area: z.string().min(1),
    parameter: z.string().min(1),
    description: z.string().min(1),
    weight: z.number().int().positive(),
  }),
);

export const matrixRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/projects/:projectId/matrices/:callType/versions",
    { preHandler: app.authenticate },
    async (request) => {
      const params = z
        .object({ projectId: z.string().uuid(), callType: z.enum(["inbound", "outbound"]) })
        .parse(request.params);

      const project = await db.query.projects.findFirst({ where: eq(projects.id, params.projectId) });
      if (!project) throw new Error("Project not found");
      await assertProjectAccess(project.tenantId, project.id, (request.user as any).sub);

      return db.query.projectMatrixVersions.findMany({
        where: and(
          eq(projectMatrixVersions.projectId, params.projectId),
          eq(projectMatrixVersions.callType, params.callType),
        ),
        orderBy: (t, { desc }) => [desc(t.versionNumber)],
      });
    },
  );

  app.post(
    "/projects/:projectId/matrices/:callType/versions",
    { preHandler: app.authenticate },
    async (request) => {
      const params = z
        .object({ projectId: z.string().uuid(), callType: z.enum(["inbound", "outbound"]) })
        .parse(request.params);
      const rows = MatrixRowsSchema.parse((request.body as { rows?: unknown })?.rows ?? []);

      const project = await db.query.projects.findFirst({ where: eq(projects.id, params.projectId) });
      if (!project) throw new Error("Project not found");
      await assertProjectAccess(project.tenantId, project.id, (request.user as any).sub);

      const [current] = await db
        .select({ maxVersion: sql<number>`COALESCE(MAX(${projectMatrixVersions.versionNumber}), 0)` })
        .from(projectMatrixVersions)
        .where(
          and(
            eq(projectMatrixVersions.projectId, params.projectId),
            eq(projectMatrixVersions.callType, params.callType),
          ),
        );

      const [version] = await db
        .insert(projectMatrixVersions)
        .values({
          projectId: params.projectId,
          callType: params.callType,
          versionNumber: (current?.maxVersion ?? 0) + 1,
          isActive: false,
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

      return version;
    },
  );

  app.post(
    "/projects/:projectId/matrices/:callType/versions/:versionId/activate",
    { preHandler: app.authenticate },
    async (request) => {
      const params = z
        .object({
          projectId: z.string().uuid(),
          callType: z.enum(["inbound", "outbound"]),
          versionId: z.string().uuid(),
        })
        .parse(request.params);

      const project = await db.query.projects.findFirst({ where: eq(projects.id, params.projectId) });
      if (!project) throw new Error("Project not found");
      await assertProjectAccess(project.tenantId, project.id, (request.user as any).sub);

      await db
        .update(projectMatrixVersions)
        .set({ isActive: false })
        .where(
          and(
            eq(projectMatrixVersions.projectId, params.projectId),
            eq(projectMatrixVersions.callType, params.callType),
          ),
        );

      await db
        .update(projectMatrixVersions)
        .set({ isActive: true })
        .where(eq(projectMatrixVersions.id, params.versionId));

      return { ok: true };
    },
  );

  app.get(
    "/projects/:projectId/matrices/:callType/active",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const params = z
        .object({ projectId: z.string().uuid(), callType: z.enum(["inbound", "outbound"]) })
        .parse(request.params);

      const project = await db.query.projects.findFirst({ where: eq(projects.id, params.projectId) });
      if (!project) throw new Error("Project not found");
      await assertProjectAccess(project.tenantId, project.id, (request.user as any).sub);

      const version = await db.query.projectMatrixVersions.findFirst({
        where: and(
          eq(projectMatrixVersions.projectId, params.projectId),
          eq(projectMatrixVersions.callType, params.callType),
          eq(projectMatrixVersions.isActive, true),
        ),
      });

      if (!version) {
        return reply.code(404).send({ message: "Active version not found" });
      }

      const rows = await db.query.projectMatrixRows.findMany({
        where: eq(projectMatrixRows.matrixVersionId, version.id),
        orderBy: (t, { asc }) => [asc(t.rowIndex)],
      });

      return {
        ...version,
        rows,
      };
    },
  );
};
