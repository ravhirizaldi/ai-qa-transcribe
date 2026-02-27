type ProviderLogLevel = "info" | "error";

const sanitizeError = (error: unknown) => {
  const e = error as any;
  return {
    message: e?.message ? String(e.message) : "Unknown provider error",
    name: e?.name ? String(e.name) : undefined,
    status: e?.status ?? e?.statusCode ?? e?.response?.status,
    code: e?.code,
    body:
      typeof e?.body === "string"
        ? e.body.slice(0, 1000)
        : typeof e?.response?.data === "string"
        ? e.response.data.slice(0, 1000)
        : undefined,
  };
};

export const logProviderEvent = (
  level: ProviderLogLevel,
  event: string,
  payload: Record<string, unknown>,
) => {
  const log = {
    ts: new Date().toISOString(),
    level,
    source: "worker.provider",
    event,
    ...payload,
  };
  const line = JSON.stringify(log);
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
};

export const logProviderError = (
  event: string,
  payload: Record<string, unknown>,
  error: unknown,
) => {
  logProviderEvent("error", event, {
    ...payload,
    error: sanitizeError(error),
  });
};

