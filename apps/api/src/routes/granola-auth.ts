import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import { resolveRelinkTaskForAccount } from "../lib/connection-health.js";
import { generateId } from "@brett/utils";
import { randomBytes, createHash } from "crypto";
import type { Context } from "hono";
import { signOAuthState, verifyOAuthState } from "../lib/oauth-state.js";

// Granola MCP OAuth endpoints — discovered from https://mcp.granola.ai/.well-known/oauth-authorization-server
const GRANOLA_AUTH_URL = "https://mcp-auth.granola.ai/oauth2/authorize";
const GRANOLA_TOKEN_URL = "https://mcp-auth.granola.ai/oauth2/token";
const GRANOLA_REGISTER_URL = "https://mcp-auth.granola.ai/oauth2/register";
const GRANOLA_USERINFO_URL = "https://mcp-auth.granola.ai/oauth2/userinfo";

// Outbound HTTP timeout for Granola endpoints. 10s matches the bounded
// timeout already used for client registration — long enough for an honest
// slow response, short enough that an outage doesn't hang the OAuth callback.
const GRANOLA_FETCH_TIMEOUT_MS = 10_000;

// Cap on the userinfo response body. The endpoint normally returns a few
// hundred bytes (sub, email, optional name). A 64KB cap is generous for
// legitimate use while bounding memory if Granola or a MITM ever streamed
// a multi-megabyte response into JSON.parse.
const USERINFO_MAX_BYTES = 64 * 1024;

// Conservative RFC-5321-ish email syntax check. We are not validating
// deliverability — only that the value looks like an email at all, to
// prevent a misconfigured upstream from pushing arbitrary strings into
// the (userId, email) unique key.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

/**
 * Fetch the authenticated Granola account's email via the OIDC userinfo
 * endpoint. Throws on any failure path (non-2xx, missing claim, malformed
 * email, oversize body). Never includes the access token in thrown errors
 * or logs.
 *
 * Exported only so the unit test in `__tests__/granola-auth.test.ts` can
 * exercise it; not part of the route public API.
 */
export async function fetchGranolaEmail(accessToken: string): Promise<string> {
  let resp: Response;
  try {
    resp = await fetch(GRANOLA_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GRANOLA_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    // AbortError and network failures should not leak the access token.
    const reason = err instanceof Error ? err.name : "unknown";
    throw new Error(`Granola userinfo request failed (${reason})`);
  }

  if (!resp.ok) {
    throw new Error(`Granola userinfo request failed (HTTP ${resp.status})`);
  }

  // Read the body with a size cap so an upstream that streams a giant
  // payload can't OOM us before JSON.parse rejects it.
  const reader = resp.body?.getReader();
  if (!reader) {
    throw new Error("Granola userinfo request failed (empty body)");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > USERINFO_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("Granola userinfo response exceeded size limit");
      }
      chunks.push(value);
    }
  }
  const bodyText = new TextDecoder("utf-8").decode(Buffer.concat(chunks));

  let claims: unknown;
  try {
    claims = JSON.parse(bodyText);
  } catch {
    throw new Error("Granola userinfo response was not valid JSON");
  }
  if (!claims || typeof claims !== "object") {
    throw new Error("Granola userinfo response was not a JSON object");
  }
  const rawEmail = (claims as { email?: unknown }).email;
  if (typeof rawEmail !== "string") {
    throw new Error("Granola userinfo response missing email claim");
  }
  const email = rawEmail.trim().toLowerCase();
  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(email)) {
    throw new Error("Granola userinfo response email is not syntactically valid");
  }
  return email;
}

// PKCE verifiers stored in the Verification table (survives restarts, works across instances)
const PKCE_IDENTIFIER_PREFIX = "pkce:granola:";

// Cached client credentials from Dynamic Client Registration (with TTL)
let registeredClient: { client_id: string; client_secret?: string; registeredAt: number } | null = null;
const CLIENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function callbackHtml(
  c: Context,
  { title, message, isError }: { title: string; message: string; isError?: boolean },
) {
  const color = isError ? "#f87171" : "#60a5fa";
  // On success, close immediately — the desktop app polls for status.
  // On error, keep the tab open so the user can read the message.
  const autoClose = isError
    ? ""
    : "<script>window.close();</script>";
  const closeHint = isError
    ? `<p style="color:rgba(255,255,255,0.2);font-size:12px;margin-top:20px;">You can close this tab.</p>`
    : "";
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
<div style="text-align:center;max-width:360px;padding:40px;">
<div style="font-size:36px;margin-bottom:16px;">${isError ? "😕" : "✅"}</div>
<h1 style="color:${color};font-size:20px;font-weight:700;margin:0 0 8px;">${escapeHtml(title)}</h1>
<p style="color:rgba(255,255,255,0.4);font-size:14px;line-height:1.6;margin:0 0 20px;">${escapeHtml(message)}</p>
${closeHint}
${autoClose}
</div></body></html>`;
  return c.html(html);
}

export async function ensureClientRegistered(): Promise<{ client_id: string; client_secret?: string }> {
  if (registeredClient && (Date.now() - registeredClient.registeredAt) < CLIENT_TTL_MS) {
    return registeredClient;
  }

  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";
  // Bounded timeout — Granola's OAuth endpoint normally responds in <1s.
  // Without this, a Granola outage or DNS flake would hang the request
  // until the client gives up (also blocks any future test that imports
  // this code path).
  const resp = await fetch(GRANOLA_REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Brett",
      redirect_uris: [`${baseUrl}/granola/auth/callback`],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Granola client registration failed: ${resp.status} ${text}`);
  }

  const client = (await resp.json()) as { client_id: string; client_secret?: string };
  registeredClient = { ...client, registeredAt: Date.now() };
  return registeredClient;
}

/** Clear cached client registration (used for retry on 401). */
export function clearRegisteredClient(): void {
  registeredClient = null;
}

const granolaAuth = new Hono<AuthEnv>();

// GET / — Connection status (returns ALL of the user's Granola accounts)
granolaAuth.get("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const accounts = await prisma.granolaAccount.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  return c.json({
    connected: accounts.length > 0,
    accounts: accounts.map((account) => ({
      id: account.id,
      email: account.email,
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
      autoCreateMyTasks: account.autoCreateMyTasks,
      autoCreateFollowUps: account.autoCreateFollowUps,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    })),
  });
});

// PATCH /:accountId/preferences — Update per-account auto-create settings
granolaAuth.patch("/:accountId/preferences", authMiddleware, async (c) => {
  const user = c.get("user");
  const accountId = c.req.param("accountId");
  const body = await c.req.json<{
    autoCreateMyTasks?: boolean;
    autoCreateFollowUps?: boolean;
  }>();

  // Ownership check — without this, any authed user could mutate any account by ID
  const account = await prisma.granolaAccount.findFirst({
    where: { id: accountId, userId: user.id },
  });
  if (!account) {
    return c.json({ error: "Not found" }, 404);
  }

  const data: Record<string, boolean> = {};
  if (typeof body.autoCreateMyTasks === "boolean") data.autoCreateMyTasks = body.autoCreateMyTasks;
  if (typeof body.autoCreateFollowUps === "boolean") data.autoCreateFollowUps = body.autoCreateFollowUps;

  const updated = await prisma.granolaAccount.update({
    where: { id: account.id },
    data,
  });

  return c.json({
    autoCreateMyTasks: updated.autoCreateMyTasks,
    autoCreateFollowUps: updated.autoCreateFollowUps,
  });
});

// Per-user cap on connected Granola accounts. Prevents account-flooding
// (each new account fans out into the granolaProvider iteration on every
// cron tick). 5 covers the realistic personal+work+side-project case
// without enabling abuse.
const MAX_GRANOLA_ACCOUNTS_PER_USER = 5;

// POST /connect — Initiate OAuth (returns URL)
granolaAuth.post("/connect", authMiddleware, async (c) => {
  const user = c.get("user");

  // Enforce per-user account cap BEFORE starting OAuth. Counted at /connect
  // rather than at the callback so users get an immediate, actionable error
  // instead of seeing a confusing OAuth-tab failure.
  const existingCount = await prisma.granolaAccount.count({
    where: { userId: user.id },
  });
  if (existingCount >= MAX_GRANOLA_ACCOUNTS_PER_USER) {
    return c.json(
      {
        error: `You can connect up to ${MAX_GRANOLA_ACCOUNTS_PER_USER} Granola accounts. Disconnect one before adding another.`,
      },
      400,
    );
  }

  let client;
  try {
    client = await ensureClientRegistered();
  } catch (err) {
    console.error("[granola-auth] Client registration failed:", err);
    return c.json({ error: "Failed to connect to Granola. Please try again." }, 502);
  }
  const { state, nonce } = signOAuthState("granola", user.id);

  // PKCE: generate code_verifier and code_challenge (S256)
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  // Store PKCE verifier in Verification table (persistent, shared across instances)
  await prisma.verification.create({
    data: {
      id: generateId(),
      identifier: `${PKCE_IDENTIFIER_PREFIX}${nonce}`,
      value: codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  });

  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: `${baseUrl}/granola/auth/callback`,
    state,
    scope: "openid email offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  const url = `${GRANOLA_AUTH_URL}?${params.toString()}`;
  return c.json({ url });
});

// GET /callback — OAuth callback
granolaAuth.get("/callback", async (c) => {
  const error = c.req.query("error");
  if (error) {
    return callbackHtml(c, {
      title: "Access denied",
      message: "Granola access wasn't granted. Head back to Brett and try again from Settings.",
      isError: true,
    });
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return callbackHtml(c, {
      title: "Something went wrong",
      message: "Missing authorization data. Please try connecting again from Brett.",
      isError: true,
    });
  }

  const verified = verifyOAuthState("granola", state);
  if (!verified) {
    return callbackHtml(c, { title: "Security check failed", message: "The authorization state was invalid or tampered with. Please try connecting again.", isError: true });
  }
  const { userId } = verified;

  // userId is verified via HMAC — no session needed on callback. We still
  // check the row exists so we don't accept a stale state nonce for a
  // deleted account.
  const userExists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!userExists) {
    return callbackHtml(c, { title: "User not found", message: "The user account no longer exists. Please try again.", isError: true });
  }

  // Retrieve PKCE code_verifier from Verification table (keyed by nonce from state)
  const pkceRecord = await prisma.verification.findFirst({
    where: { identifier: `${PKCE_IDENTIFIER_PREFIX}${verified.nonce}` },
  });
  if (!pkceRecord || pkceRecord.expiresAt < new Date()) {
    // Clean up expired record if it exists
    if (pkceRecord) {
      await prisma.verification.delete({ where: { id: pkceRecord.id } }).catch(() => {});
    }
    return callbackHtml(c, {
      title: "Session expired",
      message: "The authorization session has expired. Please try connecting again from Brett.",
      isError: true,
    });
  }
  const codeVerifier = pkceRecord.value;
  // Delete immediately to prevent replay
  await prisma.verification.delete({ where: { id: pkceRecord.id } }).catch(() => {});

  // Exchange code for tokens (with retry on 401 — re-register DCR client)
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";

  async function exchangeCode(cl: { client_id: string; client_secret?: string }) {
    // Bounded timeout matches the userinfo + DCR calls. Without this, a
    // Granola outage hangs the OAuth callback until the browser gives up.
    return fetch(GRANOLA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: `${baseUrl}/granola/auth/callback`,
        client_id: cl.client_id,
        code_verifier: codeVerifier!,
        ...(cl.client_secret ? { client_secret: cl.client_secret } : {}),
      }),
      signal: AbortSignal.timeout(GRANOLA_FETCH_TIMEOUT_MS),
    });
  }

  // Wrap the whole token-exchange chain so a timeout or DCR error during
  // either ensureClientRegistered or exchangeCode renders a clean callback
  // page instead of bubbling out as a 500.
  let tokenResp: Response;
  try {
    let client = await ensureClientRegistered();
    tokenResp = await exchangeCode(client);
    if (tokenResp.status === 401) {
      // Client creds may be stale — re-register and retry once
      clearRegisteredClient();
      client = await ensureClientRegistered();
      tokenResp = await exchangeCode(client);
    }
  } catch (err) {
    console.error("[granola-auth] Token exchange failed:", err);
    return callbackHtml(c, {
      title: "Authorization failed",
      message: "Couldn't reach Granola to complete the connection. Please try again.",
      isError: true,
    });
  }

  if (!tokenResp.ok) {
    return callbackHtml(c, { title: "Authorization failed", message: "Couldn't exchange the authorization code. Please try again.", isError: true });
  }

  const tokens = (await tokenResp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    // id_token intentionally not declared — we never read it. The email
    // claim is fetched from /userinfo via fetchGranolaEmail instead.
  };

  if (!tokens.access_token || !tokens.refresh_token) {
    return callbackHtml(c, {
      title: "Something went wrong",
      message: "Didn't receive the required tokens from Granola. Please try again.",
      isError: true,
    });
  }

  // Resolve the Granola account email via the OIDC userinfo endpoint.
  //
  // Granola does not put `email` at the top level of its token-endpoint
  // response, so the previous `tokens.email ?? user.email` fallback caused
  // every new connection (across personal + work Granola accounts) to be
  // keyed by the Brett user's own email — the upsert then overwrote the
  // first account with the second.
  //
  // We deliberately do NOT trust `tokens.id_token`: parsing the JWT payload
  // without JWKS signature verification would let a forged or MITM'd token
  // inject an arbitrary email into the upsert key `(userId, email)`. The
  // userinfo endpoint is server-to-server over TLS using the freshly issued
  // access token, which is the same trust level as the token endpoint itself.
  let email: string;
  try {
    email = await fetchGranolaEmail(tokens.access_token);
  } catch (err) {
    // Suppress the underlying error message — it can contain HTTP status
    // codes and similar that aren't useful to the end-user, and we never
    // want to risk a stack trace leaking the access token to the rendered
    // HTML. The server log gets enough context to debug.
    console.error("[granola-auth] userinfo lookup failed:", err);
    return callbackHtml(c, {
      title: "Couldn't identify Granola account",
      message:
        "Granola accepted the connection but didn't tell us which account you authorized. Please try again from Brett.",
      isError: true,
    });
  }

  // Upsert GranolaAccount keyed on (userId, email) so re-authing the same Google
  // identity refreshes tokens on the existing row, and authorizing a different
  // identity creates a new account for the same Brett user.
  const granolaAccount = await prisma.granolaAccount.upsert({
    where: { userId_email: { userId, email } },
    create: {
      id: generateId(),
      userId,
      email,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : new Date(Date.now() + 3600 * 1000),
    },
    update: {
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : new Date(Date.now() + 3600 * 1000),
    },
  });

  // Resolve the re-link task for THIS account specifically. With
  // multi-account, a provider-wide resolver would silently clear
  // re-link prompts for OTHER (still broken) accounts.
  await resolveRelinkTaskForAccount(userId, "granola", granolaAccount.id).catch((e) =>
    console.error("[granola-auth] Failed to resolve re-link task:", e),
  );

  // Trigger initial sync in background via the coordinator (handles
  // MeetingNoteSource merging correctly and supports multiple accounts).
  import("../services/meeting-providers/registry.js")
    .then(({ meetingCoordinator }) => meetingCoordinator.initialSync(userId, "granola"))
    .catch((err: unknown) => console.error("[granola-auth] Initial sync failed:", err));

  return callbackHtml(c, {
    title: "Granola connected!",
    message: "Your meeting notes will start syncing. Head back to Brett.",
  });
});

// DELETE /:accountId — Disconnect one specific account
granolaAuth.delete("/:accountId", authMiddleware, async (c) => {
  const user = c.get("user");
  const accountId = c.req.param("accountId");

  // Ownership check — without this, any authed user could delete any account by ID
  const account = await prisma.granolaAccount.findFirst({
    where: { id: accountId, userId: user.id },
  });
  if (!account) {
    return c.json({ error: "Not found" }, 404);
  }

  // Null out meetingNoteId on items linked to meetings from THIS account only.
  // Items linked to meetings from the user's other accounts must be preserved.
  await prisma.item.updateMany({
    where: {
      meetingNoteId: { not: null },
      userId: user.id,
      meetingNote: { granolaAccountId: account.id },
    },
    data: { meetingNoteId: null },
  });

  // Delete the GranolaAccount. The MeetingNote.granolaAccountId FK is
  // declared SetNull (not Cascade) — cross-source notes (e.g. ones that
  // also carry a google_meet MeetingNoteSource) survive the disconnect
  // with their granolaAccountId nulled out. MeetingNoteSource rows for
  // this account are also SetNull on their granolaAccountId column.
  await prisma.granolaAccount.delete({ where: { id: account.id } });

  // Resolve the re-link task for THIS account only — provider-wide
  // resolution would clear prompts for the user's other (still broken)
  // Granola accounts.
  await resolveRelinkTaskForAccount(user.id, "granola", account.id).catch((e) =>
    console.error("[granola-auth] Failed to resolve re-link task:", e),
  );

  return c.json({ ok: true });
});

// GET /meetings/by-event/:eventId — Get Granola meeting linked to a calendar event
granolaAuth.get("/meetings/by-event/:eventId", authMiddleware, async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");
  const meeting = await prisma.meetingNote.findFirst({
    where: { calendarEventId: eventId, userId: user.id },
    select: {
      id: true,
      sources: true,
      calendarEventId: true,
      title: true,
      summary: true,
      transcript: true,
      attendees: true,
      actionItems: true,
      meetingStartedAt: true,
      meetingEndedAt: true,
      syncedAt: true,
      items: {
        where: { meetingNoteId: { not: null } },
        select: { id: true, title: true, status: true, dueDate: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return c.json(meeting);
});

// POST /meetings/:meetingId/reprocess — Re-extract action items for a meeting
granolaAuth.post("/meetings/:meetingId/reprocess", authMiddleware, async (c) => {
  const user = c.get("user");
  const meetingId = c.req.param("meetingId");
  try {
    const { reprocessActionItems } = await import("../services/granola-action-items.js");
    const result = await reprocessActionItems(meetingId, user.id);
    return c.json({ ok: true, created: result.created });
  } catch (err: any) {
    console.error("[granola-auth] Reprocess failed:", err);
    return c.json({ error: err?.message ?? "Reprocess failed" }, 500);
  }
});

// POST /sync — Manually trigger sync
granolaAuth.post("/sync", authMiddleware, async (c) => {
  const user = c.get("user");
  try {
    const { meetingCoordinator } = await import("../services/meeting-providers/registry.js");
    await meetingCoordinator.initialSync(user.id, "granola");
    const count = await prisma.meetingNote.count({ where: { userId: user.id } });
    return c.json({ ok: true, meetingsSynced: count });
  } catch (err: any) {
    console.error("[granola-auth] Sync failed:", err);
    return c.json({ error: err?.message ?? "Sync failed" }, 500);
  }
});

export default granolaAuth;
