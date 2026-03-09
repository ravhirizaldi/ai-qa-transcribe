export const getRealtimePollingInterval = (hasStableConnection: boolean) =>
  hasStableConnection ? 5_000 : 2_000;

export const isRealtimeJobEvent = (eventName: string) =>
  eventName === "job.status.changed" ||
  eventName === "job.failed" ||
  eventName === "job.completed";
