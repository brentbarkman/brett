import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { auth } from "../lib/auth.js";

const authRouter = new Hono();

// Desktop OAuth start — initiates Google OAuth via GET for browser redirect
authRouter.get("/desktop/google", async (c) => {
  const port = c.req.query("port");
  const state = c.req.query("state");

  if (!port || !state) {
    return c.text("Missing port or state parameter", 400);
  }

  const callbackURL = new URL("/api/auth/desktop-callback", c.req.url);
  callbackURL.searchParams.set("port", port);
  callbackURL.searchParams.set("state", state);

  // Internally POST to better-auth's social sign-in with the real request context
  const url = new URL("/api/auth/sign-in/social", c.req.url);
  const internalReq = new Request(url.toString(), {
    method: "POST",
    headers: c.req.raw.headers,
    body: JSON.stringify({
      provider: "google",
      callbackURL: callbackURL.toString(),
    }),
  });

  const response = await auth.handler(internalReq);

  // better-auth returns a JSON response with { url, redirect } for social sign-in
  if (response.ok) {
    const data = await response.json() as { url?: string; redirect?: boolean };
    if (data.url) {
      return c.redirect(data.url);
    }
  }

  return c.text("Failed to initiate Google sign-in", 500);
});

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
