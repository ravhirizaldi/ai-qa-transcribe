import type { FastifyPluginAsync } from "fastify";
import { registerClient, unregisterClient, handleSubscriptionMessage } from "../ws-hub.js";

export const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/ws",
    { websocket: true },
    async (socket, request) => {
      const token =
        (request.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
        (request.query as { token?: string })?.token ||
        "";

      try {
        app.jwt.verify<{ sub: string; email: string }>(token);
      } catch {
        socket.close(1008, "Unauthorized");
        return;
      }

      registerClient(socket);
      socket.on("message", (raw: any) => {
        try {
          const payload = JSON.parse(raw.toString());
          handleSubscriptionMessage(socket, payload);
        } catch {
          // Ignore malformed messages.
        }
      });

      socket.on("close", () => unregisterClient(socket));
    },
  );
};
