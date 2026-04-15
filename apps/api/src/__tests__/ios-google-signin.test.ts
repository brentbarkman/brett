/**
 * Tests for iOS Google Sign-In — the server-side idToken verifier and the
 * three sign-in paths (existing-account / link-by-email / fresh-create).
 *
 * Uses a fake verifier so we never call out to Google's JWKS. Prisma is the
 * real one (requires Postgres running) so the account-linking / session
 * creation / transactional behaviour is covered end-to-end.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import { generateId } from "@brett/utils";
import {
  signInWithIOSGoogleIdToken,
  IOSGoogleSignInError,
} from "../lib/ios-google-signin.js";
import type {
  IOSGoogleClaims,
  IOSGoogleVerifier,
} from "../lib/ios-google-verifier.js";
import { app } from "../app.js";

// ---------------------------------------------------------------------------
// Fake verifier — caller supplies the claims the "token" resolves to.
// ---------------------------------------------------------------------------

class FakeVerifier implements IOSGoogleVerifier {
  constructor(
    private claims: IOSGoogleClaims | null,
    private error?: Error,
  ) {}
  async verify(): Promise<IOSGoogleClaims> {
    if (this.error) throw this.error;
    if (!this.claims) throw new Error("no_claims_configured");
    return this.claims;
  }
}

// Stable random suffix per run so tests can be re-run without collisions
// (sub values and emails need to be unique per-test).
function uniq(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function cleanupUserByEmail(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.account.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

// ---------------------------------------------------------------------------
// signInWithIOSGoogleIdToken — unit tests using real Prisma
// ---------------------------------------------------------------------------

describe("signInWithIOSGoogleIdToken", () => {
  it("creates a brand-new user + account + session when nothing matches", async () => {
    const suffix = uniq();
    const email = `new-${suffix}@example.com`;
    await cleanupUserByEmail(email);

    const verifier = new FakeVerifier({
      sub: `sub-${suffix}`,
      email,
      emailVerified: true,
      name: "New User",
      picture: "https://example.com/avatar.png",
    });

    const result = await signInWithIOSGoogleIdToken({
      idToken: "fake-token",
      verifier,
      prisma,
    });

    expect(result.outcome).toBe("created");
    expect(result.user.email).toBe(email);
    expect(result.user.name).toBe("New User");
    expect(result.user.image).toBe("https://example.com/avatar.png");
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    // Session row exists and is linked to the new user
    const session = await prisma.session.findUnique({
      where: { token: result.token },
    });
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(result.user.id);
    expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Account row exists with the right provider+sub
    const account = await prisma.account.findFirst({
      where: { providerId: "google", accountId: `sub-${suffix}` },
    });
    expect(account).not.toBeNull();
    expect(account!.userId).toBe(result.user.id);

    await cleanupUserByEmail(email);
  });

  it("reuses an existing user when the Google account row is already linked", async () => {
    const suffix = uniq();
    const email = `existing-${suffix}@example.com`;
    await cleanupUserByEmail(email);

    const sub = `sub-existing-${suffix}`;
    const userId = generateId();
    await prisma.user.create({
      data: {
        id: userId,
        email,
        emailVerified: true,
        name: "Prior User",
      },
    });
    await prisma.account.create({
      data: {
        id: generateId(),
        providerId: "google",
        accountId: sub,
        userId,
      },
    });

    const verifier = new FakeVerifier({
      sub,
      email,
      emailVerified: true,
      name: "Newer Display Name",
    });

    const result = await signInWithIOSGoogleIdToken({
      idToken: "fake-token",
      verifier,
      prisma,
    });

    expect(result.outcome).toBe("existing");
    expect(result.user.id).toBe(userId);
    // We do NOT rewrite display name on an existing account — name lifecycle
    // is outside the responsibility of the sign-in call.
    expect(result.user.name).toBe("Prior User");

    // Exactly one account row — we didn't accidentally create a duplicate
    const accountCount = await prisma.account.count({
      where: { providerId: "google", accountId: sub },
    });
    expect(accountCount).toBe(1);

    await cleanupUserByEmail(email);
  });

  it("links to an existing email-match user when email is verified", async () => {
    const suffix = uniq();
    const email = `linkable-${suffix}@example.com`;
    await cleanupUserByEmail(email);

    // Existing user signed up via email/password — no google account yet.
    const existingUserId = generateId();
    await prisma.user.create({
      data: {
        id: existingUserId,
        email,
        emailVerified: true,
        name: "Email User",
      },
    });

    const verifier = new FakeVerifier({
      sub: `sub-link-${suffix}`,
      email,
      emailVerified: true,
      name: "Google Display",
    });

    const result = await signInWithIOSGoogleIdToken({
      idToken: "fake-token",
      verifier,
      prisma,
    });

    expect(result.outcome).toBe("linked");
    expect(result.user.id).toBe(existingUserId);

    // Account row created against the existing user
    const account = await prisma.account.findFirst({
      where: { providerId: "google", accountId: `sub-link-${suffix}` },
    });
    expect(account).not.toBeNull();
    expect(account!.userId).toBe(existingUserId);

    await cleanupUserByEmail(email);
  });

  it("REFUSES to link by email when email_verified is false — creates a new user instead", async () => {
    // Security: an attacker with control of a Google `sub` could otherwise
    // claim a victim's existing Brett account by minting a token with the
    // victim's email. We only link when Google says the email is verified.
    const suffix = uniq();
    const email = `unverified-${suffix}@example.com`;
    await cleanupUserByEmail(email);

    const priorUserId = generateId();
    await prisma.user.create({
      data: {
        id: priorUserId,
        email,
        emailVerified: true,
        name: "Legit User",
      },
    });

    const verifier = new FakeVerifier({
      sub: `sub-attacker-${suffix}`,
      email,
      emailVerified: false, // <-- critical
      name: "Attacker",
    });

    // Existing user has that email — Prisma's @unique on User.email means we
    // can't create a second user with the same address. The function must
    // surface that as a signIn error, NOT silently link.
    await expect(
      signInWithIOSGoogleIdToken({
        idToken: "fake-token",
        verifier,
        prisma,
      }),
    ).rejects.toThrow();

    // The prior user is untouched: no new google account row was linked.
    const account = await prisma.account.findFirst({
      where: { providerId: "google", accountId: `sub-attacker-${suffix}` },
    });
    expect(account).toBeNull();

    await cleanupUserByEmail(email);
  });

  it("rejects when the verifier throws", async () => {
    const verifier = new FakeVerifier(null, new Error("token expired"));
    await expect(
      signInWithIOSGoogleIdToken({
        idToken: "bad-token",
        verifier,
        prisma,
      }),
    ).rejects.toBeInstanceOf(IOSGoogleSignInError);
  });

  it("rejects when Google returns no email (unusual but possible)", async () => {
    const suffix = uniq();
    const verifier = new FakeVerifier({
      sub: `sub-noemail-${suffix}`,
      emailVerified: false,
      name: "Phantom",
    });

    await expect(
      signInWithIOSGoogleIdToken({
        idToken: "fake-token",
        verifier,
        prisma,
      }),
    ).rejects.toBeInstanceOf(IOSGoogleSignInError);
  });

  it("issued session is usable as a Bearer token on authenticated endpoints", async () => {
    // Round-trip check: the session token we mint should work with the same
    // authMiddleware every other route uses. Guards against drift between
    // this function's session shape and better-auth's lookup expectations.
    const suffix = uniq();
    const email = `bearer-${suffix}@example.com`;
    await cleanupUserByEmail(email);

    const verifier = new FakeVerifier({
      sub: `sub-bearer-${suffix}`,
      email,
      emailVerified: true,
      name: "Bearer Test",
    });
    const { token, user } = await signInWithIOSGoogleIdToken({
      idToken: "fake-token",
      verifier,
      prisma,
    });

    const res = await app.request("/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.email).toBe(email);
    expect(body.id).toBe(user.id);

    await cleanupUserByEmail(email);
  });
});

// ---------------------------------------------------------------------------
// Route handler — exercises input validation + error mapping
// ---------------------------------------------------------------------------

describe("POST /api/auth/ios/google/token — input validation", () => {
  beforeEach(() => {
    // Make sure the verifier factory doesn't throw for these tests; we only
    // care about the route's request-parsing path before it ever calls out.
    process.env.GOOGLE_IOS_CLIENT_ID = "test-audience.apps.googleusercontent.com";
  });

  it("400 on non-JSON body", async () => {
    const res = await app.request("/api/auth/ios/google/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("invalid_json");
  });

  it("400 when idToken is missing", async () => {
    const res = await app.request("/api/auth/ios/google/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wrongField: "value" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toBe("missing_id_token");
  });

  it("401 when idToken fails basic shape check (too short / wrong segment count)", async () => {
    const res = await app.request("/api/auth/ios/google/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "short" }),
    });
    expect(res.status).toBe(401);
  });

  it("503 when GOOGLE_IOS_CLIENT_ID is not configured", async () => {
    delete process.env.GOOGLE_IOS_CLIENT_ID;

    // 3-segment JWT-shaped string long enough to pass the shape gate; the
    // verifier factory bails with 503 before we ever hit Google.
    const fakeLongJwt = `${"a".repeat(60)}.${"b".repeat(40)}.${"c".repeat(40)}`;

    const res = await app.request("/api/auth/ios/google/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: fakeLongJwt }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as any;
    expect(body.error).toBe("ios_google_not_configured");
  });
});
