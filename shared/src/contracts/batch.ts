import { z } from "zod";
import { CallTypeSchema, JobStatusSchema } from "./job.js";

export const CreateBatchResponseSchema = z.object({
  batchId: z.string().uuid(),
  jobIds: z.array(z.string().uuid()),
});

export type CreateBatchResponse = z.infer<typeof CreateBatchResponseSchema>;

export const BatchSummarySchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  callType: CallTypeSchema,
  status: JobStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  jobs: z.array(
    z.object({
      id: z.string().uuid(),
      status: JobStatusSchema,
      fileName: z.string(),
      progress: z.number().int().min(0).max(100),
      errorMessage: z.string().nullable(),
    }),
  ),
});

export type BatchSummary = z.infer<typeof BatchSummarySchema>;

export const JobDetailSchema = z.object({
  id: z.string().uuid(),
  batchId: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  matrixVersionId: z.string().uuid(),
  callType: CallTypeSchema,
  status: JobStatusSchema,
  fileName: z.string(),
  transcript: z.string().nullable(),
  segments: z.array(z.any()),
  analysis: z.any().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  errorMessage: z.string().nullable(),
});

export type JobDetail = z.infer<typeof JobDetailSchema>;
