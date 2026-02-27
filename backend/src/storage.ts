import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MultipartFile } from "@fastify/multipart";
import { env } from "./config.js";

export const saveUpload = async (file: MultipartFile) => {
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${randomUUID()}-${safeName}`;
  const filePath = join(env.UPLOAD_DIR, fileName);
  const data = await file.toBuffer();
  await writeFile(filePath, data);
  return { filePath, fileName: file.filename };
};
