import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "./auth.js";

const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimiter(maxRequests: number, windowMs: number = 60_000) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const userId = c.get("user").id;
    const now = Date.now();
    let window = windows.get(userId);
    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + windowMs };
      windows.set(userId, window);
    }
    window.count++;
    if (window.count > maxRequests) {
      const retryAfter = Math.ceil((window.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "rate_limited", message: "Too many requests" }, 429);
    }
    return next();
  });
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of windows) {
    if (now > window.resetAt) windows.delete(key);
  }
}, 5 * 60_000).unref();
