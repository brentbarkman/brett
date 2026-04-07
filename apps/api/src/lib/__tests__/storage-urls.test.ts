import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("getStorageUrls", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns proxy URLs based on BETTER_AUTH_URL", async () => {
    process.env.BETTER_AUTH_URL = "https://api.example.com";

    const { getStorageUrls } = await import("../storage-urls.js");
    const urls = getStorageUrls();

    expect(urls.videoBaseUrl).toBe("https://api.example.com/public/videos");
    expect(urls.releasesUrl).toBe("https://api.example.com/releases");
    expect(urls.videoFiles).toHaveLength(9);
    expect(urls.videoFiles[0]).toBe("https://api.example.com/public/videos/login-bg-1.mp4");
    expect(urls.videoFiles[8]).toBe("https://api.example.com/public/videos/login-bg-9.mp4");
  });

  it("falls back to localhost when BETTER_AUTH_URL is not set", async () => {
    delete process.env.BETTER_AUTH_URL;

    const { getStorageUrls } = await import("../storage-urls.js");
    const urls = getStorageUrls();

    expect(urls.videoBaseUrl).toBe("http://localhost:3001/public/videos");
    expect(urls.releasesUrl).toBe("http://localhost:3001/releases");
  });
});

describe("getLatestVersion", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns default version when storage is not configured", async () => {
    delete process.env.RELEASE_STORAGE_ENDPOINT;
    delete process.env.STORAGE_ENDPOINT;

    const { getLatestVersion } = await import("../storage-urls.js");
    const result = await getLatestVersion();

    expect(result.version).toBe("0.0.1");
  });
});
