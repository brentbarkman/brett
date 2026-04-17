import crypto from "crypto";
import type { ExtendedPrismaClient } from "@brett/api-core";
import { generateId } from "@brett/utils";
import type { IOSGoogleClaims, IOSGoogleVerifier } from "./ios-google-verifier.js";

/**
 * iOS Google sign-in — verifies the idToken minted by GoogleSignIn-iOS and
 * produces a better-auth compatible session.
 *
 * The function is pure (no Hono, no HTTP) so the authentication/linking
 * logic can be tested directly with a fake verifier + in-memory Prisma.
 *
 * ### Account linking rules
 *
 * Given a verified idToken we pick exactly one of three paths:
 *
 * 1. **Existing Google account row** — the `(providerId: "google",
 *    accountId: sub)` pair is already linked to a Brett user. Reuse that
 *    user; just create a fresh session.
 *
 * 2. **Existing Brett user with matching verified email** — link the
 *    Google account to that user (insert an Account row), create a session.
 *    We only do this when `email_verified === true` in the idToken;
 *    otherwise we'd let an attacker who controls a Google sub claim an
 *    existing Brett account just by minting a token with a victim's email.
 *
 * 3. **No match either way** — create a new User + Account + Session.
 *
 * Returns the bearer token the iOS client should store, plus the user row
 * (stripped of sensitive fields). Session expiry mirrors better-auth's
 * default of 7 days — long enough for typical mobile use, short enough that
 * a compromised device eventually loses access.
 *
 * ### What this function does NOT do
 *
 * - Rate limiting — belongs on the route handler (`ipRateLimiter`).
 * - Re-verifying the idToken — `verifier.verify` is the trust boundary;
 *   any claims passed in by a caller who bypasses it are the caller's fault.
 * - Emitting telemetry / audit logs — route handler responsibility.
 */

export interface IOSGoogleSignInResult {
  token: string;               // session bearer token — the client's "password"
  user: {
    id: string;
    email: string;
    name: string;
    image: string | null;
    createdAt: Date;
  };
  /** "existing" / "linked" / "created" — for tests + audit logs. */
  outcome: "existing" | "linked" | "created";
}

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function signInWithIOSGoogleIdToken(opts: {
  idToken: string;
  verifier: IOSGoogleVerifier;
  prisma: ExtendedPrismaClient;
  now?: () => Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<IOSGoogleSignInResult> {
  const now = opts.now ?? (() => new Date());

  // 1. Verify the idToken. Throws on any signature/audience/expiry failure.
  let claims: IOSGoogleClaims;
  try {
    claims = await opts.verifier.verify(opts.idToken);
  } catch (err) {
    // Normalize the error so the route can return a clean 401 without
    // leaking the verifier's internals.
    throw new IOSGoogleSignInError(
      "invalid_id_token",
      `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 2. Existing Google account row?
  const existingAccount = await opts.prisma.account.findFirst({
    where: { providerId: "google", accountId: claims.sub },
    select: { userId: true },
  });

  if (existingAccount) {
    const user = await requireUser(opts.prisma, existingAccount.userId);
    const token = await createSession({
      prisma: opts.prisma,
      userId: user.id,
      now: now(),
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
    });
    return { token, user: publicUser(user), outcome: "existing" };
  }

  // 3. No Google account row yet — need an email to even consider linking
  // or account creation. A Google idToken without an email is unusual but
  // we refuse rather than guess.
  if (!claims.email) {
    throw new IOSGoogleSignInError(
      "no_email",
      "Google did not return an email address; cannot sign in.",
    );
  }

  const normalizedEmail = claims.email.toLowerCase().trim();

  // 4. Link-by-email path — only when Google attests the email is verified.
  if (claims.emailVerified) {
    const existingUser = await opts.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      await opts.prisma.account.create({
        data: {
          id: generateId(),
          providerId: "google",
          accountId: claims.sub,
          userId: existingUser.id,
        },
      });
      const token = await createSession({
        prisma: opts.prisma,
        userId: existingUser.id,
        now: now(),
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
      });
      return { token, user: publicUser(existingUser), outcome: "linked" };
    }
  }

  // 5. No existing account and no linkable user — create a fresh one.
  // Atomic across User + Account + Session so a partial failure can't leave
  // an orphan user in the database.
  const createdAt = now();
  const result = await opts.prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        id: generateId(),
        email: normalizedEmail,
        emailVerified: claims.emailVerified,
        name: claims.name ?? normalizedEmail.split("@")[0],
        image: claims.picture ?? null,
        createdAt,
        updatedAt: createdAt,
      },
    });
    await tx.account.create({
      data: {
        id: generateId(),
        providerId: "google",
        accountId: claims.sub,
        userId: user.id,
      },
    });
    const sessionToken = newSessionToken();
    await tx.session.create({
      data: {
        id: generateId(),
        userId: user.id,
        token: sessionToken,
        expiresAt: new Date(createdAt.getTime() + SESSION_LIFETIME_SECONDS * 1000),
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
        createdAt,
        updatedAt: createdAt,
      },
    });
    return { user, sessionToken };
  });

  return {
    token: result.sessionToken,
    user: publicUser(result.user),
    outcome: "created",
  };
}

// Simple typed error so the route can tell auth failures apart from
// unexpected crashes.
export class IOSGoogleSignInError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "IOSGoogleSignInError";
  }
}

// -- helpers --

function newSessionToken(): string {
  // 32 random bytes → 43-char URL-safe string. Matches better-auth's
  // session token length class (long enough to resist brute-force).
  return crypto.randomBytes(32).toString("base64url");
}

async function createSession(opts: {
  prisma: ExtendedPrismaClient;
  userId: string;
  now: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<string> {
  const token = newSessionToken();
  await opts.prisma.session.create({
    data: {
      id: generateId(),
      userId: opts.userId,
      token,
      expiresAt: new Date(opts.now.getTime() + SESSION_LIFETIME_SECONDS * 1000),
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
      createdAt: opts.now,
      updatedAt: opts.now,
    },
  });
  return token;
}

async function requireUser(prisma: ExtendedPrismaClient, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    // Account row exists but its user was deleted — abnormal, treat as auth
    // failure and let the caller log it.
    throw new IOSGoogleSignInError(
      "orphan_account",
      `Account is linked to missing user ${userId}`,
    );
  }
  return user;
}

function publicUser(u: {
  id: string;
  email: string;
  name: string;
  image: string | null;
  createdAt: Date;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    image: u.image,
    createdAt: u.createdAt,
  };
}
