import { z } from "zod";

export const TenantRoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export type TenantRole = z.infer<typeof TenantRoleSchema>;

export const TenantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  logoUrl: z.string().nullable(),
  supportsInbound: z.boolean(),
  supportsOutbound: z.boolean(),
  batchHistoryLockDays: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const MatrixRowSchema = z.object({
  rowIndex: z.number().int(),
  area: z.string(),
  parameter: z.string(),
  description: z.string(),
  weight: z.number(),
});

export const MatrixVersionSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  callType: z.enum(["inbound", "outbound"]),
  versionNumber: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string(),
  rows: z.array(MatrixRowSchema),
});
