import { and, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db.js";
import { jobs } from "../../drizzle/schema.js";

export const DEFAULT_DAILY_UPLOAD_LIMIT = 100;
export const MIN_DAILY_UPLOAD_LIMIT = 1;
export const MAX_DAILY_UPLOAD_LIMIT = 100000;

const getUtcDayBounds = () => {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

export const listProjectDailyUploadCounts = async (projectIds: string[]) => {
  const uniqueProjectIds = [...new Set(projectIds.filter(Boolean))];
  if (!uniqueProjectIds.length) {
    return {} as Record<string, number>;
  }

  const { start, end } = getUtcDayBounds();
  const rows = await db
    .select({
      projectId: jobs.projectId,
      uploadCount: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .where(
      and(
        inArray(jobs.projectId, uniqueProjectIds),
        gte(jobs.createdAt, start),
        lt(jobs.createdAt, end),
      ),
    )
    .groupBy(jobs.projectId);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.projectId] = Number(row.uploadCount || 0);
  }
  return counts;
};

export const getProjectDailyUploadCount = async (projectId: string) => {
  const counts = await listProjectDailyUploadCounts([projectId]);
  return counts[projectId] || 0;
};

