import type { BatchHistoryItem } from "../services/backendApi";

export const defaultBatchName = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `QA Batch ${y}-${m}-${d}`;
};

export const loadBatchNameMap = (storageKey: string) => {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
};

export const persistBatchNameMap = (
  storageKey: string,
  map: Record<string, string>,
) => {
  localStorage.setItem(storageKey, JSON.stringify(map));
};

export const resolveBatchDisplayName = (
  batch: BatchHistoryItem,
  map: Record<string, string>,
) => {
  const dbName = String(batch.name || "").trim();
  if (dbName) return dbName;
  const cachedName = String(map[batch.id] || "").trim();
  if (cachedName) return cachedName;
  return `Batch ${new Date(batch.createdAt).toLocaleDateString()}`;
};

export const canDeleteBatch = (
  batch: BatchHistoryItem,
  isSuperAdmin: boolean,
) => {
  const readyForDelete =
    batch.totalJobs === 0 ||
    (batch.totalJobs > 0 &&
      batch.completedJobs + batch.failedJobs === batch.totalJobs);
  if (!readyForDelete) return false;
  if (batch.isLocked && !isSuperAdmin) return false;
  return true;
};
