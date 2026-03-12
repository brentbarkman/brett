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

  // #1: Validate port is numeric and in valid range
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
    return c.text("Invalid port", 400);
  }

  const callbackURL = new URL("/api/auth/desktop-callback", c.req.url);
  callbackURL.searchParams.set("port", String(portNum));
  callbackURL.searchParams.set("state", state);

  // #7: Internally POST to better-auth with explicit Content-Type
  const url = new URL("/api/auth/sign-in/social", c.req.url);
  const headers = new Headers(c.req.raw.headers);
  headers.set("Content-Type", "application/json");

  const internalReq = new Request(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify({
      provider: "google",
      callbackURL: callbackURL.toString(),
    }),
  });

  const response = await auth.handler(internalReq);

  // better-auth may return a redirect (302) or JSON with { url }
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("Location");
    if (location) {
      return c.redirect(location);
    }
  }

  if (response.ok) {
    const data = await response.json() as { url?: string; redirect?: boolean };
    if (data.url) {
      return c.redirect(data.url);
    }
  }

  const body = await response.text().catch(() => "no body");
  console.error("Desktop OAuth failed:", response.status, body);
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

  // #1: Validate port is numeric and in valid range
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
    return c.text("Invalid port", 400);
  }

  // Build redirect URL safely — only allow localhost
  const redirectURL = new URL(`http://127.0.0.1:${portNum}/callback`);
  redirectURL.searchParams.set("token", sessionToken);
  redirectURL.searchParams.set("state", state);
  return c.redirect(redirectURL.toString());
});

// Mount better-auth handler — handles all /api/auth/* routes
authRouter.on(["POST", "GET"], "/*", (c) => auth.handler(c.req.raw));

export { authRouter };
