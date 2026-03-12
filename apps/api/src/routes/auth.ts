import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { auth } from "../lib/auth.js";

const authRouter = new Hono();

// Desktop OAuth start — renders a page that POSTs to better-auth's social sign-in
// This preserves cookies (state, CSRF) that better-auth sets on the response
authRouter.get("/desktop/google", (c) => {
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

  const baseURL = process.env.BETTER_AUTH_URL || c.req.url;
  const callbackURL = new URL("/api/auth/desktop-callback", baseURL);
  callbackURL.searchParams.set("port", String(portNum));
  callbackURL.searchParams.set("state", state);

  // Render a page that POSTs from the browser — preserves Set-Cookie from better-auth
  const signInURL = new URL("/api/auth/sign-in/social", baseURL).toString();

  return c.html(`<!DOCTYPE html>
<html><head><title>Signing in...</title></head>
<body style="font-family: system-ui; text-align: center; padding: 60px;">
  <p>Redirecting to Google...</p>
  <script>
    fetch(${JSON.stringify(signInURL)}, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "google", callbackURL: ${JSON.stringify(callbackURL.toString())} }),
      credentials: "include"
    })
    .then(r => r.json())
    .then(data => {
      if (data && data.url) window.location.href = data.url;
      else document.body.innerHTML = "<p>Sign-in failed. Please close this tab and try again.</p>";
    })
    .catch(() => {
      document.body.innerHTML = "<p>Sign-in failed. Please close this tab and try again.</p>";
    });
  </script>
</body></html>`);
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
