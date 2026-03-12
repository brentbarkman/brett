import crypto from "crypto";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { auth } from "../lib/auth.js";

const authRouter = new Hono();

// Sign the desktop OAuth state to prevent forgery
const AUTH_SECRET = process.env.BETTER_AUTH_SECRET || "";

function signState(state: string, port: number): string {
  return crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(`${state}:${port}`)
    .digest("hex");
}

// Desktop OAuth start — renders a page that POSTs to better-auth's social sign-in
// This preserves cookies (state, CSRF) that better-auth sets on the response
authRouter.get("/desktop/google", (c) => {
  const port = c.req.query("port");
  const state = c.req.query("state");

  if (!port || !state) {
    return c.text("Missing port or state parameter", 400);
  }

  // Validate port is numeric and in valid range
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
    return c.text("Invalid port", 400);
  }

  const baseURL = process.env.BETTER_AUTH_URL || c.req.url;
  const callbackURL = new URL("/api/auth/desktop-callback", baseURL);
  callbackURL.searchParams.set("port", String(portNum));
  callbackURL.searchParams.set("state", state);
  // Attach HMAC signature so desktop-callback can verify this flow was initiated here
  callbackURL.searchParams.set("sig", signState(state, portNum));

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
  // In production with HTTPS, better-auth uses __Secure- prefix
  const sessionToken =
    getCookie(c, "__Secure-better-auth.session_token") ||
    getCookie(c, "better-auth.session_token");
  const port = c.req.query("port");
  const state = c.req.query("state");
  const sig = c.req.query("sig");

  if (!sessionToken) {
    return c.text("Authentication failed — no session token", 401);
  }
  if (!port || !state || !sig) {
    return c.text("Missing required parameters", 400);
  }

  // Validate port is numeric and in valid range
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
    return c.text("Invalid port", 400);
  }

  // Verify HMAC signature — ensures this callback was initiated by /desktop/google
  const expectedSig = signState(state, portNum);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return c.text("Invalid signature", 403);
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
