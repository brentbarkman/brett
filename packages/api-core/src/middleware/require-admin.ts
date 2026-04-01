import { createMiddleware } from "hono/factory";
import type { AuthEnv } from "./auth.js";

export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  const user = c.get("user");
  if (!user || user.role !== "admin") {
    return c.json({ error: "Forbidden: admin access required" }, 403);
  }
  return next();
});
