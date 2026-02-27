import { createXai } from "@ai-sdk/xai";
import { generateObject } from "ai";
import { z } from "zod";
import inboundMatrix from "../data/inbound.json";
import outboundMatrix from "../data/outbound.json";

const API_KEY = import.meta.env.VITE_XAI_API_KEY;
const MODEL = import.meta.env.VITE_XAI_MODEL || "grok-4";

// Initialize xAI client
const xai = createXai({
  apiKey: API_KEY,
});

// Zod Schemas
const RoleEnum = z.enum(["CS", "Customer"]);
const SentimentEnum = z.enum(["positive", "neutral", "negative"]);

const CleanedSegmentSchema = z.object({
  id: z.number().int().describe("Original segment ID"),
  role: RoleEnum.describe("Speaker role: CS or Customer"),
  cleaned_text: z
    .string()
    .describe("Cleaned, professional text in Bahasa Indonesia"),
  sentiment: SentimentEnum.describe("Sentiment of the segment"),
});

const EvaluationItemSchema = z.object({
  area: z.string().describe("The evaluation area from the matrix"),
  evidence_timestamp: z
    .string()
    .describe('Timestamp range of evidence, e.g., "[00:04-00:07]"'),
  note: z.string().describe("Qualitative assessment in Bahasa Indonesia"),
  score: z.number().describe("Score awarded for this area (0 to max weight)"),
  // Optional fields that we might use but don't ask AI to generate strictly
  max_score: z.number().optional(),
  parameter: z.string().optional(),
});

const QAScorecardSchema = z.object({
  summary: z
    .string()
    .describe(
      "Concise summary of the problem and resolution in Bahasa Indonesia",
    ),
  evaluation_table: z.array(EvaluationItemSchema),
  red_flags: z.string().nullable().describe("Critical errors or null if none"),
  routing: z.string().describe("Routing verification (Correct/Incorrect)"),
});

const ConversationAnalysisSchema = z.object({
  transcript_cleanup: z.array(CleanedSegmentSchema),
  qa_scorecard: QAScorecardSchema,
});

// Types inferred from Zod + Manual Extension for UI
type BaseAnalysis = z.infer<typeof ConversationAnalysisSchema>;

// We extend the type manually to include 'description' which is NOT in the Zod schema
// to save output tokens, but is needed for the UI.
type ExtendedEvaluationItem =
  BaseAnalysis["qa_scorecard"]["evaluation_table"][number] & {
    description?: string;
  };

export type ConversationAnalysis = Omit<BaseAnalysis, "qa_scorecard"> & {
  qa_scorecard: Omit<BaseAnalysis["qa_scorecard"], "evaluation_table"> & {
    evaluation_table: ExtendedEvaluationItem[];
  };
};

export type ConversationSegment = {
  id: number;
  speakerId: string;
  text: string;
  start: number;
  end: number;
};
export type CallType = "inbound" | "outbound";

type CacheEntry = {
  createdAt: number;
  result: ConversationAnalysis;
};

const CACHE_PREFIX = "qa_analysis_cache_v10";
const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours
const memoryCache = new Map<string, CacheEntry>();

// Helper function to format seconds to MM:SS
const secToClock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) {
    return `${h.toString().padStart(2, "0")}:${m
      .toString()
      .padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
};

const buildSegmentPayload = (segments: ConversationSegment[]) =>
  segments
    .map((s) => ({
      id: s.id,
      speakerId: s.speakerId,
      start: Number(s.start.toFixed(2)),
      end: Number(s.end.toFixed(2)),
      text: s.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((s) => s.text.length > 0);

const hashString = (input: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
};

const makeCacheKey = (
  segments: ConversationSegment[],
  callType: CallType,
): string => {
  const payload = JSON.stringify({
    segments: buildSegmentPayload(segments),
    type: callType,
  });
  return `${CACHE_PREFIX}:${MODEL}:${hashString(payload)}`;
};

const readLocalCache = (key: string): CacheEntry | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed?.createdAt || !parsed?.result) return null;
    if (Date.now() - parsed.createdAt > CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeLocalCache = (key: string, entry: CacheEntry) => {
  try {
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // Ignore quota/storage errors and continue without persistence.
  }
};

const normalizeTimestamp = (value: string): string => {
  if (!value) return "N/A";
  const trimmed = value.trim();
  // If explicitly N/A, keep it
  if (trimmed.toUpperCase() === "N/A") return "N/A";

  // Return as-is if it looks like MM:SS range
  return trimmed;
};

const normalizeAnalysis = (
  result: BaseAnalysis,
  callType: CallType,
): ConversationAnalysis => {
  const matrix = callType === "inbound" ? inboundMatrix : outboundMatrix;

  const enrichedTable = result.qa_scorecard.evaluation_table.map((row) => {
    const rowArea = row.area.trim().toLowerCase();

    // Attempt 1: Exact match (normalized)
    let criteria = matrix.find((m) => m.area.trim().toLowerCase() === rowArea);

    // Attempt 2: Partial match (if AI added extra text)
    if (!criteria) {
      criteria = matrix.find((m) => {
        const mArea = m.area.trim().toLowerCase();
        return rowArea.includes(mArea) || mArea.includes(rowArea);
      });
    }

    if (!criteria) {
      console.warn(`Could not match criteria for area: "${row.area}"`);
    }

    return {
      ...row,
      evidence_timestamp: normalizeTimestamp(row.evidence_timestamp),
      max_score: criteria ? criteria.weight : 0,
      parameter: criteria ? criteria.parameter : "Unknown",
      description: criteria ? criteria.description : "", // Inject description locally
    };
  });

  return {
    ...result,
    qa_scorecard: {
      ...result.qa_scorecard,
      evaluation_table: enrichedTable,
    },
  } as ConversationAnalysis; // Cast to extended type
};

export const analyzeConversation = async (
  segments: ConversationSegment[],
  callType: CallType = "inbound",
): Promise<ConversationAnalysis> => {
  if (!API_KEY) {
    throw new Error("Missing VITE_XAI_API_KEY");
  }

  const cacheKey = makeCacheKey(segments, callType);
  const memoryHit = memoryCache.get(cacheKey);
  if (memoryHit && Date.now() - memoryHit.createdAt <= CACHE_TTL_MS) {
    return memoryHit.result;
  }

  const localHit = readLocalCache(cacheKey);
  if (localHit) {
    memoryCache.set(cacheKey, localHit);
    return localHit.result;
  }

  const transcriptText = buildSegmentPayload(segments)
    .map(
      (s) =>
        `[${s.id}] ${secToClock(s.start)} - ${secToClock(s.end)} ${s.speakerId}: ${s.text}`,
    )
    .join("\n");

  const matrix = callType === "inbound" ? inboundMatrix : outboundMatrix;

  const criteriaList = matrix
    .map(
      (m) =>
        `- **${m.area}** (Max Weight: ${m.weight}, Type: ${m.parameter}): ${m.description}`,
    )
    .join("\n");

  try {
    const { object } = await generateObject({
      model: xai(MODEL),
      schema: ConversationAnalysisSchema, // Does NOT include description
      system: `
You are a QA analyst for Indonesian customer service calls (${callType} type).
Output concise Bahasa Indonesia. Be factual, no repetition.

Evaluation Matrix Criteria (with Max Weights):
${criteriaList}

Rules:
- transcript_cleanup: role must be CS or Customer, keep meaning, remove fillers, keep each cleaned_text short.
- qa_scorecard.evaluation_table: evaluate EACH area from the matrix above based on the criteria.
  - "score": Assign strictly 0 OR Max Weight (Binary Scoring).
    - **Max Weight**: If the criteria is met substantially. Ignore minor slip-ups, slight wording variations, or transcription typos if the core intent/action is correct.
    - **0**: If a CORE requirement is missing, incorrect, or skipped.
      - **CRITICAL**: For "Greeting Opening", if the **Company Name** OR **Agent Name** is missing, the score MUST be 0. No exceptions.
  - If an area is not applicable, note "N/A" and give full score (Max Weight).
  - IMPORTANT: Use the EXACT Area name from the list above.
- qa_scorecard.evidence_timestamp: Copy the EXACT "MM:SS - MM:SS" string from the transcript lines provided. Do NOT calculate or hallucinate timestamps.
- Keep notes short, specific, and evidence-based.
      `,
      prompt: `Analyze transcript lines in this format: [id] start - end speaker: text\n\n${transcriptText}`,
    });

    const normalized = normalizeAnalysis(object, callType);
    const entry: CacheEntry = { createdAt: Date.now(), result: normalized };
    memoryCache.set(cacheKey, entry);
    writeLocalCache(cacheKey, entry);

    console.log("xAI Analysis Result:", normalized);
    return normalized;
  } catch (error) {
    console.error("xAI Analysis Error:", error);
    throw error;
  }
};
