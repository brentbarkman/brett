import { OAuth2Client } from "google-auth-library";

/**
 * Thin wrapper around Google's OAuth2Client ID-token verifier. Extracted so
 * route handlers stay short and so tests can swap in a fake without touching
 * real JWKS / network.
 *
 * Expected audience is `GOOGLE_IOS_CLIENT_ID` — Google's iOS SDK mints
 * ID tokens whose `aud` claim is the iOS OAuth client ID you create under
 * the same Google Cloud project as the web client.
 */
export interface IOSGoogleClaims {
  sub: string;                 // stable Google user id
  email?: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;            // URL to the user's Google avatar
}

export interface IOSGoogleVerifier {
  verify(idToken: string): Promise<IOSGoogleClaims>;
}

/** Real verifier — fetches Google's public JWKS and validates the token. */
export class GoogleAuthLibraryVerifier implements IOSGoogleVerifier {
  private client: OAuth2Client;
  constructor(private audience: string) {
    this.client = new OAuth2Client();
  }

  async verify(idToken: string): Promise<IOSGoogleClaims> {
    // `verifyIdToken` handles: signature check against Google's rotating
    // JWKS, `iss` must be one of accounts.google.com or
    // https://accounts.google.com, `aud` must match `audience`, `exp` not
    // passed. Anything else throws.
    const ticket = await this.client.verifyIdToken({
      idToken,
      audience: this.audience,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error("google_token_no_payload");
    }
    if (!payload.sub) {
      throw new Error("google_token_no_sub");
    }
    return {
      sub: payload.sub,
      email: payload.email,
      // `email_verified` defaults to false when Google omits it — safer to
      // treat absence as unverified than the other way around.
      emailVerified: payload.email_verified === true,
      name: payload.name,
      picture: payload.picture,
    };
  }
}

/** Module-level singleton so we don't recreate OAuth2Client on every request. */
let cached: { audience: string; verifier: GoogleAuthLibraryVerifier } | null = null;

export function getIOSGoogleVerifier(): IOSGoogleVerifier {
  const audience = process.env.GOOGLE_IOS_CLIENT_ID;
  if (!audience) {
    throw new Error(
      "GOOGLE_IOS_CLIENT_ID is not set — iOS Google sign-in is unavailable.",
    );
  }
  if (!cached || cached.audience !== audience) {
    cached = { audience, verifier: new GoogleAuthLibraryVerifier(audience) };
  }
  return cached.verifier;
}
