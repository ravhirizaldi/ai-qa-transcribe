import { createXai } from "@ai-sdk/xai";
import { generateText } from "ai";
import type { MatrixRow } from "./analyze.js";
import { logProviderError, logProviderEvent } from "./providerLogs.js";

export const fetchRagGuidance = async (input: {
  xaiApiKey: string;
  ragModel: string;
  collectionId: string | null;
  callType: "inbound" | "outbound";
  matrixRows: MatrixRow[];
  jobId?: string;
  batchId?: string;
}) => {
  const collectionId = String(input.collectionId || "").trim();
  if (!collectionId) {
    return null;
  }

  const startedAt = Date.now();
  const xai = createXai({ apiKey: input.xaiApiKey });
  const matrixSummary = input.matrixRows
    .map(
      (row, idx) =>
        `- [${idx}] ${row.area} | ${row.parameter} | max=${row.weight} | ${row.description}`,
    )
    .join("\n");

  try {
    logProviderEvent("info", "rag.retrieve.request", {
      provider: "xai",
      endpoint: "ai.generateText",
      model: input.ragModel,
      collectionId,
      callType: input.callType,
      jobId: input.jobId,
      batchId: input.batchId,
    });

    const result = await generateText({
      model: xai.responses(input.ragModel),
      temperature: 0,
      maxOutputTokens: 700,
      prompt: `Anda menyiapkan ringkasan panduan QA dari dokumen koreksi manual.
Call type: ${input.callType}

Matriks QA aktif:
${matrixSummary}

Gunakan tool pencarian dokumen untuk menemukan pola koreksi paling relevan.
Keluarkan hasil ringkas berupa 5-10 bullet poin dalam Bahasa Indonesia.
Fokus pada:
1) kondisi yang membuat skor harus 0
2) bukti percakapan yang biasanya mendukung keputusan
3) area rawan salah-skor
4) pengecualian atau perilaku yang DIIZINKAN (contoh: boleh sebut X tanpa Y).

Jangan ulangi metadata internal. Jangan beri jawaban panjang.`,
      tools: {
        file_search: xai.tools.fileSearch({
          vectorStoreIds: [collectionId],
          maxNumResults: 10,
        }),
      },
      providerOptions: {
        xai: {
          include: ["file_search_call.results"],
        },
      },
    });

    const text = String(result.text || "").trim();
    if (!text) return null;

    logProviderEvent("info", "rag.retrieve.success", {
      provider: "xai",
      endpoint: "ai.generateText",
      model: input.ragModel,
      collectionId,
      callType: input.callType,
      jobId: input.jobId,
      batchId: input.batchId,
      durationMs: Date.now() - startedAt,
      guidanceChars: text.length,
    });

    return text.slice(0, 6000);
  } catch (error) {
    logProviderError(
      "rag.retrieve.failed",
      {
        provider: "xai",
        endpoint: "ai.generateText",
        model: input.ragModel,
        collectionId,
        callType: input.callType,
        jobId: input.jobId,
        batchId: input.batchId,
        durationMs: Date.now() - startedAt,
      },
      error,
    );
    return null;
  }
};
