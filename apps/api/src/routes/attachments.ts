import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { s3, STORAGE_BUCKET } from "../lib/storage.js";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import path from "node:path";

function sanitizeFilename(raw: string): string {
  // Extract basename, strip path traversal
  let name = path.basename(raw);
  // Remove null bytes and control characters
  name = name.replace(/[\x00-\x1f\x7f]/g, "");
  // Replace any remaining path separators (Windows)
  name = name.replace(/[/\\]/g, "_");
  // Enforce max length
  if (name.length > 255) name = name.slice(0, 255);
  // Fallback if empty after sanitization
  return name || "unnamed";
}

const SAFE_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "application/pdf",
  "text/plain",
  "application/zip", "application/gzip",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function getSafeContentType(mimeType: string): string {
  return SAFE_MIME_TYPES.has(mimeType) ? mimeType : "application/octet-stream";
}

const attachments = new Hono<AuthEnv>();
attachments.use("*", authMiddleware);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

// POST /things/:itemId/attachments
attachments.post("/:itemId/attachments", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");

  const item = await prisma.item.findFirst({
    where: { id: itemId, userId: user.id },
  });
  if (!item) return c.json({ error: "Not found" }, 404);

  const filename = sanitizeFilename(c.req.header("X-Filename") || "unnamed");
  const mimeType = c.req.header("Content-Type") || "application/octet-stream";
  const contentLength = parseInt(c.req.header("Content-Length") || "0", 10);

  if (contentLength > MAX_FILE_SIZE) {
    return c.json({ error: "File too large (max 25MB)" }, 400);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength > MAX_FILE_SIZE) {
    return c.json({ error: "File too large (max 25MB)" }, 400);
  }

  const storageKey = `attachments/${user.id}/${itemId}/${randomUUID()}-${filename}`;

  // Create DB record first — if S3 fails we roll back the record.
  // This avoids orphaned S3 objects when the DB write fails.
  const attachment = await prisma.attachment.create({
    data: { filename, mimeType, sizeBytes: body.byteLength, storageKey, itemId, userId: user.id },
  });

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: storageKey,
        Body: Buffer.from(body),
        ContentType: getSafeContentType(mimeType),
        ContentDisposition: `attachment; filename="${filename}"`,
      })
    );
  } catch {
    // Rollback DB record on S3 failure
    await prisma.attachment.delete({ where: { id: attachment.id } });
    return c.json({ error: "Failed to upload file" }, 500);
  }

  return c.json({
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    createdAt: attachment.createdAt.toISOString(),
  }, 201);
});

// DELETE /things/:itemId/attachments/:attachmentId
attachments.delete("/:itemId/attachments/:attachmentId", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("itemId");
  const attachmentId = c.req.param("attachmentId");

  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, itemId, userId: user.id },
  });
  if (!attachment) return c.json({ error: "Not found" }, 404);

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: STORAGE_BUCKET, Key: attachment.storageKey }));
  } catch {
    // Log but continue — DB record must be deleted regardless
  }
  await prisma.attachment.delete({ where: { id: attachment.id } });

  return c.json({ ok: true });
});

export { attachments };
