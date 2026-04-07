import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../app.js";

// Mock the storage-urls module so tests don't need S3
vi.mock("../lib/storage-urls.js", () => ({
  getStorageUrls: () => ({
    base: "https://storage.example.com/brett-public",
    releaseBaseUrl: "https://storage.example.com/brett-releases",
    releasesUrl: "https://storage.example.com/brett-releases/releases",
    videoBaseUrl: "https://storage.example.com/brett-public/videos",
    videoFiles: [
      "https://storage.example.com/brett-public/videos/login-bg-1.mp4",
      "https://storage.example.com/brett-public/videos/login-bg-2.mp4",
    ],
  }),
  getLatestVersion: vi.fn().mockResolvedValue({ version: "1.2.3", artifact: "releases/Brett-1.2.3.zip" }),
}));

describe("GET /download", () => {
  it("returns 200 with HTML content", async () => {
    const res = await app.request("/download");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("contains the app name and tagline", async () => {
    const res = await app.request("/download");
    const html = await res.text();
    expect(html).toContain("Brett");
    expect(html).toContain("Your day, handled.");
  });

  it("contains the correct version from latest.json", async () => {
    const res = await app.request("/download");
    const html = await res.text();
    expect(html).toContain("v1.2.3");
  });

  it("contains a download link pointing to the artifact", async () => {
    const res = await app.request("/download");
    const html = await res.text();
    expect(html).toContain("https://storage.example.com/brett-releases/releases/Brett-1.2.3.zip");
    expect(html).toContain("Download for macOS");
  });

  it("contains video URLs in the script", async () => {
    const res = await app.request("/download");
    const html = await res.text();
    expect(html).toContain("login-bg-1.mp4");
    expect(html).toContain("login-bg-2.mp4");
  });

  it("does not require authentication", async () => {
    const res = await app.request("/download");
    // Should not return 401
    expect(res.status).not.toBe(401);
  });

  it("escapes HTML in version string", async () => {
    const { getLatestVersion } = await import("../lib/storage-urls.js");
    (getLatestVersion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      version: '<script>alert("xss")</script>',
      dmg: "releases/Brett-evil.dmg",
    });

    const res = await app.request("/download");
    const html = await res.text();
    // Should be escaped, not raw
    expect(html).not.toContain('<script>alert("xss")</script>');
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("GET /config", () => {
  it("returns 200 with JSON", async () => {
    const res = await app.request("/config");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("returns videoBaseUrl", async () => {
    const res = await app.request("/config");
    const body = await res.json();
    expect(body).toHaveProperty("videoBaseUrl");
    expect(body.videoBaseUrl).toBe("https://storage.example.com/brett-public/videos");
  });

  it("does not require authentication", async () => {
    const res = await app.request("/config");
    expect(res.status).not.toBe(401);
  });

  it("does not expose sensitive storage details", async () => {
    const res = await app.request("/config");
    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    // Should not contain credentials or bucket internals
    expect(bodyStr).not.toContain("accessKey");
    expect(bodyStr).not.toContain("secretKey");
    expect(bodyStr).not.toContain("releases");
  });
});
