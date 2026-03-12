import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { auth } from "../lib/auth.js";

const authRouter = new Hono();

// Desktop OAuth start — initiates Google OAuth via GET (browser-friendly)
authRouter.get("/desktop/google", async (c) => {
  const port = c.req.query("port");
  const state = c.req.query("state");

  if (!port || !state) {
    return c.text("Missing port or state parameter", 400);
  }

  // Call better-auth's social sign-in internally with callback pointing to our desktop-callback
  const callbackURL = new URL("/api/auth/desktop-callback", c.req.url);
  callbackURL.searchParams.set("port", port);
  callbackURL.searchParams.set("state", state);

  const response = await auth.api.signInSocial({
    body: {
      provider: "google",
      callbackURL: callbackURL.toString(),
    },
  });

  if (response?.url) {
    return c.redirect(response.url);
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
