import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db.js";
import {
  projectMemberships,
  projectMatrixVersions,
  projects,
  tenantMemberships,
  tenants,
  users,
} from "../../drizzle/schema.js";
type CallType = "inbound" | "outbound";

const getUser = async (userId: string) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("User not found");
  return user;
};

export const assertTenantAccess = async (
  tenantId: string,
  userId: string,
  options?: { requireMembership?: boolean },
) => {
  const requireMembership = Boolean(options?.requireMembership);
  const user = await getUser(userId);
  const membership = await db.query.tenantMemberships.findFirst({
    where: and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.userId, userId),
    ),
  });
  if (requireMembership && !membership) {
    throw new Error("Forbidden tenant access");
  }
  if (user.isRestricted && !membership) {
    throw new Error("Forbidden tenant access");
  }
  return membership ?? null;
};

export const listAccessibleTenants = async (userId: string) => {
  const user = await getUser(userId);
  if (!user.isRestricted) {
    return db.query.tenants.findMany();
  }

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
  options?: { requireMembership?: boolean },
) => {
  await assertTenantAccess(tenantId, userId, options);
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)),
  });
  if (!project) throw new Error("Project not found");

  const user = await getUser(userId);
  if (user.isRestricted) {
    const pm = await db.query.projectMemberships.findFirst({
      where: and(
        eq(projectMemberships.userId, userId),
        eq(projectMemberships.projectId, projectId),
      ),
    });
    if (!pm) throw new Error("Forbidden project access");
  }

  return project;
};

export const listAccessibleProjects = async (tenantId: string, userId: string) => {
  const user = await getUser(userId);
  if (!user.isRestricted) {
    return db.query.projects.findMany({
      where: eq(projects.tenantId, tenantId),
    });
  }

  const memberships = await db.query.projectMemberships.findMany({
    where: eq(projectMemberships.userId, userId),
  });
  if (!memberships.length) return [];

  return db.query.projects.findMany({
    where: and(
      eq(projects.tenantId, tenantId),
      inArray(
        projects.id,
        memberships.map((m) => m.projectId),
      ),
    ),
  });
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
