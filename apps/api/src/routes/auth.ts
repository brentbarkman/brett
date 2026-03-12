import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { auth } from "../lib/auth.js";

const authRouter = new Hono();

// Desktop OAuth callback — extracts session token and redirects to deep link
authRouter.get("/desktop-callback", (c) => {
  const sessionToken = getCookie(c, "better-auth.session_token");
  if (!sessionToken) {
    return c.text("Authentication failed — no session token", 401);
  }
  return c.redirect(`brett://auth/callback?token=${encodeURIComponent(sessionToken)}`);
});

// Mount better-auth handler — handles all /api/auth/* routes
authRouter.on(["POST", "GET"], "/*", (c) => auth.handler(c.req.raw));

export { authRouter };
