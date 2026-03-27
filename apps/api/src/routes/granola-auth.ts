import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { encryptToken } from "../lib/encryption.js";
import { generateId } from "@brett/utils";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import type { Context } from "hono";

// Granola MCP OAuth endpoints (Dynamic Client Registration)
const GRANOLA_AUTH_URL = "https://mcp.granola.ai/oauth/authorize";
const GRANOLA_TOKEN_URL = "https://mcp.granola.ai/oauth/token";
const GRANOLA_REGISTER_URL = "https://mcp.granola.ai/oauth/register";

// Cached client credentials from Dynamic Client Registration
let registeredClient: { client_id: string; client_secret?: string } | null = null;

function callbackHtml(
  c: Context,
  { title, message, isError }: { title: string; message: string; isError?: boolean },
) {
  const color = isError ? "#f87171" : "#60a5fa";
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;font-family:system-ui,-apple-system,sans-serif;">
<div style="text-align:center;max-width:360px;padding:40px;">
<div style="font-size:36px;margin-bottom:16px;">${isError ? "😕" : "✅"}</div>
<h1 style="color:${color};font-size:20px;font-weight:700;margin:0 0 8px;">${title}</h1>
<p style="color:rgba(255,255,255,0.4);font-size:14px;line-height:1.6;margin:0 0 20px;">${message}</p>
<p style="color:rgba(255,255,255,0.2);font-size:12px;">You can close this tab.</p>
<script>setTimeout(()=>window.close(),3000);</script>
</div></body></html>`;
  return c.html(html);
}

async function ensureClientRegistered(): Promise<{ client_id: string; client_secret?: string }> {
  if (registeredClient) return registeredClient;

  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";
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
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Granola client registration failed: ${resp.status} ${text}`);
  }

  registeredClient = await resp.json();
  return registeredClient!;
}

const granolaAuth = new Hono<AuthEnv>();
granolaAuth.use("*", authMiddleware);

// GET / — Connection status
granolaAuth.get("/", async (c) => {
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
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    },
  });
});

// POST /connect — Initiate OAuth (returns URL)
granolaAuth.post("/connect", async (c) => {
  const user = c.get("user");
  const client = await ensureClientRegistered();
  const nonce = randomBytes(16).toString("hex");
  const hmac = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(user.id + ":" + nonce)
    .digest("hex");
  const state = `${Buffer.from(user.id).toString("base64url")}.${nonce}.${hmac}`;
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: `${baseUrl}/granola/auth/callback`,
    state,
    scope: "openid",
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

  // Verify signed state: base64url(userId).nonce.hmac
  const parts = state.split(".");
  if (parts.length !== 3) {
    return callbackHtml(c, { title: "Invalid request", message: "The authorization state was malformed. Please try again.", isError: true });
  }

  let userId: string;
  try {
    userId = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return callbackHtml(c, { title: "Invalid request", message: "The authorization state couldn't be read. Please try again.", isError: true });
  }

  const expectedHmac = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(userId + ":" + parts[1])
    .digest("hex");

  if (
    parts[2].length !== expectedHmac.length ||
    !timingSafeEqual(Buffer.from(expectedHmac, "hex"), Buffer.from(parts[2], "hex"))
  ) {
    return callbackHtml(c, { title: "Security check failed", message: "The authorization signature didn't match. Please try connecting again.", isError: true });
  }

  const user = c.get("user");
  if (userId !== user.id) {
    return callbackHtml(c, { title: "Session mismatch", message: "The authorization was started by a different session. Please try again.", isError: true });
  }

  // Exchange code for tokens
  const client = await ensureClientRegistered();
  const baseUrl = process.env.BETTER_AUTH_URL || "http://localhost:3001";
  const tokenResp = await fetch(GRANOLA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${baseUrl}/granola/auth/callback`,
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    }),
  });

  if (!tokenResp.ok) {
    return callbackHtml(c, { title: "Authorization failed", message: "Couldn't exchange the authorization code. Please try again.", isError: true });
  }

  const tokens = (await tokenResp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    email?: string;
  };

  if (!tokens.access_token) {
    return callbackHtml(c, { title: "Something went wrong", message: "Didn't receive an access token from Granola. Please try again.", isError: true });
  }

  const email = tokens.email || user.email;

  // Upsert GranolaAccount
  await prisma.granolaAccount.upsert({
    where: { userId: user.id },
    create: {
      id: generateId(),
      userId: user.id,
      email,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token ?? ""),
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : new Date(Date.now() + 3600 * 1000),
    },
    update: {
      email,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token ?? ""),
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000)
        : new Date(Date.now() + 3600 * 1000),
    },
  });

  // Trigger initial sync in background (granola-sync.js is created in Task 5)
  // @ts-expect-error — forward reference to module created in a later task
  import("../services/granola-sync.js")
    .then(({ initialGranolaSync }: { initialGranolaSync: (userId: string) => Promise<void> }) => initialGranolaSync(user.id))
    .catch((err: unknown) => console.error("[granola-auth] Initial sync failed:", err));

  return callbackHtml(c, {
    title: "Granola connected!",
    message: "Your meeting notes will start syncing. Head back to Brett.",
  });
});

// DELETE / — Disconnect
granolaAuth.delete("/", async (c) => {
  const user = c.get("user");
  const account = await prisma.granolaAccount.findUnique({ where: { userId: user.id } });
  if (!account) {
    return c.json({ error: "Not connected" }, 404);
  }
  // Null out granolaMeetingId on any linked items before cascade delete
  await prisma.item.updateMany({
    where: { granolaMeetingId: { not: null }, userId: user.id },
    data: { granolaMeetingId: null },
  });
  // Cascade delete: GranolaAccount -> GranolaMeeting
  await prisma.granolaAccount.delete({ where: { id: account.id } });
  return c.json({ ok: true });
});

// GET /meetings/by-event/:eventId — Get Granola meeting linked to a calendar event
granolaAuth.get("/meetings/by-event/:eventId", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("eventId");
  const meeting = await prisma.granolaMeeting.findFirst({
    where: { calendarEventId: eventId, userId: user.id },
    select: {
      id: true,
      granolaDocumentId: true,
      calendarEventId: true,
      title: true,
      summary: true,
      attendees: true,
      actionItems: true,
      meetingStartedAt: true,
      meetingEndedAt: true,
      syncedAt: true,
    },
  });
  return c.json(meeting);
});

export default granolaAuth;
