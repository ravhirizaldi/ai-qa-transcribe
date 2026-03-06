import { PgBoss } from "pg-boss";
import { env } from "./config.js";

export const QUEUES = {
  TRANSCRIBE: "job.transcribe",
  ANALYZE: "job.analyze",
  FINALIZE: "job.finalize",
  RAG_SYNC_CORRECTION: "rag.sync.correction",
  WS_EVENTS: "ws.events",
} as const;

export const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
});

export const startQueue = async () => {
  await boss.start();
};
