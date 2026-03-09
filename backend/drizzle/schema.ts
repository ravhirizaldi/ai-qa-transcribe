import {
  boolean,
  foreignKey,
  index,
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
export const ceScoringPolicyEnum = pgEnum("ce_scoring_policy", [
  "strict_zero_all_ce_if_any_fail",
  "weighted_ce_independent",
]);

export const statusEnum = pgEnum("job_status", [
  "queued",
  "uploading",
  "transcribing",
  "analyzing",
  "completed",
  "failed",
]);
export const jobScoreEditChangeSourceEnum = pgEnum("job_score_edit_change_source", [
  "manual",
  "ce_strict_auto",
]);
export const ragDocSyncStatusEnum = pgEnum("rag_doc_sync_status", [
  "pending",
  "synced",
  "failed",
  "deleted",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  fullname: text("fullname").default("User").notNull(),
  passwordHash: text("password_hash").notNull(),
  isRestricted: boolean("is_restricted").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const accessRoles = pgTable("access_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  permissionsJson: jsonb("permissions_json").$type<unknown[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userRoleAssignments = pgTable(
  "user_role_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    roleId: uuid("role_id").notNull().references(() => accessRoles.id),
    scopeJson: jsonb("scope_json").$type<unknown>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.roleId)],
);

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
    logoUrl: text("logo_url"),
    supportsInbound: boolean("supports_inbound").default(true).notNull(),
    supportsOutbound: boolean("supports_outbound").default(false).notNull(),
    xaiCollectionId: text("xai_collection_id"),
    ceScoringPolicy: ceScoringPolicyEnum("ce_scoring_policy")
      .default("strict_zero_all_ce_if_any_fail")
      .notNull(),
    batchHistoryLockDays: integer("batch_history_lock_days").default(2).notNull(),
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
  xaiManagementApiKey: text("xai_management_api_key"),
  xaiRagModel: text("xai_rag_model"),
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
    index("project_matrix_versions_project_call_active_idx").on(
      t.projectId,
      t.callType,
      t.isActive,
    ),
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
    name: text("name"),
    callType: callTypeEnum("call_type").notNull(),
    status: statusEnum("status").default("queued").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique().on(t.id, t.tenantId, t.projectId),
    index("batches_project_created_idx").on(t.projectId, t.createdAt),
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
    index("jobs_batch_status_idx").on(t.batchId, t.status),
    index("jobs_batch_created_idx").on(t.batchId, t.createdAt),
    index("jobs_project_created_idx").on(t.projectId, t.createdAt),
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

export const jobSegments = pgTable(
  "job_segments",
  {
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
  },
  (t) => [index("job_segments_job_segment_idx").on(t.jobId, t.segmentIndex)],
);

export const jobAnalyses = pgTable("job_analyses", {
  jobId: uuid("job_id").primaryKey().references(() => jobs.id),
  summary: text("summary").notNull(),
  routing: text("routing").notNull(),
  redFlags: text("red_flags"),
  totalScore: integer("total_score").notNull(),
  rawJson: jsonb("raw_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobEvaluationRows = pgTable(
  "job_evaluation_rows",
  {
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
  },
  (t) => [index("job_evaluation_rows_job_row_idx").on(t.jobId, t.rowIndex)],
);

export const jobScoreEditHistory = pgTable(
  "job_score_edit_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id").notNull().references(() => jobs.id),
    jobEvaluationRowId: uuid("job_evaluation_row_id")
      .notNull()
      .references(() => jobEvaluationRows.id),
    rowIndex: integer("row_index").notNull(),
    area: text("area").notNull(),
    parameter: text("parameter").notNull(),
    oldScore: integer("old_score").notNull(),
    newScore: integer("new_score").notNull(),
    maxScore: integer("max_score").notNull(),
    reasonNote: text("reason_note").notNull(),
    changeSource: jobScoreEditChangeSourceEnum("change_source").notNull(),
    editedBy: uuid("edited_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("job_score_edit_history_job_created_idx").on(t.jobId, t.createdAt)],
);

export const projectRagDocuments = pgTable(
  "project_rag_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    projectId: uuid("project_id").notNull(),
    jobId: uuid("job_id").notNull(),
    jobScoreEditHistoryId: uuid("job_score_edit_history_id").notNull().unique(),
    jobEvaluationRowId: uuid("job_evaluation_row_id").notNull(),
    rowIndex: integer("row_index").notNull(),
    area: text("area").notNull(),
    parameter: text("parameter").notNull(),
    oldScore: integer("old_score").notNull(),
    newScore: integer("new_score").notNull(),
    maxScore: integer("max_score").notNull(),
    reasonNote: text("reason_note").notNull(),
    fileName: text("file_name").notNull(),
    docSha256: text("doc_sha256").notNull(),
    xaiCollectionId: text("xai_collection_id"),
    xaiFileId: text("xai_file_id"),
    syncStatus: ragDocSyncStatusEnum("sync_status").default("pending").notNull(),
    syncAttempts: integer("sync_attempts").default(0).notNull(),
    lastError: text("last_error"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("project_rag_documents_project_status_created_idx").on(
      t.projectId,
      t.syncStatus,
      t.createdAt,
    ),
    index("project_rag_documents_job_created_idx").on(t.jobId, t.createdAt),
  ],
);
