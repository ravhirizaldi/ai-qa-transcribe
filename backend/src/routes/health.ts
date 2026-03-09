import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { db } from "../db.js";
import { jobs } from "../../drizzle/schema.js";
import { getHttpMetricsSnapshot } from "../observability.js";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({ ok: true, service: "backend" }));

  app.get("/health/metrics", async () => {
    const [queueStats, durationStats] = await Promise.all([
      db
        .select({
          queuedCount: sql<number>`count(*) filter (where ${jobs.status} in ('queued', 'uploading', 'transcribing', 'analyzing'))::int`,
          oldestQueuedAt: sql<Date | null>`min(${jobs.createdAt}) filter (where ${jobs.status} in ('queued', 'uploading', 'transcribing', 'analyzing'))`,
        })
        .from(jobs),
      db
        .select({
          avgDurationMs: sql<number>`coalesce(avg(extract(epoch from (${jobs.completedAt} - ${jobs.startedAt})) * 1000), 0)::float`,
          p95DurationMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by extract(epoch from (${jobs.completedAt} - ${jobs.startedAt})) * 1000), 0)::float`,
        })
        .from(jobs)
        .where(sql`${jobs.startedAt} is not null and ${jobs.completedAt} is not null`),
    ]);

    const queuedCount = Number(queueStats[0]?.queuedCount || 0);
    const oldestQueuedAt = queueStats[0]?.oldestQueuedAt || null;
    const queueLagMs = oldestQueuedAt
      ? Math.max(0, Date.now() - new Date(oldestQueuedAt).getTime())
      : 0;

    return {
      ok: true,
      service: "backend",
      queue: {
        queuedCount,
        oldestQueuedAt,
        queueLagMs,
      },
      jobs: {
        avgDurationMs: Number(durationStats[0]?.avgDurationMs || 0),
        p95DurationMs: Number(durationStats[0]?.p95DurationMs || 0),
      },
      http: getHttpMetricsSnapshot(),
    };
  });
};
