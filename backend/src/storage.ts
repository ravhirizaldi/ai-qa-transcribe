import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { MultipartFile } from "@fastify/multipart";
import { env } from "./config.js";

const persistMultipartFile = async (file: MultipartFile, filePath: string) => {
  try {
    await pipeline(file.file, createWriteStream(filePath));
  } catch (error) {
    try {
      await unlink(filePath);
    } catch {
      // Best effort cleanup for partial writes.
    }
    throw error;
  }
};

export const saveUpload = async (file: MultipartFile) => {
  await mkdir(env.UPLOAD_DIR, { recursive: true });
  const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${randomUUID()}-${safeName}`;
  // Persist absolute path so worker can read the same file regardless of its cwd.
  const filePath = resolve(env.UPLOAD_DIR, fileName);
  await persistMultipartFile(file, filePath);
  return { filePath, fileName: file.filename };
};

export const saveImageUpload = async (file: MultipartFile) => {
  const imageDir = resolve(env.UPLOAD_DIR, "images");
  await mkdir(imageDir, { recursive: true });
  const rawExt = extname(file.filename).toLowerCase();
  const ext = rawExt && /^[.a-z0-9]+$/.test(rawExt) ? rawExt : "";
  // Keep public URLs compact and avoid router param-length issues.
  const fileName = `${randomUUID()}${ext}`;
  const filePath = resolve(imageDir, fileName);
  await persistMultipartFile(file, filePath);
  return {
    filePath,
    fileName: file.filename,
    publicPath: `/uploads/images/${fileName}`,
  };
};

export const deleteUploadFile = async (filePath: string) => {
  try {
    await unlink(filePath);
  } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
};
