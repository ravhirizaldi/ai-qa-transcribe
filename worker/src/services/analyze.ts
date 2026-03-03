import { createXai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";
import { logProviderError, logProviderEvent } from "./providerLogs.js";

const RoleEnum = z.enum(["CS", "Customer"]);

const CleanedSegmentSchema = z.object({
  id: z.number().int(),
  role: RoleEnum,
  cleaned_text: z.string(),
});

const EvaluationItemSchema = z.object({
  row_index: z.number().int(),
  evidence_timestamp: z.string(),
  note: z.string(),
  score: z.number(),
});

const ConversationAnalysisSchema = z.object({
  transcript_cleanup: z.array(CleanedSegmentSchema),
  qa_scorecard: z.object({
    summary: z.string(),
    evaluation_table: z.array(EvaluationItemSchema),
    red_flags: z.string().nullable(),
    routing: z.string(),
  }),
});

const secToClock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${ss
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
};

export type MatrixRow = {
  area: string;
  parameter: string;
  description: string;
  weight: number;
};

const EVIDENCE_TIMESTAMP_PATTERN =
  /^\d{2}:\d{2}(?::\d{2})?\s*-\s*\d{2}:\d{2}(?::\d{2})?$/;

const normalizeEvidenceTimestamp = (raw: string): string => {
  const value = String(raw || "").trim();
  if (!value) return "N/A";
  if (!EVIDENCE_TIMESTAMP_PATTERN.test(value)) return "N/A";
  const parts = value.split("-").map((part) => part.trim());
  if (parts.length !== 2) return "N/A";
  return `${parts[0]} - ${parts[1]}`;
};

export const analyzeConversation = async (
  segments: Array<{
    id: number;
    speakerId: string;
    text: string;
    start: number;
    end: number;
  }>,
  callType: "inbound" | "outbound",
  matrixRows: MatrixRow[],
  xaiApiKey: string,
  model: string,
  context?: { jobId?: string; batchId?: string },
) => {
  const startedAt = Date.now();
  logProviderEvent("info", "xai.analyze.request", {
    provider: "xai",
    endpoint: "ai.generateObject",
    model,
    callType,
    transcriptSegments: segments.length,
    matrixRows: matrixRows.length,
    jobId: context?.jobId,
    batchId: context?.batchId,
  });

  const xai = createXai({ apiKey: xaiApiKey });

  const transcriptText = segments
    .map(
      (s) =>
        `[${s.id}] ${secToClock(s.start)} - ${secToClock(s.end)} ${s.speakerId}: ${s.text}`,
    )
    .join("\n");

  const criteriaList = matrixRows
    .map(
      (m, idx) =>
        `- [${idx}] area="${m.area}" type="${m.parameter}" max_weight=${m.weight} criteria="${m.description}"`,
    )
    .join("\n");

  let object: z.infer<typeof ConversationAnalysisSchema>;

  try {
    const result = await generateObject({
      model: xai(model),
      schema: ConversationAnalysisSchema,
      system: `
You are a QA analyst for Indonesian customer service calls (${callType} type).
Output concise Bahasa Indonesia. Be factual, no repetition.

Evaluation Matrix Criteria (with Max Weights):
${criteriaList}

Rules:
- transcript_cleanup: role must be CS or Customer, keep meaning, remove fillers, keep each cleaned_text short.
- qa_scorecard.evaluation_table: return compact rows ONLY with row_index, score, note, evidence_timestamp.
  - Evaluate each matrix row index from the list above.
  - Do not repeat area/parameter/description in output.
  - score must be strictly 0 OR max_weight for that row.
  - If not applicable, use note "N/A" and give full score.
- evidence_timestamp: copy exact "MM:SS - MM:SS" from transcript lines, otherwise "N/A".
- Keep summary and notes short, factual, and evidence-based.
`,
      prompt: `Analyze transcript lines in this format: [id] start - end speaker: text\n\n${transcriptText}`,
    });
    object = result.object;
  } catch (error) {
    logProviderError(
      "xai.analyze.failed",
      {
        provider: "xai",
        endpoint: "ai.generateObject",
        model,
        callType,
        transcriptSegments: segments.length,
        matrixRows: matrixRows.length,
        jobId: context?.jobId,
        batchId: context?.batchId,
        durationMs: Date.now() - startedAt,
      },
      error,
    );
    throw error;
  }

  let invalidRowIndexCount = 0;
  let duplicateRowCount = 0;
  let scoreNormalizedCount = 0;
  let timestampNormalizedCount = 0;

  const seen = new Set<number>();
  const normalizedByIndex = new Map<
    number,
    {
      area: string;
      parameter: string;
      description: string;
      evidence_timestamp: string;
      note: string;
      score: number;
      max_score: number;
    }
  >();

  for (const row of object.qa_scorecard.evaluation_table) {
    const rowIndex = Number(row.row_index);
    if (
      !Number.isInteger(rowIndex) ||
      rowIndex < 0 ||
      rowIndex >= matrixRows.length
    ) {
      invalidRowIndexCount += 1;
      continue;
    }
    if (seen.has(rowIndex)) {
      duplicateRowCount += 1;
      continue;
    }
    seen.add(rowIndex);

    const matrix = matrixRows[rowIndex];
    const maxScore = Number(matrix.weight || 0);
    const rawScore = Number(row.score);
    const normalizedScore =
      Number.isFinite(rawScore) && rawScore >= maxScore ? maxScore : 0;
    if (!Number.isFinite(rawScore) || normalizedScore !== rawScore) {
      scoreNormalizedCount += 1;
    }

    const normalizedTimestamp = normalizeEvidenceTimestamp(
      row.evidence_timestamp,
    );
    if (normalizedTimestamp !== String(row.evidence_timestamp || "").trim()) {
      timestampNormalizedCount += 1;
    }

    normalizedByIndex.set(rowIndex, {
      area: matrix.area,
      parameter: matrix.parameter,
      description: matrix.description,
      evidence_timestamp: normalizedTimestamp,
      note: String(row.note || "").trim() || "N/A",
      score: normalizedScore,
      max_score: maxScore,
    });
  }

  const missingIndexes: number[] = [];
  const table = matrixRows.map((matrix, idx) => {
    const existing = normalizedByIndex.get(idx);
    if (existing) return existing;

    missingIndexes.push(idx);
    return {
      area: matrix.area,
      parameter: matrix.parameter,
      description: matrix.description,
      evidence_timestamp: "N/A",
      note: "N/A",
      score: Number(matrix.weight || 0),
      max_score: Number(matrix.weight || 0),
    };
  });

  logProviderEvent("info", "xai.analyze.normalized", {
    provider: "xai",
    endpoint: "ai.generateObject",
    model,
    callType,
    transcriptSegments: segments.length,
    matrixRows: matrixRows.length,
    invalid_row_index_count: invalidRowIndexCount,
    duplicate_row_count: duplicateRowCount,
    missing_row_count: missingIndexes.length,
    score_normalized_count: scoreNormalizedCount,
    timestamp_normalized_count: timestampNormalizedCount,
    missing_row_indexes: missingIndexes.slice(0, 20),
    jobId: context?.jobId,
    batchId: context?.batchId,
  });

  logProviderEvent("info", "xai.analyze.success", {
    provider: "xai",
    endpoint: "ai.generateObject",
    model,
    callType,
    transcriptSegments: segments.length,
    matrixRows: matrixRows.length,
    evaluationRows: table.length,
    jobId: context?.jobId,
    batchId: context?.batchId,
    durationMs: Date.now() - startedAt,
  });

  return {
    transcript_cleanup: object.transcript_cleanup,
    qa_scorecard: {
      ...object.qa_scorecard,
      evaluation_table: table,
    },
  };
};
