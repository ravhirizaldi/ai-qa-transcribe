import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  XAI_MODEL: z.string().default("grok-4-1-fast-non-reasoning"),
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
