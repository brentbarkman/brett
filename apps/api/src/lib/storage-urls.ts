const VIDEO_COUNT = 9;

export function getStorageUrls() {
  const endpoint = process.env.STORAGE_ENDPOINT || "";
  const bucket = process.env.STORAGE_BUCKET || "brett";
  const base = endpoint ? `${endpoint}/${bucket}` : "";

  return {
    releasesUrl: base ? `${base}/releases` : "",
    videoBaseUrl: base ? `${base}/public/videos` : "",
    videoFiles: base
      ? Array.from({ length: VIDEO_COUNT }, (_, i) => `${base}/public/videos/login-bg-${i + 1}.mp4`)
      : [],
  };
}
