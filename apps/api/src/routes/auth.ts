import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { auth } from "../lib/auth.js";

const authRouter = new Hono();

// Desktop OAuth callback — extracts session token and redirects to local Electron server
authRouter.get("/desktop-callback", (c) => {
  const sessionToken = getCookie(c, "better-auth.session_token");
  const port = c.req.query("port");
  const state = c.req.query("state");

  if (!sessionToken) {
    return c.text("Authentication failed — no session token", 401);
  }
  if (!port || !state) {
    return c.text("Missing port or state parameter", 400);
  }

  // Only allow redirect to localhost
  const redirectURL = `http://127.0.0.1:${encodeURIComponent(port)}/callback?token=${encodeURIComponent(sessionToken)}&state=${encodeURIComponent(state)}`;
  return c.redirect(redirectURL);
});

// Mount better-auth handler — handles all /api/auth/* routes
authRouter.on(["POST", "GET"], "/*", (c) => auth.handler(c.req.raw));

export { authRouter };
