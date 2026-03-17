import { vi, describe, it, expect, beforeAll } from "vitest";

// Mock S3 before any imports that touch storage
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: vi.fn().mockResolvedValue({}) })),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://fake-presigned-url.com/file"),
}));

import { createTestUser, authRequest } from "./helpers.js";

describe("Attachment routes", () => {
  let token: string;
  let itemId: string;

  beforeAll(async () => {
    const user = await createTestUser("Attachment User");
    token = user.token;
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Attachment test" }),
    });
    itemId = ((await res.json()) as any).id;
  });

  it("POST /things/:id/attachments rejects files over 25MB", async () => {
    const res = await authRequest(`/things/${itemId}/attachments`, token, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Filename": "big.txt",
        "Content-Length": String(26 * 1024 * 1024),
      },
      body: "small body",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toContain("too large");
  });

  it("POST /things/:id/attachments rejects non-existent item", async () => {
    const res = await authRequest("/things/nonexistent/attachments", token, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Filename": "test.txt" },
      body: "hello",
    });
    expect(res.status).toBe(404);
  });

  it("POST /things/:id/attachments uploads a file", async () => {
    const res = await authRequest(`/things/${itemId}/attachments`, token, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Filename": "test.txt" },
      body: "hello world",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.filename).toBe("test.txt");
    expect(body.mimeType).toBe("text/plain");
    expect(body.sizeBytes).toBeGreaterThan(0);
  });

  it("DELETE /things/:id/attachments/:attachmentId returns 404 for non-existent", async () => {
    const res = await authRequest(`/things/${itemId}/attachments/nonexistent`, token, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("sanitizes path traversal in filename", async () => {
    const res = await authRequest(`/things/${itemId}/attachments`, token, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Filename": "../../../etc/passwd",
      },
      body: "test",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    // Filename should be sanitized — no path traversal
    expect(body.filename).not.toContain("..");
    expect(body.filename).not.toContain("/");
  });

  it("cross-user cannot upload to another user's item", async () => {
    const user2 = await createTestUser("Attachment User 2");
    const res = await authRequest(`/things/${itemId}/attachments`, user2.token, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-Filename": "test.txt" },
      body: "hello",
    });
    expect(res.status).toBe(404);
  });
});
