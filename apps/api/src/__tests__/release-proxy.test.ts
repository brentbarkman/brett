import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { app } from "../app.js";

// Tests exercise the whitelist, not real S3. With storage unconfigured,
// allowed patterns short-circuit to 503 and disallowed patterns get 404
// from the whitelist check — both are observable without network.

describe("GET /releases/*", () => {
  let originalEndpoint: string | undefined;
  let originalStorageEndpoint: string | undefined;

  beforeEach(() => {
    originalEndpoint = process.env.RELEASE_STORAGE_ENDPOINT;
    originalStorageEndpoint = process.env.STORAGE_ENDPOINT;
    delete process.env.RELEASE_STORAGE_ENDPOINT;
    delete process.env.STORAGE_ENDPOINT;
  });

  afterEach(() => {
    if (originalEndpoint !== undefined) process.env.RELEASE_STORAGE_ENDPOINT = originalEndpoint;
    if (originalStorageEndpoint !== undefined) process.env.STORAGE_ENDPOINT = originalStorageEndpoint;
  });

  describe("whitelist — disallowed paths", () => {
    it("rejects path traversal with ..", async () => {
      const res = await app.request("/releases/../../etc/passwd");
      expect(res.status).toBe(404);
    });

    it("rejects URL-encoded traversal", async () => {
      // Hono decodes the path before the handler sees it, so %2E%2E
      // becomes .. and gets caught by the same traversal check.
      const res = await app.request("/releases/%2E%2E/etc/passwd");
      expect(res.status).toBe(404);
    });

    it("rejects non-whitelisted filenames", async () => {
      const res = await app.request("/releases/random.txt");
      expect(res.status).toBe(404);
    });

    it("rejects executable extensions", async () => {
      const res = await app.request("/releases/Brett-1.2.3.exe");
      expect(res.status).toBe(404);
    });

    it("rejects shell scripts", async () => {
      const res = await app.request("/releases/Brett-1.2.3.sh");
      expect(res.status).toBe(404);
    });

    it("rejects nested paths", async () => {
      const res = await app.request("/releases/nested/Brett-1.2.3.dmg");
      expect(res.status).toBe(404);
    });

    it("rejects arbitrary filenames that start with Brett but miss the version", async () => {
      const res = await app.request("/releases/Brett-evil.dmg");
      expect(res.status).toBe(404);
    });

    it("rejects empty key", async () => {
      const res = await app.request("/releases/");
      expect(res.status).toBe(404);
    });
  });

  describe("whitelist — allowed patterns (short-circuit to 503 when unconfigured)", () => {
    // All these should pass the whitelist. Without storage configured they
    // short-circuit to 503 instead of hitting S3. Anything other than 503
    // means the whitelist rejected them — a regression.

    it.each([
      "Brett-1.2.3.dmg",
      "Brett-0.1.950.dmg",
      "Brett-1.2.3-arm64.dmg",
      "Brett-1.2.3-x64.dmg",
      "Brett-1.2.3-mac.zip",
      "Brett-1.2.3-arm64-mac.zip",
      "Brett-1.2.3-x64-mac.zip",
    ])("allows %s", async (filename) => {
      const res = await app.request(`/releases/${filename}`);
      expect(res.status).toBe(503);
    });

    it("allows latest-mac.yml", async () => {
      const res = await app.request("/releases/latest-mac.yml");
      expect(res.status).toBe(503);
    });

    it("allows latest.json", async () => {
      const res = await app.request("/releases/latest.json");
      expect(res.status).toBe(503);
    });
  });
});
