import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { rateLimiter, extractClientIp } from "../middleware/rate-limit.js";

// Build a tiny Hono app with the rate limiter for testing.
// We mock the auth user by setting it in middleware before the rate limiter.

function createTestApp(maxRequests: number, windowMs: number = 60_000) {
  const app = new Hono<{
    Variables: { user: { id: string } };
  }>();

  // Inject a mock user before the rate limiter runs
  app.use("*", async (c, next) => {
    const userId = c.req.header("X-Test-User-Id") || "user-1";
    c.set("user", { id: userId } as any);
    return next();
  });

  app.use("*", rateLimiter(maxRequests, windowMs) as any);

  app.get("/test", (c) => c.json({ ok: true }));

  return app;
}

describe("rateLimiter", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    // Each test gets a fresh app. The rate limiter uses a module-level Map,
    // but different user IDs per test effectively isolate them.
    app = createTestApp(3, 60_000);
  });

  it("allows requests under the limit", async () => {
    const uid = `under-${Date.now()}`;
    const res = await app.request("/test", {
      headers: { "X-Test-User-Id": uid },
    });
    expect(res.status).toBe(200);
  });

  it("allows requests at exactly the limit", async () => {
    const uid = `at-limit-${Date.now()}`;
    const headers = { "X-Test-User-Id": uid };

    // Requests 1, 2, 3 should all pass
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/test", { headers });
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 with Retry-After when over the limit", async () => {
    const uid = `over-limit-${Date.now()}`;
    const headers = { "X-Test-User-Id": uid };

    // Use up the limit
    for (let i = 0; i < 3; i++) {
      await app.request("/test", { headers });
    }

    // 4th request should be rate limited
    const res = await app.request("/test", { headers });
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.error).toBe("rate_limited");

    const retryAfter = res.headers.get("Retry-After");
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it("resets counter after window expires", async () => {
    // Use a very short window (1ms) so it expires immediately
    const shortApp = createTestApp(1, 1);
    const uid = `reset-${Date.now()}`;
    const headers = { "X-Test-User-Id": uid };

    // First request passes
    const res1 = await shortApp.request("/test", { headers });
    expect(res1.status).toBe(200);

    // Wait for the window to expire
    await new Promise((r) => setTimeout(r, 5));

    // After window expires, the counter resets
    const res2 = await shortApp.request("/test", { headers });
    expect(res2.status).toBe(200);
  });

  it("tracks different users in separate windows", async () => {
    const uid1 = `user-a-${Date.now()}`;
    const uid2 = `user-b-${Date.now()}`;

    // Exhaust user A's limit
    for (let i = 0; i < 3; i++) {
      await app.request("/test", {
        headers: { "X-Test-User-Id": uid1 },
      });
    }

    // User A is rate limited
    const resA = await app.request("/test", {
      headers: { "X-Test-User-Id": uid1 },
    });
    expect(resA.status).toBe(429);

    // User B still has their full window
    const resB = await app.request("/test", {
      headers: { "X-Test-User-Id": uid2 },
    });
    expect(resB.status).toBe(200);
  });
});

describe("extractClientIp", () => {
  it("returns 'unknown' for missing header", () => {
    expect(extractClientIp(undefined)).toBe("unknown");
    expect(extractClientIp("")).toBe("unknown");
  });

  it("returns the only entry when there's one hop", () => {
    expect(extractClientIp("203.0.113.5")).toBe("203.0.113.5");
  });

  it("trusts the right-most entry — not the client-supplied left", () => {
    // Railway / other trusted proxies APPEND the real client IP, so the
    // right-most is the least-spoofable. The left entry is a value the
    // client sent themselves and can be forged.
    expect(extractClientIp("1.2.3.4, 5.6.7.8, 203.0.113.5")).toBe("203.0.113.5");
  });

  it("handles whitespace and empty entries", () => {
    expect(extractClientIp("  1.2.3.4 ,  , 203.0.113.5  ")).toBe("203.0.113.5");
  });

  it("does not let the client spoof the left-most entry to poison rate-limit keys", () => {
    // If a malicious client sets X-Forwarded-For: "victim.ip", the proxy
    // appends the real IP, yielding "victim.ip, real.ip". We must take
    // real.ip, not victim.ip.
    const spoofed = "1.1.1.1, 198.51.100.7";
    expect(extractClientIp(spoofed)).toBe("198.51.100.7");
    expect(extractClientIp(spoofed)).not.toBe("1.1.1.1");
  });
});
