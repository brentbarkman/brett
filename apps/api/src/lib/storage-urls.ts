const VIDEO_COUNT = 9;

export function getStorageUrls() {
  const endpoint = process.env.STORAGE_ENDPOINT || "";
  const bucket = process.env.STORAGE_BUCKET || "brett";
  const base = endpoint ? `${endpoint}/${bucket}` : "";

  // Release artifacts live in a separate bucket for credential isolation
  const releaseEndpoint = process.env.RELEASE_STORAGE_ENDPOINT || endpoint;
  const releaseBucket = process.env.RELEASE_STORAGE_BUCKET || "brett-releases";
  const releaseBase = releaseEndpoint ? `${releaseEndpoint}/${releaseBucket}` : "";

  return {
    base,
    releasesUrl: releaseBase ? `${releaseBase}/releases` : "",
    videoBaseUrl: base ? `${base}/public/videos` : "",
    videoFiles: base
      ? Array.from({ length: VIDEO_COUNT }, (_, i) => `${base}/public/videos/login-bg-${i + 1}.mp4`)
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
