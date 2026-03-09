import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  const encoded = hash.toString("hex");
  return `${salt}:${encoded}`;
};

export const verifyPassword = async (password: string, hashed: string) => {
  const [salt, key] = hashed.split(":");
  if (!salt || !key) return false;
  const hashBuffer = Buffer.from(key, "hex");
  const suppliedBuffer = (await scryptAsync(password, salt, 64)) as Buffer;
  if (hashBuffer.length !== suppliedBuffer.length) return false;
  return timingSafeEqual(hashBuffer, suppliedBuffer);
};
