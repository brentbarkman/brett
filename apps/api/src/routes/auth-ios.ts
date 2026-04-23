import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { extractClientIp, ipRateLimiter } from "../middleware/rate-limit.js";
import { getIOSGoogleVerifier } from "../lib/ios-google-verifier.js";
import {
  signInWithIOSGoogleIdToken,
  IOSGoogleSignInError,
} from "../lib/ios-google-signin.js";

/**
 * Native-mobile Google sign-in routes.
 *
 * The iOS app drives Google OAuth locally with the GoogleSignIn-iOS SDK
 * (token + nonce + PKCE handled on-device), then POSTs the resulting
 * idToken here to exchange it for a Brett session bearer token.
 *
 * This is intentionally separate from `/api/auth/sign-in/social` because
 * better-auth's social flow owns the OAuth dance end-to-end and rejects
 * idTokens minted with an audience other than its own web clientId.
 * Mobile SDKs can't use that — they get tokens with `aud = iOS client ID`.
 */
export const authIOS = new Hono();

// 10 attempts / 60s per IP. Matches /sign-in/email. Higher-volume abuse
// should be detected at the infra layer (Railway / Cloudflare) too.
authIOS.post("/google/token", ipRateLimiter(10, 60_000), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as Record<string, unknown>).idToken !== "string"
  ) {
    return c.json({ error: "missing_id_token" }, 400);
  }
  const idToken = (body as { idToken: string }).idToken;

  // Basic shape sanity — a real Google idToken is a JWT (three base64 segments
  // separated by `.`). Reject anything obviously wrong before hitting the
  // JWKS endpoint. Saves a network round-trip on attacker noise.
  if (idToken.length < 100 || idToken.split(".").length !== 3) {
    return c.json({ error: "invalid_id_token" }, 401);
  }

  let verifier;
  try {
    verifier = getIOSGoogleVerifier();
  } catch (err) {
    // Misconfiguration (GOOGLE_IOS_CLIENT_ID unset) — surface as 503 so the
    // client knows this isn't their fault. Log server-side so we notice.
    console.error("[auth-ios] verifier unavailable:", err);
    return c.json({ error: "ios_google_not_configured" }, 503);
  }

  try {
    const clientIp = extractClientIp(c.req.header("x-forwarded-for"));
    const result = await signInWithIOSGoogleIdToken({
      idToken,
      verifier,
      prisma,
      ipAddress: clientIp === "unknown" ? null : clientIp,
      userAgent: c.req.header("user-agent") ?? null,
    });

    return c.json({
      token: result.token,
      user: result.user,
      outcome: result.outcome,
    });
  } catch (err) {
    if (err instanceof IOSGoogleSignInError) {
      // 401 for anything auth-related — don't distinguish between "invalid
      // token" and "linking refused" to the client. Server logs keep the
      // signal for ops.
      console.warn(
        "[auth-ios] sign-in rejected:",
        err.code,
        err.message,
      );
      return c.json({ error: err.code }, 401);
    }
    console.error("[auth-ios] unexpected failure:", err);
    return c.json({ error: "internal_error" }, 500);
  }
});
