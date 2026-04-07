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

  it("returns correct URLs with PUBLIC_STORAGE_BUCKET set", async () => {
    process.env.STORAGE_ENDPOINT = "https://storage.example.com";
    process.env.PUBLIC_STORAGE_BUCKET = "my-public";

    const { getStorageUrls } = await import("../storage-urls.js");
    const urls = getStorageUrls();

    expect(urls.videoBaseUrl).toBe("https://storage.example.com/my-public/public/videos");
    expect(urls.videoFiles).toHaveLength(9);
    expect(urls.videoFiles[0]).toBe("https://storage.example.com/my-public/public/videos/login-bg-1.mp4");
    expect(urls.videoFiles[8]).toBe("https://storage.example.com/my-public/public/videos/login-bg-9.mp4");
    // Releases use separate bucket
    expect(urls.releasesUrl).toBe("https://storage.example.com/brett-releases/releases");
  });

  it("uses release-specific bucket when RELEASE_STORAGE_* vars are set", async () => {
    process.env.STORAGE_ENDPOINT = "https://storage.example.com";
    process.env.RELEASE_STORAGE_ENDPOINT = "https://releases.example.com";
    process.env.RELEASE_STORAGE_BUCKET = "my-releases";

    const { getStorageUrls } = await import("../storage-urls.js");
    const urls = getStorageUrls();

    expect(urls.releasesUrl).toBe("https://releases.example.com/my-releases/releases");
  });

  it("uses default bucket names when env vars are not set", async () => {
    process.env.STORAGE_ENDPOINT = "https://storage.example.com";
    delete process.env.PUBLIC_STORAGE_BUCKET;

    const { getStorageUrls } = await import("../storage-urls.js");
    const urls = getStorageUrls();

    expect(urls.videoBaseUrl).toBe("https://storage.example.com/brett-public/public/videos");
    expect(urls.releasesUrl).toBe("https://storage.example.com/brett-releases/releases");
  });

  it("returns empty strings when STORAGE_ENDPOINT is not set", async () => {
    delete process.env.STORAGE_ENDPOINT;

    const { getStorageUrls } = await import("../storage-urls.js");
    const urls = getStorageUrls();

    expect(urls.releasesUrl).toBe("");
    expect(urls.videoBaseUrl).toBe("");
    expect(urls.videoFiles).toEqual([]);
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

  it("returns default version when STORAGE_ENDPOINT is not set", async () => {
    delete process.env.STORAGE_ENDPOINT;

    const { getLatestVersion } = await import("../storage-urls.js");
    const result = await getLatestVersion();

    expect(result.version).toBe("0.0.1");
    expect(result.dmg).toBe("");
  });

  it("fetches from release bucket", async () => {
    process.env.STORAGE_ENDPOINT = "https://storage.example.com";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "2.0.0", dmg: "releases/Brett-2.0.0.dmg" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { getLatestVersion } = await import("../storage-urls.js");
    const result = await getLatestVersion();

    expect(result.version).toBe("2.0.0");
    expect(result.dmg).toBe("releases/Brett-2.0.0.dmg");
    expect(mockFetch).toHaveBeenCalledWith("https://storage.example.com/brett-releases/releases/latest.json");
  });

  it("returns default version when S3 fetch fails", async () => {
    process.env.STORAGE_ENDPOINT = "https://storage.example.com";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const { getLatestVersion } = await import("../storage-urls.js");
    const result = await getLatestVersion();

    expect(result.version).toBe("0.0.1");
  });
});
