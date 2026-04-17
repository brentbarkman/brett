import { Hono } from "hono";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

const releaseProxy = new Hono();

// Promise-memoized S3 client — prevents race condition on concurrent init
let _initPromise: Promise<{ s3: S3Client; bucket: string }> | null = null;

function getReleaseStorage(): Promise<{ s3: S3Client; bucket: string }> {
  if (!_initPromise) {
    _initPromise = (async () => {
      const s3 = new S3Client({
        endpoint: process.env.RELEASE_STORAGE_ENDPOINT || process.env.STORAGE_ENDPOINT,
        region: process.env.STORAGE_REGION || "us-east-1",
        credentials: {
          accessKeyId: process.env.RELEASE_STORAGE_ACCESS_KEY || process.env.STORAGE_ACCESS_KEY || "",
          secretAccessKey: process.env.RELEASE_STORAGE_SECRET_KEY || process.env.STORAGE_SECRET_KEY || "",
        },
        forcePathStyle: true,
      });
      const bucket = process.env.RELEASE_STORAGE_BUCKET || "brett-releases";
      return { s3, bucket };
    })();
  }
  return _initPromise;
}

// Allowed files in releases/ — whitelist specific patterns
const ALLOWED_RELEASE_PATTERNS = [
  /^releases\/Brett-[\d.]+(?:-[\w.]+)?\.(zip|dmg)$/,
  /^releases\/latest-mac\.yml$/,
  /^releases\/latest\.json$/,
];

/**
 * GET /releases/* — proxy release artifacts from the release S3 bucket.
 *
 * Serves ZIPs/DMGs (download page), latest-mac.yml (auto-updater),
 * and latest.json (version check). Strict whitelist — only known
 * release file patterns are served.
 */
releaseProxy.get("/*", async (c) => {
  // c.req.path is the full path (e.g. /releases/latest-mac.yml)
  const subPath = c.req.path.slice("/releases/".length);
  const key = subPath ? `releases/${subPath}` : "";

  // Reject empty, traversal, encoded characters, and disallowed patterns
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("%")) {
    return c.json({ error: "Not found" }, 404);
  }

  if (!ALLOWED_RELEASE_PATTERNS.some((pattern) => pattern.test(key))) {
    return c.json({ error: "Not found" }, 404);
  }

  // Short-circuit when no storage is configured. Without this guard the
  // AWS SDK falls back to its real AWS defaults and retries/backoff can
  // stall for 10+ seconds before failing — long enough to wedge a CI
  // test (same class of bug as getLatestVersion in storage-urls.ts).
  if (!process.env.RELEASE_STORAGE_ENDPOINT && !process.env.STORAGE_ENDPOINT) {
    return c.json({ error: "Release storage not configured" }, 503);
  }

  try {
    const { s3, bucket } = await getReleaseStorage();
    const result = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );

    if (!result.Body) {
      return c.json({ error: "Not found" }, 404);
    }

    // Content types
    let contentType = "application/octet-stream";
    if (key.endsWith(".yml")) contentType = "text/yaml";
    else if (key.endsWith(".json")) contentType = "application/json";
    else if (key.endsWith(".zip")) contentType = "application/zip";

    // No cache for update metadata (must always be fresh), longer for artifacts
    const isMetadata = key.endsWith(".yml") || key.endsWith(".json");
    const cacheControl = isMetadata
      ? "no-cache"
      : "public, max-age=3600, must-revalidate";

    const stream = result.Body as ReadableStream;

    return new Response(stream as any, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": cacheControl,
        ...(result.ContentLength ? { "Content-Length": String(result.ContentLength) } : {}),
      },
    });
  } catch (err: any) {
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      return c.json({ error: "Not found" }, 404);
    }
    console.error("[ReleaseProxy] Error fetching", key, err.message);
    return c.json({ error: "Internal error" }, 500);
  }
});

export { releaseProxy };
