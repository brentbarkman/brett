import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { app } from "../app.js";
import { clearAllRateLimits } from "../middleware/rate-limit.js";

describe("Device registration routes", () => {
  let token: string;
  let userId: string;
  // Use a unique prefix per test run so tokens don't collide across runs
  const nonce = Date.now().toString(36);

  beforeAll(async () => {
    const user = await createTestUser("Device User");
    token = user.token;
    userId = user.userId;
  });

  it("POST /devices/register stores device token (201)", async () => {
    const deviceToken = `apns-${nonce}-abc123`;
    const res = await authRequest("/devices/register", token, {
      method: "POST",
      body: JSON.stringify({
        token: deviceToken,
        platform: "ios",
        appVersion: "1.0.0",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.token).toBe(deviceToken);
    expect(body.platform).toBe("ios");
    expect(body.appVersion).toBe("1.0.0");
    expect(body.userId).toBe(userId);
  });

  it("POST /devices/register is idempotent — same token updates version (200)", async () => {
    const deviceToken = `apns-${nonce}-abc123`;
    const res = await authRequest("/devices/register", token, {
      method: "POST",
      body: JSON.stringify({
        token: deviceToken,
        platform: "ios",
        appVersion: "1.1.0",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.appVersion).toBe("1.1.0");
  });

  it("POST /devices/register rejects invalid platform (400)", async () => {
    const res = await authRequest("/devices/register", token, {
      method: "POST",
      body: JSON.stringify({
        token: `reject-${nonce}`,
        platform: "windows",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
  });

  it("POST /devices/register rejects missing token (400)", async () => {
    const res = await authRequest("/devices/register", token, {
      method: "POST",
      body: JSON.stringify({
        platform: "ios",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /devices/register rejects empty token (400)", async () => {
    const res = await authRequest("/devices/register", token, {
      method: "POST",
      body: JSON.stringify({
        token: "",
        platform: "ios",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /devices/unregister removes token (200)", async () => {
    const deviceToken = `apns-${nonce}-to-delete`;
    // First register a token to remove
    await authRequest("/devices/register", token, {
      method: "POST",
      body: JSON.stringify({
        token: deviceToken,
        platform: "ios",
      }),
    });

    const res = await authRequest("/devices/unregister", token, {
      method: "DELETE",
      body: JSON.stringify({ token: deviceToken }),
    });
    expect(res.status).toBe(200);
  });

  it("DELETE /devices/unregister is idempotent — already removed (200)", async () => {
    const res = await authRequest("/devices/unregister", token, {
      method: "DELETE",
      body: JSON.stringify({ token: `nonexistent-${nonce}` }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /devices/register caps at 10 devices per user (400)", async () => {
    const capUser = await createTestUser("Cap User");
    // Clear rate limits so all 11 requests succeed without hitting the per-user rate limit
    clearAllRateLimits();

    // Register 10 tokens
    for (let i = 0; i < 10; i++) {
      const res = await authRequest("/devices/register", capUser.token, {
        method: "POST",
        body: JSON.stringify({
          token: `cap-${nonce}-${i}`,
          platform: "ios",
        }),
      });
      expect(res.status).toBe(201);
    }

    // Clear rate limits again before the 11th request — we used up the 10-req budget
    clearAllRateLimits();

    // 11th should fail (device cap, not rate limit)
    const res = await authRequest("/devices/register", capUser.token, {
      method: "POST",
      body: JSON.stringify({
        token: `cap-${nonce}-overflow`,
        platform: "ios",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toContain("max");
  });

  it("unauthenticated request returns 401", async () => {
    const res = await app.request("/devices/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: `unauth-${nonce}`,
        platform: "ios",
      }),
    });
    expect(res.status).toBe(401);
  });
});
