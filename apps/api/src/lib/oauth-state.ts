import { randomBytes, createHmac, timingSafeEqual } from "crypto";

const SECRET = () => process.env.BETTER_AUTH_SECRET!;

/**
 * Create a signed OAuth state string: base64url(userId).nonce.hmac
 * The flow prefix prevents cross-flow replay (e.g., a calendar state used in Granola).
 */
export function signOAuthState(flow: string, userId: string): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("hex");
  const hmac = createHmac("sha256", SECRET())
    .update(`${flow}:${userId}:${nonce}`)
    .digest("hex");
  const state = `${Buffer.from(userId).toString("base64url")}.${nonce}.${hmac}`;
  return { state, nonce };
}

/**
 * Verify a signed OAuth state and extract the userId and nonce.
 * Returns null if the state is malformed or the signature doesn't match.
 */
export function verifyOAuthState(flow: string, state: string): { userId: string; nonce: string } | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;

  let userId: string;
  try {
    userId = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return null;
  }

  const expectedHmac = createHmac("sha256", SECRET())
    .update(`${flow}:${userId}:${parts[1]}`)
    .digest("hex");

  if (
    parts[2].length !== expectedHmac.length ||
    !timingSafeEqual(Buffer.from(expectedHmac, "hex"), Buffer.from(parts[2], "hex"))
  ) {
    return null;
  }

  return { userId, nonce: parts[1] };
}
