import { Hono } from "hono";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { publicS3, PUBLIC_STORAGE_BUCKET } from "../lib/storage.js";

const storageProxy = new Hono();

// Allowed prefixes — only these paths are proxied. Anything else is 404.
// feedback/ serves screenshots embedded in GitHub Issues created by
// apps/api/src/routes/feedback.ts (keys are crypto.randomBytes(16).hex).
const ALLOWED_PREFIXES = ["videos/", "backgrounds/", "feedback/"];

// Content-type mapping
const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
};

function getContentType(key: string): string {
  const ext = key.substring(key.lastIndexOf(".")).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

/**
 * GET /public/* — proxy public assets from the private S3 bucket.
 *
 * Railway Object Storage doesn't support public buckets, so this route
 * authenticates with S3 on the server side and streams the response to
 * the client with cache headers.
 *
 * Security: only paths under ALLOWED_PREFIXES are served. Path traversal
 * is prevented by rejecting keys with ".." or leading slashes.
 */
storageProxy.get("/*", async (c) => {
  // c.req.path is the full path (e.g. /public/videos/foo.mp4)
  const key = c.req.path.slice("/public/".length);

  // Reject empty keys, path traversal, encoded characters, and disallowed prefixes
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("%")) {
    return c.json({ error: "Not found" }, 404);
  }

  if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return c.json({ error: "Not found" }, 404);
  }

  try {
    const result = await publicS3.send(
      new GetObjectCommand({
        Bucket: PUBLIC_STORAGE_BUCKET,
        Key: key,
      })
    );

    if (!result.Body) {
      return c.json({ error: "Not found" }, 404);
    }

    const contentType = getContentType(key);

    // Stream the response — don't buffer large files in memory
    const stream = result.Body as ReadableStream;

    return new Response(stream as any, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
        ...(result.ContentLength ? { "Content-Length": String(result.ContentLength) } : {}),
      },
    });
  } catch (err: any) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return c.json({ error: "Not found" }, 404);
    }
    console.error("[StorageProxy] Error fetching", key, err.message);
    return c.json({ error: "Internal error" }, 500);
  }
});

export { storageProxy };
