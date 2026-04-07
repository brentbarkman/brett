const VIDEO_COUNT = 9;

export function getStorageUrls() {
  // Each bucket has its own endpoint in Railway. Fall back to generic STORAGE_ENDPOINT for local dev.
  const fallbackEndpoint = process.env.STORAGE_ENDPOINT || "";

  // Public assets (videos, backgrounds) — anonymous read access
  const publicEndpoint = process.env.PUBLIC_STORAGE_ENDPOINT || fallbackEndpoint;
  const publicBucket = process.env.PUBLIC_STORAGE_BUCKET || "brett-public";
  const publicBase = publicEndpoint ? `${publicEndpoint}/${publicBucket}` : "";

  // Release artifacts — separate bucket, separate credentials
  const releaseEndpoint = process.env.RELEASE_STORAGE_ENDPOINT || fallbackEndpoint;
  const releaseBucket = process.env.RELEASE_STORAGE_BUCKET || "brett-releases";
  const releaseBase = releaseEndpoint ? `${releaseEndpoint}/${releaseBucket}` : "";

  return {
    base: publicBase,
    releaseBaseUrl: releaseBase,
    releasesUrl: releaseBase ? `${releaseBase}/releases` : "",
    videoBaseUrl: publicBase ? `${publicBase}/public/videos` : "",
    videoFiles: publicBase
      ? Array.from({ length: VIDEO_COUNT }, (_, i) => `${publicBase}/public/videos/login-bg-${i + 1}.mp4`)
      : [],
  };
}

// Cached latest version from S3
let cachedVersion: { version: string; dmg?: string; artifact?: string } | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getLatestVersion(): Promise<{ version: string; dmg?: string; artifact?: string }> {
  const now = Date.now();
  if (cachedVersion && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedVersion;
  }

  const { releasesUrl } = getStorageUrls();
  if (!releasesUrl) {
    return { version: "0.0.1", dmg: "" };
  }

  try {
    const res = await fetch(`${releasesUrl}/latest.json`);
    if (res.ok) {
      const data = await res.json() as { version: string; dmg?: string; artifact?: string };
      cachedVersion = data;
      lastFetchTime = now;
      return data;
    }
  } catch {
    // Fall through to cached or default
  }

  return cachedVersion || { version: "0.0.1", dmg: "" };
}
