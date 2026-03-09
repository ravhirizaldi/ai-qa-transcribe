import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import jwt from "@fastify/jwt";
import { env } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { tenantRoutes } from "./routes/tenants.js";
import { matrixRoutes } from "./routes/matrices.js";
import { jobRoutes } from "./routes/jobs.js";
import { healthRoutes } from "./routes/health.js";
import { wsRoutes } from "./routes/ws.js";
import { settingsRoutes } from "./routes/settings.js";
import { assistantRoutes } from "./routes/assistant.js";
import { broadcastEvent } from "./ws-hub.js";
import { boss, QUEUES, startQueue } from "./queue.js";
import { observeHttpRequest } from "./observability.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
  interface FastifyRequest {
    _startedAtNs?: bigint;
  }
}

export const buildApp = async () => {
  const app = Fastify({
    logger: true,
    // Uploaded filenames can be long; allow matching long URL params safely.
    maxParamLength: 5000,
  });

  const corsOrigins = env.CORS_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowAllOrigins = corsOrigins.includes("*");
  const allowedOrigins = new Set(corsOrigins);
  const isDev = env.NODE_ENV !== "production";

  // Local dev commonly mixes localhost/127.0.0.1, keep both interchangeable.
  if (allowedOrigins.has("http://localhost:5173")) {
    allowedOrigins.add("http://127.0.0.1:5173");
  }
  if (allowedOrigins.has("http://127.0.0.1:5173")) {
    allowedOrigins.add("http://localhost:5173");
  }

  await app.register(cors, {
    origin: (origin, cb) => {
      const isLocalDevOrigin =
        typeof origin === "string" &&
        /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);

      if (
        !origin ||
        allowAllOrigins ||
        allowedOrigins.has(origin) ||
        (isDev && isLocalDevOrigin)
      ) {
        cb(null, true);
        return;
      }
      cb(new Error(`CORS blocked origin: ${origin}`), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 50 } });
  await app.register(websocket);
  await app.register(jwt, { secret: env.JWT_SECRET });

  app.decorate("authenticate", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ message: "Unauthorized" });
    }
  });

  app.addHook("onRequest", async (request) => {
    request._startedAtNs = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    const startedAt = request._startedAtNs;
    if (!startedAt) return;
    const elapsedNs = process.hrtime.bigint() - startedAt;
    const durationMs = Number(elapsedNs) / 1_000_000;
    observeHttpRequest({
      method: request.method,
      route: request.routeOptions?.url || request.url,
      statusCode: reply.statusCode,
      durationMs,
    });
  });

  await startQueue();
  await boss.createQueue(QUEUES.WS_EVENTS);
  await boss.createQueue(QUEUES.RAG_SYNC_CORRECTION);
  await boss.work(QUEUES.WS_EVENTS, async (payload: any) => {
    const jobs = Array.isArray(payload) ? payload : [payload];
    for (const job of jobs) {
      broadcastEvent(job.data as Record<string, unknown>);
    }
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(tenantRoutes);
  await app.register(settingsRoutes);
  await app.register(assistantRoutes);
  await app.register(matrixRoutes);
  await app.register(jobRoutes);
  await app.register(wsRoutes);

  app.addHook("onClose", async () => {
    await boss.stop();
  });

  return app;
};
