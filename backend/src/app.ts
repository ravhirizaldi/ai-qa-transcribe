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
import { broadcastEvent } from "./ws-hub.js";
import { boss, QUEUES, startQueue } from "./queue.js";

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

export const buildApp = async () => {
  const app = Fastify({
    logger: true,
    // Uploaded filenames can be long; allow matching long URL params safely.
    maxParamLength: 5000,
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
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

  await startQueue();
  await boss.createQueue(QUEUES.WS_EVENTS);
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
  await app.register(matrixRoutes);
  await app.register(jobRoutes);
  await app.register(wsRoutes);

  app.addHook("onClose", async () => {
    await boss.stop();
  });

  return app;
};
