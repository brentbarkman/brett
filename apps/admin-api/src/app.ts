import { Hono } from "hono";
import { createBaseApp, requireAdmin } from "@brett/api-core";
import type { AuthEnv } from "@brett/api-core";
import { dashboard } from "./routes/dashboard.js";
import { users } from "./routes/users.js";
import { scouts } from "./routes/scouts.js";
import { aiUsage } from "./routes/ai-usage.js";

const isLocal = !process.env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL.includes("localhost");
const adminFrontendUrl = process.env.ADMIN_FRONTEND_URL || "http://localhost:5174";

const { app, auth, authMiddleware } = createBaseApp({
  trustedOrigins: isLocal
    ? (request?: Request) => {
        const origin = request?.headers.get("origin") ?? "";
        if (/^http:\/\/localhost:\d+$/.test(origin)) return [origin];
        return [];
      }
    : [adminFrontendUrl],
  corsOrigins: isLocal
    ? (origin: string) => {
        if (/^http:\/\/localhost:\d+$/.test(origin)) return origin;
        return null;
      }
    : [adminFrontendUrl],
});

// Mount better-auth handler for /api/auth/*
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// All admin routes require auth + admin role
const adminRoutes = new Hono<AuthEnv>();
adminRoutes.use("*", authMiddleware);
adminRoutes.use("*", requireAdmin);

adminRoutes.route("/dashboard", dashboard);
adminRoutes.route("/users", users);
adminRoutes.route("/scouts", scouts);
adminRoutes.route("/ai", aiUsage);

app.route("/admin", adminRoutes);

export { app };
