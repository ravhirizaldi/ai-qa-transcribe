import type { FastifyReply, FastifyRequest } from "fastify";

type RateLimitConfig = {
  max: number;
  windowMs: number;
  key: (request: FastifyRequest) => string;
  label: string;
};

const createRateLimiter = (config: RateLimitConfig) => {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let gcCounter = 0;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const now = Date.now();
    const key = config.key(request);
    const current = hits.get(key);

    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + config.windowMs });
    } else if (current.count >= config.max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      return reply
        .code(429)
        .header("Retry-After", String(retryAfter))
        .send({
          message: `Too many ${config.label} requests. Please retry later.`,
        });
    } else {
      current.count += 1;
      hits.set(key, current);
    }

    gcCounter += 1;
    if (gcCounter % 200 === 0) {
      for (const [entryKey, value] of hits.entries()) {
        if (value.resetAt <= now) {
          hits.delete(entryKey);
        }
      }
    }
  };
};

export const loginRateLimit = createRateLimiter({
  max: 20,
  windowMs: 60_000,
  key: (request) => `${request.ip}:auth:login`,
  label: "login",
});

export const uploadRateLimit = createRateLimiter({
  max: 40,
  windowMs: 60_000,
  key: (request) => `${request.ip}:upload`,
  label: "upload",
});

export const assistantRateLimit = createRateLimiter({
  max: 30,
  windowMs: 60_000,
  key: (request) => `${request.ip}:assistant`,
  label: "assistant",
});
