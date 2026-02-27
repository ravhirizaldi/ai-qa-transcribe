import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const callTypeEnum = pgEnum("call_type", ["inbound", "outbound"]);
export const statusEnum = pgEnum("job_status", [
  "queued",
  "uploading",
  "transcribing",
  "analyzing",
  "completed",
  "failed",
]);

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  batchId: uuid("batch_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  projectId: uuid("project_id").notNull(),
  userId: uuid("user_id").notNull(),
  matrixVersionId: uuid("matrix_version_id").notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  callType: callTypeEnum("call_type").notNull(),
  status: statusEnum("status").notNull(),
  progress: integer("progress").notNull(),
  attempt: integer("attempt").notNull(),
  maxAttempts: integer("max_attempts").notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const globalProviderSettings = pgTable("global_provider_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  elevenlabsApiKey: text("elevenlabs_api_key"),
  xaiApiKey: text("xai_api_key"),
  xaiModel: text("xai_model"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const batches = pgTable("batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: statusEnum("status").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export const projectMatrixRows = pgTable("project_matrix_rows", {
  id: uuid("id").defaultRandom().primaryKey(),
  matrixVersionId: uuid("matrix_version_id").notNull(),
  rowIndex: integer("row_index").notNull(),
  area: text("area").notNull(),
  parameter: text("parameter").notNull(),
  description: text("description").notNull(),
  weight: integer("weight").notNull(),
});

export const jobTranscripts = pgTable("job_transcripts", {
  jobId: uuid("job_id").primaryKey(),
  fullText: text("full_text").notNull(),
  provider: text("provider").notNull(),
  language: text("language").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobSegments = pgTable("job_segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull(),
  segmentIndex: integer("segment_index").notNull(),
  speakerId: text("speaker_id").notNull(),
  role: text("role"),
  startSec: real("start_sec").notNull(),
  endSec: real("end_sec").notNull(),
  rawText: text("raw_text").notNull(),
  cleanedText: text("cleaned_text"),
  sentiment: text("sentiment"),
  wordsJson: jsonb("words_json").$type<unknown[]>().notNull().default([]),
});

export const jobAnalyses = pgTable("job_analyses", {
  jobId: uuid("job_id").primaryKey(),
  summary: text("summary").notNull(),
  routing: text("routing").notNull(),
  redFlags: text("red_flags"),
  totalScore: integer("total_score").notNull(),
  rawJson: jsonb("raw_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobEvaluationRows = pgTable("job_evaluation_rows", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull(),
  rowIndex: integer("row_index").notNull(),
  area: text("area").notNull(),
  parameter: text("parameter").notNull(),
  description: text("description").notNull(),
  evidenceTimestamp: text("evidence_timestamp").notNull(),
  note: text("note").notNull(),
  score: integer("score").notNull(),
  maxScore: integer("max_score").notNull(),
});
