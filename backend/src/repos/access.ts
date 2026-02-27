import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db.js";
import {
  projectMatrixVersions,
  projects,
  tenantMemberships,
  tenants,
} from "../../drizzle/schema.js";
type CallType = "inbound" | "outbound";

export const assertTenantAccess = async (tenantId: string, userId: string) => {
  const membership = await db.query.tenantMemberships.findFirst({
    where: and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.userId, userId),
    ),
  });
  if (!membership) {
    throw new Error("Forbidden tenant access");
  }
  return membership;
};

export const listAccessibleTenants = async (userId: string) => {
  const memberships = await db.query.tenantMemberships.findMany({
    where: eq(tenantMemberships.userId, userId),
  });
  if (!memberships.length) return [];
  return db.query.tenants.findMany({
    where: inArray(
      tenants.id,
      memberships.map((m) => m.tenantId),
    ),
  });
};

export const assertProjectAccess = async (
  tenantId: string,
  projectId: string,
  userId: string,
) => {
  await assertTenantAccess(tenantId, userId);
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)),
  });
  if (!project) throw new Error("Project not found");
  return project;
};

export const getActiveMatrixVersion = async (
  projectId: string,
  callType: CallType,
) => {
  const version = await db.query.projectMatrixVersions.findFirst({
    where: and(
      eq(projectMatrixVersions.projectId, projectId),
      eq(projectMatrixVersions.callType, callType),
      eq(projectMatrixVersions.isActive, true),
    ),
    orderBy: (t, { desc }) => [desc(t.versionNumber)],
  });
  if (!version) {
    throw new Error("No active matrix version for selected project and call type");
  }
  return version;
};
