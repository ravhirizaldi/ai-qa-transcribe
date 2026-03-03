import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db.js";
import {
  accessRoles,
  projectMemberships,
  projectMatrixVersions,
  projects,
  tenantMemberships,
  tenants,
  userRoleAssignments,
  users,
} from "../../drizzle/schema.js";

type CallType = "inbound" | "outbound";
type TenantMembershipRole = "owner" | "admin" | "member" | "viewer";

export const AVAILABLE_PERMISSION_KEYS = [
  "tenants:view",
  "tenants:manage",
  "projects:view",
  "projects:manage",
  "matrices:view",
  "matrices:manage",
  "jobs:view",
  "jobs:manage",
  "settings:view",
  "settings:manage",
  "users:manage",
  "roles:manage",
  "system:manage",
] as const;

export type PermissionKey = (typeof AVAILABLE_PERMISSION_KEYS)[number];

export type RoleScope = {
  includeAllTenants: boolean;
  includeAllProjects: boolean;
  tenantIds: string[];
  projectIds: string[];
};

type ParsedRoleAssignment = {
  id: string;
  roleId: string;
  roleName: string;
  permissions: PermissionKey[];
  scope: RoleScope;
};

type TenantAccessResult = {
  id: string;
  tenantId: string;
  userId: string;
  role: TenantMembershipRole;
  createdAt: Date;
  updatedAt: Date;
  isSuperAdmin?: boolean;
} | null;

const isMissingTenantRoleColumnError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("tenant_memberships") && message.includes('column "role" does not exist');
};

export const normalizePermissionList = (input: unknown): PermissionKey[] => {
  if (!Array.isArray(input)) return [];
  const valid = new Set<PermissionKey>(AVAILABLE_PERMISSION_KEYS);
  const result: PermissionKey[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    if (!valid.has(value as PermissionKey)) continue;
    if (!result.includes(value as PermissionKey)) {
      result.push(value as PermissionKey);
    }
  }
  return result;
};

export const normalizeRoleScope = (input: unknown): RoleScope => {
  const raw =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const sanitizeUuidList = (value: unknown) => {
    if (!Array.isArray(value)) return [];
    const items = value.filter((item): item is string => typeof item === "string");
    return [...new Set(items)];
  };

  return {
    includeAllTenants: raw.includeAllTenants === true,
    includeAllProjects: raw.includeAllProjects === true,
    tenantIds: sanitizeUuidList(raw.tenantIds),
    projectIds: sanitizeUuidList(raw.projectIds),
  };
};

const getUser = async (userId: string) => {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) throw new Error("User not found");
  return user;
};

const getParsedRoleAssignments = async (userId: string): Promise<ParsedRoleAssignment[]> => {
  const rows = await db
    .select({
      assignmentId: userRoleAssignments.id,
      roleId: accessRoles.id,
      roleName: accessRoles.name,
      permissionsJson: accessRoles.permissionsJson,
      scopeJson: userRoleAssignments.scopeJson,
    })
    .from(userRoleAssignments)
    .innerJoin(accessRoles, eq(userRoleAssignments.roleId, accessRoles.id))
    .where(eq(userRoleAssignments.userId, userId));

  return rows.map((row) => ({
    id: row.assignmentId,
    roleId: row.roleId,
    roleName: row.roleName,
    permissions: normalizePermissionList(row.permissionsJson),
    scope: normalizeRoleScope(row.scopeJson),
  }));
};

const hasPermission = (permissions: PermissionKey[], needed: PermissionKey) => {
  if (permissions.includes(needed)) return true;
  if (needed.endsWith(":view")) {
    const elevated = needed.replace(":view", ":manage") as PermissionKey;
    return permissions.includes(elevated);
  }
  if (needed === "settings:view") {
    return (
      permissions.includes("settings:manage") ||
      permissions.includes("users:manage") ||
      permissions.includes("roles:manage") ||
      permissions.includes("system:manage")
    );
  }
  return false;
};

const tenantScopeIncludes = (scope: RoleScope, tenantId: string) => {
  return scope.includeAllTenants || scope.tenantIds.includes(tenantId);
};

const projectScopeIncludes = (scope: RoleScope, projectId: string) => {
  return scope.includeAllProjects || scope.projectIds.includes(projectId);
};

const hasScopedTenantPermission = async (
  assignments: ParsedRoleAssignment[],
  tenantId: string,
  permission: PermissionKey,
) => {
  const projectScopedRoleRows = assignments
    .filter((assignment) => hasPermission(assignment.permissions, permission))
    .filter((assignment) => assignment.scope.projectIds.length > 0);

  const scopedProjectIds = [
    ...new Set(projectScopedRoleRows.flatMap((assignment) => assignment.scope.projectIds)),
  ];

  let projectTenantMatch = false;
  if (scopedProjectIds.length) {
    const scopedProjects = await db.query.projects.findMany({
      where: inArray(projects.id, scopedProjectIds),
      columns: { id: true, tenantId: true },
    });
    projectTenantMatch = scopedProjects.some((project) => project.tenantId === tenantId);
  }

  return assignments.some((assignment) => {
    if (!hasPermission(assignment.permissions, permission)) return false;
    if (tenantScopeIncludes(assignment.scope, tenantId)) return true;
    if (assignment.scope.includeAllProjects) return true;
    return projectTenantMatch;
  });
};

const hasScopedProjectPermission = async (
  assignments: ParsedRoleAssignment[],
  tenantId: string,
  projectId: string,
  permission: PermissionKey,
) => {
  return assignments.some((assignment) => {
    if (!hasPermission(assignment.permissions, permission)) return false;
    if (tenantScopeIncludes(assignment.scope, tenantId)) return true;
    return projectScopeIncludes(assignment.scope, projectId);
  });
};

export const assertSystemPermission = async (userId: string, permission: PermissionKey) => {
  const user = await getUser(userId);
  if (!user.isRestricted) return;

  const assignments = await getParsedRoleAssignments(userId);
  const allowed = assignments.some((assignment) => hasPermission(assignment.permissions, permission));
  if (!allowed) {
    throw new Error("Insufficient permissions");
  }
};

export const listUserRoleAssignments = async (userId: string) => {
  return getParsedRoleAssignments(userId);
};

export const assertTenantAccess = async (
  tenantId: string,
  userId: string,
  options?: { requireMembership?: boolean },
): Promise<TenantAccessResult> => {
  const requireMembership = Boolean(options?.requireMembership);
  const user = await getUser(userId);

  let membership: TenantAccessResult = null;
  try {
    membership = (await db.query.tenantMemberships.findFirst({
      where: and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, userId)),
    })) ?? null;
  } catch (error) {
    if (!isMissingTenantRoleColumnError(error)) {
      throw error;
    }
    if (user.isRestricted) {
      throw new Error("Forbidden tenant access");
    }
  }

  if (!user.isRestricted) {
    return {
      id: `super-admin-${tenantId}-${userId}`,
      tenantId,
      userId,
      role: "owner",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      isSuperAdmin: true,
    };
  }

  if (membership) {
    return membership;
  }

  const assignments = await getParsedRoleAssignments(userId);
  if (!assignments.length) {
    throw new Error("Forbidden tenant access");
  }

  const needed: PermissionKey = requireMembership ? "tenants:manage" : "tenants:view";
  const allowed = await hasScopedTenantPermission(assignments, tenantId, needed);
  if (!allowed) {
    throw new Error("Forbidden tenant access");
  }

  return {
    id: `role-assignment-${tenantId}-${userId}`,
    tenantId,
    userId,
    role: requireMembership ? "owner" : "viewer",
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
};

export const listAccessibleTenants = async (userId: string) => {
  const user = await getUser(userId);
  if (!user.isRestricted) {
    return db.query.tenants.findMany();
  }

  const [memberships, assignments] = await Promise.all([
    db.query.tenantMemberships.findMany({ where: eq(tenantMemberships.userId, userId) }),
    getParsedRoleAssignments(userId),
  ]);

  const permissionFiltered = assignments.filter((assignment) =>
    assignment.permissions.some(
      (permission) =>
        hasPermission([permission], "tenants:view") ||
        hasPermission([permission], "projects:view") ||
        hasPermission([permission], "jobs:view") ||
        hasPermission([permission], "matrices:view"),
    ),
  );

  if (permissionFiltered.some((assignment) => assignment.scope.includeAllTenants)) {
    return db.query.tenants.findMany();
  }

  const tenantIds = new Set<string>(memberships.map((membership) => membership.tenantId));
  for (const assignment of permissionFiltered) {
    for (const tenantId of assignment.scope.tenantIds) {
      tenantIds.add(tenantId);
    }
  }

  const scopedProjectIds = [
    ...new Set(permissionFiltered.flatMap((assignment) => assignment.scope.projectIds)),
  ];
  if (scopedProjectIds.length) {
    const scopedProjects = await db.query.projects.findMany({
      where: inArray(projects.id, scopedProjectIds),
      columns: { tenantId: true },
    });
    for (const project of scopedProjects) {
      tenantIds.add(project.tenantId);
    }
  }

  if (!tenantIds.size) return [];
  return db.query.tenants.findMany({
    where: inArray(tenants.id, [...tenantIds]),
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
  if (!user.isRestricted) {
    return project;
  }

  const [tenantMembership, projectMembership, assignments] = await Promise.all([
    db.query.tenantMemberships.findFirst({
      where: and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, tenantId)),
    }),
    db.query.projectMemberships.findFirst({
      where: and(eq(projectMemberships.userId, userId), eq(projectMemberships.projectId, projectId)),
    }),
    getParsedRoleAssignments(userId),
  ]);

  const hasElevatedTenantMembership =
    tenantMembership && ["owner", "admin"].includes(tenantMembership.role);
  const hasRoleProjectAccess = await hasScopedProjectPermission(
    assignments,
    tenantId,
    projectId,
    "projects:view",
  );

  if (!projectMembership && !hasElevatedTenantMembership && !hasRoleProjectAccess) {
    throw new Error("Forbidden project access");
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

  const [tenantMembership, projectMembershipRows, assignments] = await Promise.all([
    db.query.tenantMemberships.findFirst({
      where: and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, tenantId)),
    }),
    db.query.projectMemberships.findMany({
      where: eq(projectMemberships.userId, userId),
    }),
    getParsedRoleAssignments(userId),
  ]);

  if (tenantMembership && ["owner", "admin"].includes(tenantMembership.role)) {
    return db.query.projects.findMany({
      where: eq(projects.tenantId, tenantId),
    });
  }

  const relevantAssignments = assignments.filter((assignment) =>
    assignment.permissions.some((permission) => hasPermission([permission], "projects:view")),
  );

  if (
    relevantAssignments.some(
      (assignment) =>
        tenantScopeIncludes(assignment.scope, tenantId) || assignment.scope.includeAllProjects,
    )
  ) {
    return db.query.projects.findMany({
      where: eq(projects.tenantId, tenantId),
    });
  }

  const scopedProjectIds = new Set<string>(projectMembershipRows.map((membership) => membership.projectId));
  for (const assignment of relevantAssignments) {
    for (const projectId of assignment.scope.projectIds) {
      scopedProjectIds.add(projectId);
    }
  }

  if (!scopedProjectIds.size) return [];
  return db.query.projects.findMany({
    where: and(eq(projects.tenantId, tenantId), inArray(projects.id, [...scopedProjectIds])),
  });
};

export const assertProjectPermission = async (
  tenantId: string,
  projectId: string,
  userId: string,
  permission: PermissionKey,
) => {
  await assertProjectAccess(tenantId, projectId, userId);

  const user = await getUser(userId);
  if (!user.isRestricted) return;

  if (permission.endsWith(":view")) return;

  const [tenantMembership, assignments] = await Promise.all([
    db.query.tenantMemberships.findFirst({
      where: and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, tenantId)),
    }),
    getParsedRoleAssignments(userId),
  ]);

  if (tenantMembership && ["owner", "admin"].includes(tenantMembership.role)) {
    return;
  }

  const allowed = await hasScopedProjectPermission(assignments, tenantId, projectId, permission);
  if (!allowed) {
    throw new Error("Insufficient permissions");
  }
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
