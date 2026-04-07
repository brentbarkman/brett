import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../app.js";

// Mock the storage-urls module so tests don't need S3
vi.mock("../lib/storage-urls.js", () => ({
  getStorageUrls: () => ({
    base: "https://api.example.com",
    releaseBaseUrl: "https://api.example.com",
    releasesUrl: "https://api.example.com/releases",
    videoBaseUrl: "https://api.example.com/public/videos",
    videoFiles: [
      "https://api.example.com/public/videos/login-bg-1.mp4",
      "https://api.example.com/public/videos/login-bg-2.mp4",
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

  it("contains a download link pointing to the release proxy", async () => {
    const res = await app.request("/download");
    const html = await res.text();
    expect(html).toContain("https://api.example.com/releases/Brett-1.2.3.zip");
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
    expect(res.status).not.toBe(401);
  });

  it("escapes HTML in version string", async () => {
    const { getLatestVersion } = await import("../lib/storage-urls.js");
    (getLatestVersion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      version: '<script>alert("xss")</script>',
      artifact: "releases/Brett-evil.zip",
    });

    const res = await app.request("/download");
    const html = await res.text();
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
    expect(body.videoBaseUrl).toBe("https://api.example.com/public/videos");
  });

  it("does not require authentication", async () => {
    const res = await app.request("/config");
    expect(res.status).not.toBe(401);
  });

  it("does not expose sensitive storage details", async () => {
    const res = await app.request("/config");
    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain("accessKey");
    expect(bodyStr).not.toContain("secretKey");
  });
});
