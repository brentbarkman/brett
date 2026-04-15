import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import { resolveRelinkTask } from "../lib/connection-health.js";
import { generateId } from "@brett/utils";
import { randomBytes, createHash } from "crypto";
import type { Context } from "hono";
import { signOAuthState, verifyOAuthState } from "../lib/oauth-state.js";

// Granola MCP OAuth endpoints — discovered from https://mcp.granola.ai/.well-known/oauth-authorization-server
const GRANOLA_AUTH_URL = "https://mcp-auth.granola.ai/oauth2/authorize";
const GRANOLA_TOKEN_URL = "https://mcp-auth.granola.ai/oauth2/token";
const GRANOLA_REGISTER_URL = "https://mcp-auth.granola.ai/oauth2/register";

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

// GET / — Connection status
granolaAuth.get("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const account = await prisma.granolaAccount.findUnique({
    where: { userId: user.id },
  });
  if (!account) {
    return c.json({ connected: false, account: null });
  }
  return c.json({
    connected: true,
    account: {
      id: account.id,
      email: account.email,
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
      autoCreateMyTasks: account.autoCreateMyTasks,
      autoCreateFollowUps: account.autoCreateFollowUps,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    },
  });
});

// PATCH /preferences — Update auto-create settings
granolaAuth.patch("/preferences", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    autoCreateMyTasks?: boolean;
    autoCreateFollowUps?: boolean;
  }>();

  const data: Record<string, boolean> = {};
  if (typeof body.autoCreateMyTasks === "boolean") data.autoCreateMyTasks = body.autoCreateMyTasks;
  if (typeof body.autoCreateFollowUps === "boolean") data.autoCreateFollowUps = body.autoCreateFollowUps;

  const account = await prisma.granolaAccount.update({
    where: { userId: user.id },
    data,
  });

  return c.json({
    autoCreateMyTasks: account.autoCreateMyTasks,
    autoCreateFollowUps: account.autoCreateFollowUps,
  });
});

// POST /connect — Initiate OAuth (returns URL)
granolaAuth.post("/connect", authMiddleware, async (c) => {
  const user = c.get("user");
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

  // userId is verified via HMAC — no session needed on callback
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) {
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
  let client = await ensureClientRegistered();
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";

  async function exchangeCode(cl: { client_id: string; client_secret?: string }) {
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
    });
  }

  let tokenResp = await exchangeCode(client);
  if (tokenResp.status === 401) {
    // Client creds may be stale — re-register and retry once
    clearRegisteredClient();
    client = await ensureClientRegistered();
    tokenResp = await exchangeCode(client);
  }

  if (!tokenResp.ok) {
    return callbackHtml(c, { title: "Authorization failed", message: "Couldn't exchange the authorization code. Please try again.", isError: true });
  }

  const tokens = (await tokenResp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    email?: string;
  };

  if (!tokens.access_token || !tokens.refresh_token) {
    return callbackHtml(c, {
      title: "Something went wrong",
      message: "Didn't receive the required tokens from Granola. Please try again.",
      isError: true,
    });
  }

  // Extract email from id_token (JWT payload), token response, or fall back to user email
  let email = tokens.email;
  if (!email && tokens.id_token) {
    try {
      const payload = JSON.parse(
        Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8"),
      );
      email = payload.email;
    } catch {
      // Malformed id_token — fall through
    }
  }
  if (!email) email = user.email;

  // Upsert GranolaAccount
  const granolaAccount = await prisma.granolaAccount.upsert({
    where: { userId },
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
      email,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : new Date(Date.now() + 3600 * 1000),
    },
  });

  // Resolve any existing re-link task for this connection
  await resolveRelinkTask(userId, "granola").catch((e) =>
    console.error("[granola-auth] Failed to resolve re-link task:", e),
  );

  // Trigger initial sync in background
  import("../services/granola-sync.js")
    .then(({ initialGranolaSync }: { initialGranolaSync: (userId: string) => Promise<void> }) => initialGranolaSync(userId))
    .catch((err: unknown) => console.error("[granola-auth] Initial sync failed:", err));

  return callbackHtml(c, {
    title: "Granola connected!",
    message: "Your meeting notes will start syncing. Head back to Brett.",
  });
});

// DELETE / — Disconnect
granolaAuth.delete("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const account = await prisma.granolaAccount.findUnique({ where: { userId: user.id } });
  if (!account) {
    return c.json({ error: "Not connected" }, 404);
  }
  // Null out meetingNoteId on any linked items before cascade delete
  await prisma.item.updateMany({
    where: { meetingNoteId: { not: null }, userId: user.id },
    data: { meetingNoteId: null },
  });
  // Cascade delete: GranolaAccount -> MeetingNote
  await prisma.granolaAccount.delete({ where: { id: account.id } });

  // Resolve any existing re-link task — user is in a valid state now (account removed)
  await resolveRelinkTask(user.id, "granola").catch((e) =>
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
