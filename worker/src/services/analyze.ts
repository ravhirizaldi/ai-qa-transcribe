import { createXai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";

const RoleEnum = z.enum(["CS", "Customer"]);
const SentimentEnum = z.enum(["positive", "neutral", "negative"]);

const CleanedSegmentSchema = z.object({
  id: z.number().int(),
  role: RoleEnum,
  cleaned_text: z.string(),
  sentiment: SentimentEnum,
});

const EvaluationItemSchema = z.object({
  area: z.string(),
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
) => {
  const xai = createXai({ apiKey: xaiApiKey });

  const transcriptText = segments
    .map(
      (s) =>
        `[${s.id}] ${secToClock(s.start)} - ${secToClock(s.end)} ${s.speakerId}: ${s.text}`,
    )
    .join("\n");

  const criteriaList = matrixRows
    .map((m) => `- **${m.area}** (Max Weight: ${m.weight}, Type: ${m.parameter}): ${m.description}`)
    .join("\n");

  const { object } = await generateObject({
    model: xai(model),
    schema: ConversationAnalysisSchema,
    system: `
You are a QA analyst for Indonesian customer service calls (${callType} type).
Output concise Bahasa Indonesia. Be factual, no repetition.

Evaluation Matrix Criteria (with Max Weights):
${criteriaList}

Rules:
- transcript_cleanup: role must be CS or Customer, keep meaning, remove fillers, keep each cleaned_text short.
- qa_scorecard.evaluation_table: evaluate EACH area from the matrix above based on the criteria.
  - "score": Assign strictly 0 OR Max Weight.
  - If an area is not applicable, note "N/A" and give full score.
  - Use the exact area name.
- qa_scorecard.evidence_timestamp: copy exact "MM:SS - MM:SS" from transcript lines.
- Keep notes short and evidence-based.
`,
    prompt: `Analyze transcript lines in this format: [id] start - end speaker: text\n\n${transcriptText}`,
  });

  const byArea = new Map(matrixRows.map((row) => [row.area.trim().toLowerCase(), row]));

  const table = object.qa_scorecard.evaluation_table.map((row) => {
    const hit = byArea.get(row.area.trim().toLowerCase());
    return {
      ...row,
      parameter: hit?.parameter || "Unknown",
      description: hit?.description || "",
      max_score: hit?.weight || 0,
    };
  });

  return {
    transcript_cleanup: object.transcript_cleanup,
    qa_scorecard: {
      ...object.qa_scorecard,
      evaluation_table: table,
    },
  };
};
