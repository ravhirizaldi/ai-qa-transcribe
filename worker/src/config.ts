import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  XAI_MODEL: z.string().default("grok-4-1-fast-non-reasoning"),
  XAI_MANAGEMENT_API_KEY: z.string().optional(),
  XAI_RAG_MODEL: z.string().default("grok-4-1-fast-reasoning"),
  WORKER_PROVIDER_CACHE_TTL_MS: z.coerce.number().int().positive().default(30_000),
  WORKER_POLLING_INTERVAL_SECONDS: z.coerce.number().positive().default(2),
  WORKER_TRANSCRIBE_POLLING_INTERVAL_SECONDS: z.coerce.number().positive().optional(),
  WORKER_ANALYZE_POLLING_INTERVAL_SECONDS: z.coerce.number().positive().optional(),
  WORKER_FINALIZE_POLLING_INTERVAL_SECONDS: z.coerce.number().positive().optional(),
  WORKER_RAG_POLLING_INTERVAL_SECONDS: z.coerce.number().positive().optional(),
  WORKER_TRANSCRIBE_BATCH_SIZE: z.coerce.number().int().positive().default(1),
  WORKER_ANALYZE_BATCH_SIZE: z.coerce.number().int().positive().default(1),
  WORKER_FINALIZE_BATCH_SIZE: z.coerce.number().int().positive().default(5),
  WORKER_RAG_BATCH_SIZE: z.coerce.number().int().positive().default(5),
  WORKER_TRANSCRIBE_LOCAL_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_ANALYZE_LOCAL_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_FINALIZE_LOCAL_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_RAG_LOCAL_CONCURRENCY: z.coerce.number().int().positive().default(1),
});

const moduleDir = dirname(fileURLToPath(import.meta.url));
const envCandidates = [resolve(process.cwd(), ".env"), resolve(moduleDir, "../.env")];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
    break;
  }
}

export const env = EnvSchema.parse(process.env);
