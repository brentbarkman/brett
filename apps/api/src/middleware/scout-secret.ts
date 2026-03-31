import crypto from "node:crypto";
import { createMiddleware } from "hono/factory";

export function requireSecret(envVar: string) {
  return createMiddleware(async (c, next) => {
    const secret = c.req.header("x-scout-secret") ?? "";
    const expected = process.env[envVar] ?? "";
    if (!expected) return c.json({ error: "Unauthorized" }, 401);

    const h1 = crypto.createHash("sha256").update(secret).digest();
    const h2 = crypto.createHash("sha256").update(expected).digest();
    if (!crypto.timingSafeEqual(h1, h2)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });
}
