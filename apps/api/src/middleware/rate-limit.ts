import type { Context, Env } from "hono";
import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "./auth.js";

type Window = { count: number; resetAt: number };
const allMaps: Map<string, Window>[] = [];

function createLimiter<E extends Env>(
  extractKey: (c: Context<E>) => string,
  maxRequests: number,
  windowMs: number,
) {
  const windows = new Map<string, Window>();
  allMaps.push(windows);

  return createMiddleware<E>(async (c, next) => {
    const key = extractKey(c as Context<E>);
    const now = Date.now();
    let window = windows.get(key);
    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + windowMs };
      windows.set(key, window);
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

/** Rate limiter keyed by authenticated user ID. */
export function rateLimiter(maxRequests: number, windowMs: number = 60_000) {
  return createLimiter<AuthEnv>((c) => c.get("user").id, maxRequests, windowMs);
}

/** Rate limiter keyed by client IP. Use for unauthenticated routes (login, sign-up). */
export function ipRateLimiter(maxRequests: number, windowMs: number = 60_000) {
  return createLimiter<Env>(
    // x-forwarded-for from Railway's reverse proxy, fall back to remote address
    (c) => c.req.header("x-forwarded-for")?.split(",")[0].trim() || "unknown",
    maxRequests,
    windowMs,
  );
}

/** Clear all rate limit windows. Used by tests to prevent cross-test rate limiting. */
export function clearAllRateLimits(): void {
  for (const map of allMaps) map.clear();
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const map of allMaps) {
    for (const [key, window] of map) {
      if (now > window.resetAt) map.delete(key);
    }
  }
}, 5 * 60_000).unref();
