import {
  boolean,
  foreignKey,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const tenantRoleEnum = pgEnum("tenant_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

export const callTypeEnum = pgEnum("call_type", ["inbound", "outbound"]);

export const statusEnum = pgEnum("job_status", [
  "queued",
  "uploading",
  "transcribing",
  "analyzing",
  "completed",
  "failed",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isRestricted: boolean("is_restricted").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tenants = pgTable("tenants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: tenantRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.tenantId, t.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    supportsInbound: boolean("supports_inbound").default(true).notNull(),
    supportsOutbound: boolean("supports_outbound").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.tenantId, t.slug), unique().on(t.id, t.tenantId)],
);

export const projectMemberships = pgTable(
  "project_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.projectId, t.userId)],
);

export const globalProviderSettings = pgTable("global_provider_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  elevenlabsApiKey: text("elevenlabs_api_key"),
  xaiApiKey: text("xai_api_key"),
  xaiModel: text("xai_model"),
  updatedBy: uuid("updated_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const projectMatrixVersions = pgTable(
  "project_matrix_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    callType: callTypeEnum("call_type").notNull(),
    versionNumber: integer("version_number").notNull(),
    isActive: boolean("is_active").default(false).notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique().on(t.projectId, t.callType, t.versionNumber),
    unique().on(t.id, t.projectId),
  ],
);

export const projectMatrixRows = pgTable(
  "project_matrix_rows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matrixVersionId: uuid("matrix_version_id")
      .notNull()
      .references(() => projectMatrixVersions.id),
    rowIndex: integer("row_index").notNull(),
    area: text("area").notNull(),
    parameter: text("parameter").notNull(),
    description: text("description").notNull(),
    weight: integer("weight").notNull(),
  },
  (t) => [unique().on(t.matrixVersionId, t.rowIndex)],
);

export const batches = pgTable(
  "batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    callType: callTypeEnum("call_type").notNull(),
    status: statusEnum("status").default("queued").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique().on(t.id, t.tenantId, t.projectId),
    foreignKey({
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: "batches_project_tenant_fk",
    }),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id").notNull().references(() => batches.id),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    matrixVersionId: uuid("matrix_version_id")
      .notNull()
      .references(() => projectMatrixVersions.id),
    fileName: text("file_name").notNull(),
    filePath: text("file_path").notNull(),
    callType: callTypeEnum("call_type").notNull(),
    status: statusEnum("status").default("queued").notNull(),
    progress: integer("progress").default(0).notNull(),
    attempt: integer("attempt").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
      name: "jobs_project_tenant_fk",
    }),
    foreignKey({
      columns: [t.batchId, t.tenantId, t.projectId],
      foreignColumns: [batches.id, batches.tenantId, batches.projectId],
      name: "jobs_batch_tenant_project_fk",
    }),
    foreignKey({
      columns: [t.matrixVersionId, t.projectId],
      foreignColumns: [projectMatrixVersions.id, projectMatrixVersions.projectId],
      name: "jobs_matrix_version_project_fk",
    }),
  ],
);

export const jobTranscripts = pgTable("job_transcripts", {
  jobId: uuid("job_id").primaryKey().references(() => jobs.id),
  fullText: text("full_text").notNull(),
  provider: text("provider").notNull(),
  language: text("language").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobSegments = pgTable("job_segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),
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
  jobId: uuid("job_id").primaryKey().references(() => jobs.id),
  summary: text("summary").notNull(),
  routing: text("routing").notNull(),
  redFlags: text("red_flags"),
  totalScore: integer("total_score").notNull(),
  rawJson: jsonb("raw_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobEvaluationRows = pgTable("job_evaluation_rows", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => jobs.id),
  rowIndex: integer("row_index").notNull(),
  area: text("area").notNull(),
  parameter: text("parameter").notNull(),
  description: text("description").notNull(),
  evidenceTimestamp: text("evidence_timestamp").notNull(),
  note: text("note").notNull(),
  score: integer("score").notNull(),
  maxScore: integer("max_score").notNull(),
});
