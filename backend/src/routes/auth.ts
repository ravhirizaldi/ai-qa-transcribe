import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { users } from "../../drizzle/schema.js";
import { hashPassword, verifyPassword } from "../auth.js";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/auth/register", async (request, reply) => {
    const payload = RegisterSchema.parse(request.body);
    const existing = await db.query.users.findFirst({
      where: eq(users.email, payload.email),
    });
    if (existing) {
      return reply.code(409).send({ message: "Email already registered" });
    }

    const [created] = await db
      .insert(users)
      .values({
        email: payload.email,
        passwordHash: hashPassword(payload.password),
      })
      .returning();

    const token = await reply.jwtSign({ sub: created.id, email: created.email });
    return { token, user: { id: created.id, email: created.email } };
  });

  app.post("/auth/login", async (request, reply) => {
    const payload = RegisterSchema.parse(request.body);
    const user = await db.query.users.findFirst({ where: eq(users.email, payload.email) });
    if (!user || !verifyPassword(payload.password, user.passwordHash)) {
      return reply.code(401).send({ message: "Invalid credentials" });
    }

    const token = await reply.jwtSign({ sub: user.id, email: user.email });
    return { token, user: { id: user.id, email: user.email } };
  });
};
