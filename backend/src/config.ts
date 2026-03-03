import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  UPLOAD_DIR: z.string().default("uploads"),
});

export type Env = z.infer<typeof EnvSchema>;

const moduleDir = dirname(fileURLToPath(import.meta.url));
const envCandidates = [resolve(process.cwd(), ".env"), resolve(moduleDir, "../.env")];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
    break;
  }
}

const parsedEnv = EnvSchema.parse(process.env);

export const env: Env = {
  ...parsedEnv,
  // Keep uploads location stable regardless of process cwd.
  UPLOAD_DIR: isAbsolute(parsedEnv.UPLOAD_DIR)
    ? parsedEnv.UPLOAD_DIR
    : resolve(moduleDir, "..", parsedEnv.UPLOAD_DIR),
};
