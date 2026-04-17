const VIDEO_COUNT = 9;

export function getStorageUrls() {
  // Public assets and releases are served via the API's proxy routes
  // (/public/* and /releases/*) since Railway Object Storage doesn't
  // support public buckets. The proxy authenticates with S3 server-side.
  const apiBase = process.env.BETTER_AUTH_URL || "http://localhost:3001";

  return {
    base: apiBase,
    releaseBaseUrl: apiBase,
    releasesUrl: `${apiBase}/releases`,
    videoBaseUrl: `${apiBase}/public/videos`,
    videoFiles: Array.from(
      { length: VIDEO_COUNT },
      (_, i) => `${apiBase}/public/videos/login-bg-${i + 1}.mp4`
    ),
  };
}

// Cached latest version — fetched directly from S3 (not through the proxy)
let cachedVersion: { version: string; dmg?: string; artifact?: string; downloads?: { arm64?: string; x64?: string } } | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Memoized S3 client for release bucket reads
let _releaseClientPromise: Promise<{ s3: any; bucket: string }> | null = null;

function getReleaseClient() {
  if (!_releaseClientPromise) {
    _releaseClientPromise = (async () => {
      const { S3Client } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({
        endpoint: process.env.RELEASE_STORAGE_ENDPOINT || process.env.STORAGE_ENDPOINT,
        region: process.env.STORAGE_REGION || "us-east-1",
        credentials: {
          accessKeyId: process.env.RELEASE_STORAGE_ACCESS_KEY || process.env.STORAGE_ACCESS_KEY || "",
          secretAccessKey: process.env.RELEASE_STORAGE_SECRET_KEY || process.env.STORAGE_SECRET_KEY || "",
        },
        forcePathStyle: true,
      });
      return { s3, bucket: process.env.RELEASE_STORAGE_BUCKET || "brett-releases" };
    })();
  }
  return _releaseClientPromise;
}

export async function getLatestVersion(): Promise<{ version: string; dmg?: string; artifact?: string; downloads?: { arm64?: string; x64?: string } }> {
  const now = Date.now();
  if (cachedVersion && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedVersion;
  }

  // Short-circuit when no release storage is configured. Without this guard
  // the S3 client falls back to AWS's real endpoints + retry/backoff, which
  // can stall for 10+ seconds in CI before failing — long enough to blow
  // through Vitest's 5s default timeout.
  if (!process.env.RELEASE_STORAGE_ENDPOINT && !process.env.STORAGE_ENDPOINT) {
    return cachedVersion || { version: "0.0.1" };
  }

  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { s3, bucket } = await getReleaseClient();
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: "releases/latest.json" }));

    if (result.Body) {
      const text = await result.Body.transformToString();
      const data = JSON.parse(text) as { version: string; dmg?: string; artifact?: string; downloads?: { arm64?: string; x64?: string } };
      cachedVersion = data;
      lastFetchTime = now;
      return data;
    }
  } catch (err: any) {
    console.warn("[storage-urls] getLatestVersion failed:", err.message ?? err);
  }

  return cachedVersion || { version: "0.0.1" };
}
