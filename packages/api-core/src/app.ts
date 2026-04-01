import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth, type AuthOptions } from "./auth.js";
import { createAuthMiddleware, type AuthEnv } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";

export interface BaseAppOptions {
  trustedOrigins: AuthOptions["trustedOrigins"];
  corsOrigins: string[] | ((origin: string) => string | null);
  enableEmailPassword?: boolean;
  enableDeleteUser?: boolean;
  enablePasskeys?: boolean;
}

export function createBaseApp(options: BaseAppOptions) {
  const auth = createAuth({
    trustedOrigins: options.trustedOrigins,
    enableEmailPassword: options.enableEmailPassword,
    enableDeleteUser: options.enableDeleteUser,
    enablePasskeys: options.enablePasskeys,
  });
  const authMiddleware = createAuthMiddleware(auth);

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: typeof options.corsOrigins === "function"
        ? options.corsOrigins
        : (origin) => {
            if ((options.corsOrigins as string[]).includes(origin)) return origin;
            return null;
          },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    })
  );

  app.onError(errorHandler);

  app.get("/health", (c) => c.json({ status: "ok" }));

  return { app, auth, authMiddleware };
}
