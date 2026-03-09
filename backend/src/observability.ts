type RouteMetric = {
  method: string;
  route: string;
  requests: number;
  errors: number;
  totalDurationMs: number;
  maxDurationMs: number;
  latencyBuckets: Record<string, number>;
};

const LATENCY_BUCKETS_MS = [25, 50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000];
const routeMetrics = new Map<string, RouteMetric>();

const getBucketLabel = (durationMs: number) => {
  for (const bucket of LATENCY_BUCKETS_MS) {
    if (durationMs <= bucket) return `le_${bucket}ms`;
  }
  return "gt_10000ms";
};

export const observeHttpRequest = (input: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}) => {
  const key = `${input.method} ${input.route}`;
  const existing = routeMetrics.get(key) || {
    method: input.method,
    route: input.route,
    requests: 0,
    errors: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    latencyBuckets: {},
  };

  existing.requests += 1;
  if (input.statusCode >= 400) {
    existing.errors += 1;
  }
  existing.totalDurationMs += input.durationMs;
  existing.maxDurationMs = Math.max(existing.maxDurationMs, input.durationMs);
  const bucket = getBucketLabel(input.durationMs);
  existing.latencyBuckets[bucket] = (existing.latencyBuckets[bucket] || 0) + 1;
  routeMetrics.set(key, existing);
};

export const getHttpMetricsSnapshot = () => {
  return Array.from(routeMetrics.values()).map((entry) => ({
    method: entry.method,
    route: entry.route,
    requests: entry.requests,
    errors: entry.errors,
    errorRate: entry.requests
      ? Number((entry.errors / entry.requests).toFixed(4))
      : 0,
    avgDurationMs: entry.requests
      ? Number((entry.totalDurationMs / entry.requests).toFixed(2))
      : 0,
    maxDurationMs: Number(entry.maxDurationMs.toFixed(2)),
    latencyBuckets: entry.latencyBuckets,
  }));
};
