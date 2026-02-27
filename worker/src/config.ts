import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ELEVENLABS_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  XAI_MODEL: z.string().default("grok-4-1-fast-non-reasoning"),
});

export const env = EnvSchema.parse(process.env);
