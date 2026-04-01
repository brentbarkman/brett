import { createMiddleware } from "hono/factory";
import type { Auth } from "../auth.js";

export type AuthEnv = {
  Variables: {
    user: { id: string; email: string; name: string; image: string | null; role: "user" | "admin"; banned: boolean };
    session: { id: string; token: string; userId: string; expiresAt: Date };
  };
};

export function createAuthMiddleware(auth: Auth) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const user = session.user as unknown as AuthEnv["Variables"]["user"];

    // Reject banned users at the auth layer
    if (user.banned) {
      return c.json({ error: "Account suspended" }, 403);
    }

    c.set("user", user);
    c.set("session", session.session as unknown as AuthEnv["Variables"]["session"]);

    return next();
  });
}
