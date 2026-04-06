import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { s3, PRIVATE_STORAGE_BUCKET } from "../lib/storage.js";
import { sanitizeFilename } from "../lib/sanitize-filename.js";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";

const SAFE_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "text/plain",
  "application/zip", "application/gzip",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

// Magic byte signatures for file type validation
const MAGIC_BYTES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: "image/jpeg", bytes: [0xFF, 0xD8, 0xFF] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: "image/webp", bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: "application/zip", bytes: [0x50, 0x4B, 0x03, 0x04] },
  { mime: "application/gzip", bytes: [0x1F, 0x8B] },
];

function detectMimeFromBytes(buffer: ArrayBuffer): string | null {
  const view = new Uint8Array(buffer);
  for (const sig of MAGIC_BYTES) {
    const offset = sig.offset ?? 0;
    if (view.length < offset + sig.bytes.length) continue;
    if (sig.bytes.every((b, i) => view[offset + i] === b)) return sig.mime;
  }
  return null;
}

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

  const rawFilename = c.req.header("X-Filename") || "unnamed";
  const filename = sanitizeFilename(decodeURIComponent(rawFilename));
  const mimeType = c.req.header("Content-Type") || "application/octet-stream";
  const contentLength = parseInt(c.req.header("Content-Length") || "0", 10);

  if (contentLength > MAX_FILE_SIZE) {
    return c.json({ error: "File too large (max 25MB)" }, 400);
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength > MAX_FILE_SIZE) {
    return c.json({ error: "File too large (max 25MB)" }, 400);
  }

  // Trust file magic bytes over client-claimed MIME type to prevent disguised uploads
  const detectedMime = detectMimeFromBytes(body);
  const effectiveMime = detectedMime && SAFE_MIME_TYPES.has(detectedMime) ? detectedMime : mimeType;

  const storageKey = `attachments/${user.id}/${itemId}/${randomUUID()}-${filename}`;

  // Create DB record first — if S3 fails we roll back the record.
  // This avoids orphaned S3 objects when the DB write fails.
  const attachment = await prisma.attachment.create({
    data: { filename, mimeType: effectiveMime, sizeBytes: body.byteLength, storageKey, itemId, userId: user.id },
  });

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: PRIVATE_STORAGE_BUCKET,
        Key: storageKey,
        Body: Buffer.from(body),
        ContentType: getSafeContentType(effectiveMime),
        ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      })
    );
  } catch (err) {
    // Rollback DB record on S3 failure
    await prisma.attachment.delete({ where: { id: attachment.id } });
    console.error("S3 upload failed:", err);
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
    await s3.send(new DeleteObjectCommand({ Bucket: PRIVATE_STORAGE_BUCKET, Key: attachment.storageKey }));
  } catch {
    // Log but continue — DB record must be deleted regardless
  }
  await prisma.attachment.delete({ where: { id: attachment.id } });

  return c.json({ ok: true });
});

export { attachments };
