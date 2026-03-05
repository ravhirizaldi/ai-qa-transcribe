import { eq } from "drizzle-orm";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../db.js";
import { users } from "../../drizzle/schema.js";
import { hashPassword, verifyPassword } from "../auth.js";
import { listUserRoleAssignments } from "../repos/access.js";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullname: z.string().max(120).optional(),
});

const normalizeFullname = (value: string | null | undefined) => {
  const name = String(value || "").trim();
  return name || "User";
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  const canRegister = async () => {
    const existingUser = await db.query.users.findFirst({
      columns: { id: true },
    });
    return !existingUser;
  };

  app.get("/auth/bootstrap-status", async () => {
    return { canRegister: await canRegister() };
  });

  app.post("/auth/register", async (request, reply) => {
    if (!(await canRegister())) {
      return reply
        .code(403)
        .send({ message: "Registration is disabled after initial setup" });
    }

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
        fullname: normalizeFullname(payload.fullname),
        passwordHash: hashPassword(payload.password),
      })
      .returning();

    const token = await reply.jwtSign({ sub: created.id, email: created.email });
    return {
      token,
      user: {
        id: created.id,
        email: created.email,
        fullname: normalizeFullname(created.fullname),
      },
    };
  });

  app.post("/auth/login", async (request, reply) => {
    const payload = RegisterSchema.parse(request.body);
    const user = await db.query.users.findFirst({ where: eq(users.email, payload.email) });
    if (!user || !verifyPassword(payload.password, user.passwordHash)) {
      return reply.code(401).send({ message: "Invalid credentials" });
    }

    const token = await reply.jwtSign({ sub: user.id, email: user.email });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullname: normalizeFullname(user.fullname),
      },
    };
  });

  app.get("/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = (request.user as any).sub as string;
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, email: true, fullname: true, isRestricted: true },
    });
    if (!user) {
      return reply.code(404).send({ message: "User not found" });
    }

    const assignments = user.isRestricted ? await listUserRoleAssignments(userId) : [];
    const permissionSet = new Set<string>();
    for (const assignment of assignments) {
      for (const permission of assignment.permissions) {
        permissionSet.add(permission);
      }
    }

    return {
      id: user.id,
      email: user.email,
      fullname: normalizeFullname(user.fullname),
      isRestricted: user.isRestricted,
      permissions: [...permissionSet],
    };
  });
};
