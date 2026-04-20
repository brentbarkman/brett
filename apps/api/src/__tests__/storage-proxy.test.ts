import { vi, describe, it, expect } from "vitest";

// Mock S3 before importing app so the proxy's GetObjectCommand resolves
// to a fake body without hitting the network.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockImplementation(async () => ({
      Body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
          controller.close();
        },
      }),
      ContentLength: 4,
    })),
  })),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://fake-presigned-url.com/file"),
}));

import { app } from "../app.js";

describe("GET /public/*", () => {
  describe("allowed prefixes", () => {
    it("serves videos/ keys", async () => {
      const res = await app.request("/public/videos/login-bg-1.mp4");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("video/mp4");
    });

    it("serves backgrounds/ keys", async () => {
      const res = await app.request("/public/backgrounds/default.webp");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/webp");
    });

    it("serves feedback/ keys (screenshot URLs in GitHub Issues)", async () => {
      // Feedback route uploads screenshots under feedback/<hex>.png and
      // renders <img> tags pointing at /public/feedback/*. GitHub fetches
      // those URLs to inline screenshots in bug reports.
      const res = await app.request("/public/feedback/abc123def456.png");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/png");
    });
  });

  describe("rejections", () => {
    it("rejects non-allowlisted prefixes", async () => {
      const res = await app.request("/public/attachments/secret.pdf");
      expect(res.status).toBe(404);
    });

    it("rejects empty key", async () => {
      const res = await app.request("/public/");
      expect(res.status).toBe(404);
    });

    it("rejects keys containing ..", async () => {
      // Hono decodes URL-encoded paths before the handler runs, so
      // %2E%2E also lands here as literal "..".
      const res = await app.request("/public/videos/../../etc/passwd");
      expect(res.status).toBe(404);
    });
  });

  describe("caching", () => {
    it("sets long Cache-Control on allowed responses", async () => {
      const res = await app.request("/public/videos/login-bg-1.mp4");
      expect(res.headers.get("Cache-Control")).toContain("max-age=86400");
    });
  });
});
