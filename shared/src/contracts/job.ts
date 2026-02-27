import { z } from "zod";

export const CallTypeSchema = z.enum(["inbound", "outbound"]);
export type CallType = z.infer<typeof CallTypeSchema>;

export const JobStatusSchema = z.enum([
  "queued",
  "uploading",
  "transcribing",
  "analyzing",
  "completed",
  "failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const RoleSchema = z.enum(["CS", "Customer"]);
export type SegmentRole = z.infer<typeof RoleSchema>;

export const SentimentSchema = z.enum(["positive", "neutral", "negative"]);
export type SegmentSentiment = z.infer<typeof SentimentSchema>;

export const JobStatusEventSchema = z.object({
  event: z.literal("job.status.changed"),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  batchId: z.string().uuid(),
  jobId: z.string().uuid(),
  status: JobStatusSchema,
  progress: z.number().min(0).max(100),
  updatedAt: z.string(),
});

export const JobFailedEventSchema = z.object({
  event: z.literal("job.failed"),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  batchId: z.string().uuid(),
  jobId: z.string().uuid(),
  message: z.string(),
  updatedAt: z.string(),
});

export const JobCompletedEventSchema = z.object({
  event: z.literal("job.completed"),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  batchId: z.string().uuid(),
  jobId: z.string().uuid(),
  totalScore: z.number(),
  updatedAt: z.string(),
});

export const BatchProgressEventSchema = z.object({
  event: z.literal("batch.progress"),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  batchId: z.string().uuid(),
  total: z.number().int().min(0),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  running: z.number().int().min(0),
  updatedAt: z.string(),
});

export const WsEventSchema = z.discriminatedUnion("event", [
  JobStatusEventSchema,
  JobFailedEventSchema,
  JobCompletedEventSchema,
  BatchProgressEventSchema,
]);

export type WsEvent = z.infer<typeof WsEventSchema>;
