import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  jobEvaluationRows,
  jobs,
  jobScoreEditHistory,
  jobSegments,
  projectRagDocuments,
  projects,
} from "../schema.js";
import { logProviderError, logProviderEvent } from "./providerLogs.js";

const XAI_MANAGEMENT_BASE_URL = "https://management-api.x.ai/v1";
const DOC_SOURCE = "manual_score_edit";

const timestampToSeconds = (raw: string): { start: number; end: number } | null => {
  const value = String(raw || "").trim();
  if (!value || value === "N/A") return null;
  const parts = value.split("-").map((part) => part.trim());
  if (parts.length !== 2) return null;

  const parseClock = (clock: string) => {
    const chunks = clock.split(":").map((v) => Number(v));
    if (chunks.some((chunk) => !Number.isFinite(chunk))) return null;
    if (chunks.length === 2) {
      return chunks[0] * 60 + chunks[1];
    }
    if (chunks.length === 3) {
      return chunks[0] * 3600 + chunks[1] * 60 + chunks[2];
    }
    return null;
  };

  const start = parseClock(parts[0]);
  const end = parseClock(parts[1]);
  if (start == null || end == null) return null;
  return { start, end };
};

const buildEvidenceExcerpt = (
  segments: Array<{ startSec: number; endSec: number; speakerId: string; cleanedText: string | null; rawText: string }>,
  evidenceTimestamp: string,
) => {
  const range = timestampToSeconds(evidenceTimestamp);
  const target = range
    ? segments.filter((segment) => segment.endSec >= range.start && segment.startSec <= range.end)
    : [];
  const source = target.length ? target : segments.slice(0, 4);
  const excerpt = source
    .slice(0, 6)
    .map((segment) => `${segment.speakerId}: ${segment.cleanedText || segment.rawText}`)
    .join("\n")
    .trim();
  if (!excerpt) return "N/A";
  return excerpt.slice(0, 2000);
};

const buildCorrectionDoc = (input: {
  tenantId: string;
  projectId: string;
  jobId: string;
  callType: "inbound" | "outbound";
  rowIndex: number;
  area: string;
  parameter: string;
  oldScore: number;
  newScore: number;
  maxScore: number;
  reasonNote: string;
  evidenceTimestamp: string;
  evidenceExcerpt: string;
  editedAt: Date;
  scoreEditHistoryId: string;
}) => {
  const fileName = `qa-correction_${input.projectId}_${input.scoreEditHistoryId}.md`;
  const markdown = `---
schema_version: 1
tenant_id: ${input.tenantId}
project_id: ${input.projectId}
job_id: ${input.jobId}
call_type: ${input.callType}
matrix_row_index: ${input.rowIndex}
area: "${input.area.replace(/"/g, "'")}"
parameter: "${input.parameter.replace(/"/g, "'")}"
old_score: ${input.oldScore}
new_score: ${input.newScore}
max_score: ${input.maxScore}
edited_at: "${input.editedAt.toISOString()}"
source: "${DOC_SOURCE}"
---

## Correction Reason
${input.reasonNote}

## Evidence Timestamp
${input.evidenceTimestamp}

## Evidence Excerpt
${input.evidenceExcerpt}

## Expected Judgment Pattern
${input.newScore < input.maxScore ? "Fail this row when the same issue appears." : "Pass this row when the same criteria are fully met."}
`;

  const docSha256 = createHash("sha256").update(markdown).digest("hex");
  return { fileName, markdown, docSha256 };
};

const extractCollectionId = (payload: any): string | null => {
  const value =
    payload?.collection_id ||
    payload?.collectionId ||
    payload?.id ||
    payload?.collection?.collection_id ||
    payload?.collection?.id;
  if (!value) return null;
  return String(value);
};

const extractFileId = (payload: any): string | null => {
  const value =
    payload?.file_metadata?.file_id ||
    payload?.file_id ||
    payload?.fileId ||
    payload?.id ||
    payload?.document?.file_metadata?.file_id;
  if (!value) return null;
  return String(value);
};

const ensureProjectCollection = async (
  projectId: string,
  projectName: string,
  managementApiKey: string,
) => {
  const existing = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { xaiCollectionId: true },
  });
  const existingId = String(existing?.xaiCollectionId || "").trim();
  if (existingId) return existingId;

  const response = await fetch(`${XAI_MANAGEMENT_BASE_URL}/collections`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${managementApiKey}`,
    },
    body: JSON.stringify({
      collection_name: `qa-${projectName}-${projectId}`.slice(0, 120),
      field_definitions: [
        { key: "project_id", required: true },
        { key: "tenant_id", required: true },
        { key: "call_type", required: true },
        { key: "parameter", required: true, inject_into_chunk: true },
        { key: "matrix_row_index", required: true, inject_into_chunk: true },
        { key: "source", required: true },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create xAI collection: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const collectionId = extractCollectionId(payload);
  if (!collectionId) {
    throw new Error("xAI collection create succeeded but no collection id was returned");
  }

  await db
    .update(projects)
    .set({ xaiCollectionId: collectionId, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  return collectionId;
};

const upsertRagState = async (input: {
  tenantId: string;
  projectId: string;
  jobId: string;
  jobScoreEditHistoryId: string;
  jobEvaluationRowId: string;
  rowIndex: number;
  area: string;
  parameter: string;
  oldScore: number;
  newScore: number;
  maxScore: number;
  reasonNote: string;
  fileName: string;
  docSha256: string;
  syncStatus: "pending" | "synced" | "failed" | "deleted";
  xaiCollectionId?: string | null;
  xaiFileId?: string | null;
  uploadedAt?: Date | null;
  deletedAt?: Date | null;
  lastError?: string | null;
}) => {
  await db
    .insert(projectRagDocuments)
    .values({
      tenantId: input.tenantId,
      projectId: input.projectId,
      jobId: input.jobId,
      jobScoreEditHistoryId: input.jobScoreEditHistoryId,
      jobEvaluationRowId: input.jobEvaluationRowId,
      rowIndex: input.rowIndex,
      area: input.area,
      parameter: input.parameter,
      oldScore: input.oldScore,
      newScore: input.newScore,
      maxScore: input.maxScore,
      reasonNote: input.reasonNote,
      fileName: input.fileName,
      docSha256: input.docSha256,
      xaiCollectionId: input.xaiCollectionId ?? null,
      xaiFileId: input.xaiFileId ?? null,
      syncStatus: input.syncStatus,
      syncAttempts: 1,
      lastError: input.lastError ?? null,
      uploadedAt: input.uploadedAt ?? null,
      deletedAt: input.deletedAt ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: projectRagDocuments.jobScoreEditHistoryId,
      set: {
        area: input.area,
        parameter: input.parameter,
        oldScore: input.oldScore,
        newScore: input.newScore,
        maxScore: input.maxScore,
        reasonNote: input.reasonNote,
        fileName: input.fileName,
        docSha256: input.docSha256,
        xaiCollectionId: input.xaiCollectionId ?? null,
        xaiFileId: input.xaiFileId ?? null,
        syncStatus: input.syncStatus,
        syncAttempts: sql`${projectRagDocuments.syncAttempts} + 1`,
        lastError: input.lastError ?? null,
        uploadedAt: input.uploadedAt ?? null,
        deletedAt: input.deletedAt ?? null,
        updatedAt: new Date(),
      },
    });
};

export const syncManualScoreEditToRag = async (input: {
  scoreEditHistoryId: string;
  managementApiKey: string;
}) => {
  const startedAt = Date.now();
  const history = await db.query.jobScoreEditHistory.findFirst({
    where: eq(jobScoreEditHistory.id, input.scoreEditHistoryId),
  });
  if (!history || history.changeSource !== "manual") {
    return;
  }

  const [job, evalRow] = await Promise.all([
    db.query.jobs.findFirst({ where: eq(jobs.id, history.jobId) }),
    db.query.jobEvaluationRows.findFirst({
      where: eq(jobEvaluationRows.id, history.jobEvaluationRowId),
    }),
  ]);

  if (!job) {
    throw new Error(`Job ${history.jobId} not found for score edit ${history.id}`);
  }

  const projectRow = await db.query.projects.findFirst({
    where: eq(projects.id, job.projectId),
    columns: {
      id: true,
      tenantId: true,
      name: true,
      xaiCollectionId: true,
    },
  });
  if (!projectRow) {
    throw new Error(`Project ${job.projectId} not found for score edit ${history.id}`);
  }

  const segments = await db.query.jobSegments.findMany({
    where: eq(jobSegments.jobId, job.id),
    orderBy: (t, { asc }) => [asc(t.segmentIndex)],
    columns: {
      startSec: true,
      endSec: true,
      speakerId: true,
      cleanedText: true,
      rawText: true,
    },
  });

  const evidenceTimestamp = String(evalRow?.evidenceTimestamp || "N/A");
  const evidenceExcerpt = buildEvidenceExcerpt(segments, evidenceTimestamp);
  const { fileName, markdown, docSha256 } = buildCorrectionDoc({
    tenantId: projectRow.tenantId,
    projectId: projectRow.id,
    jobId: job.id,
    callType: job.callType,
    rowIndex: history.rowIndex,
    area: history.area,
    parameter: history.parameter,
    oldScore: history.oldScore,
    newScore: history.newScore,
    maxScore: history.maxScore,
    reasonNote: history.reasonNote,
    evidenceTimestamp,
    evidenceExcerpt,
    editedAt: history.createdAt,
    scoreEditHistoryId: history.id,
  });

  const baseUpsert = {
    tenantId: projectRow.tenantId,
    projectId: projectRow.id,
    jobId: job.id,
    jobScoreEditHistoryId: history.id,
    jobEvaluationRowId: history.jobEvaluationRowId,
    rowIndex: history.rowIndex,
    area: history.area,
    parameter: history.parameter,
    oldScore: history.oldScore,
    newScore: history.newScore,
    maxScore: history.maxScore,
    reasonNote: history.reasonNote,
    fileName,
    docSha256,
  };

  logProviderEvent("info", "rag.sync.request", {
    scoreEditHistoryId: history.id,
    jobId: job.id,
    projectId: projectRow.id,
  });

  await upsertRagState({
    ...baseUpsert,
    syncStatus: "pending",
    xaiCollectionId: projectRow.xaiCollectionId,
    xaiFileId: null,
    uploadedAt: null,
    deletedAt: null,
    lastError: null,
  });

  try {
    if (!input.managementApiKey) {
      throw new Error("Missing xAI management API key");
    }

    const collectionId = await ensureProjectCollection(
      projectRow.id,
      projectRow.name,
      input.managementApiKey,
    );

    const form = new FormData();
    form.append("name", fileName);
    form.append("data", new Blob([markdown], { type: "text/markdown" }), fileName);
    form.append("content_type", "text/markdown");
    form.append(
      "fields",
      JSON.stringify({
        project_id: projectRow.id,
        tenant_id: projectRow.tenantId,
        call_type: job.callType,
        parameter: history.parameter,
        matrix_row_index: String(history.rowIndex),
        source: DOC_SOURCE,
      }),
    );

    const response = await fetch(
      `${XAI_MANAGEMENT_BASE_URL}/collections/${encodeURIComponent(collectionId)}/documents`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.managementApiKey}`,
        },
        body: form,
      },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Failed to upload RAG doc: ${response.status} ${body}`);
    }

    const payload = await response.json();
    const xaiFileId = extractFileId(payload);

    await upsertRagState({
      ...baseUpsert,
      syncStatus: "synced",
      xaiCollectionId: collectionId,
      xaiFileId,
      uploadedAt: new Date(),
      deletedAt: null,
      lastError: null,
    });

    logProviderEvent("info", "rag.sync.success", {
      scoreEditHistoryId: history.id,
      jobId: job.id,
      projectId: projectRow.id,
      collectionId,
      xaiFileId,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RAG sync failed";
    await upsertRagState({
      ...baseUpsert,
      syncStatus: "failed",
      xaiCollectionId: projectRow.xaiCollectionId,
      xaiFileId: null,
      uploadedAt: null,
      deletedAt: null,
      lastError: message.slice(0, 2000),
    });
    logProviderError(
      "rag.sync.failed",
      {
        scoreEditHistoryId: history.id,
        jobId: job.id,
        projectId: projectRow.id,
        durationMs: Date.now() - startedAt,
      },
      error,
    );
    throw error;
  }
};
