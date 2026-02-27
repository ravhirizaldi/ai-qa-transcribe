import { mkdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { MultipartFile } from "@fastify/multipart";
import { env } from "./config.js";

export const saveUpload = async (file: MultipartFile) => {
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${randomUUID()}-${safeName}`;
  // Persist absolute path so worker can read the same file regardless of its cwd.
  const filePath = resolve(env.UPLOAD_DIR, fileName);
  const data = await file.toBuffer();
  await writeFile(filePath, data);
  return { filePath, fileName: file.filename };
};

export const deleteUploadFile = async (filePath: string) => {
  try {
    await unlink(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
};
