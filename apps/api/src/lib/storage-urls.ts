const VIDEO_COUNT = 9;

export function getStorageUrls() {
  const endpoint = process.env.STORAGE_ENDPOINT || "";

  // Public assets (videos, backgrounds) — anonymous read access
  const publicBucket = process.env.PUBLIC_STORAGE_BUCKET || "brett-public";
  const publicBase = endpoint ? `${endpoint}/${publicBucket}` : "";

  // Release artifacts — separate bucket, separate credentials
  const releaseEndpoint = process.env.RELEASE_STORAGE_ENDPOINT || endpoint;
  const releaseBucket = process.env.RELEASE_STORAGE_BUCKET || "brett-releases";
  const releaseBase = releaseEndpoint ? `${releaseEndpoint}/${releaseBucket}` : "";

  return {
    base: publicBase,
    releasesUrl: releaseBase ? `${releaseBase}/releases` : "",
    videoBaseUrl: publicBase ? `${publicBase}/videos` : "",
    videoFiles: publicBase
      ? Array.from({ length: VIDEO_COUNT }, (_, i) => `${publicBase}/videos/login-bg-${i + 1}.mp4`)
      : [],
  };
}

// Cached latest version from S3
let cachedVersion: { version: string; dmg: string } | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getLatestVersion(): Promise<{ version: string; dmg: string }> {
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
      const data = await res.json() as { version: string; dmg: string };
      cachedVersion = data;
      lastFetchTime = now;
      return data;
    }
  } catch {
    // Fall through to cached or default
  }

  return cachedVersion || { version: "0.0.1", dmg: "" };
}
