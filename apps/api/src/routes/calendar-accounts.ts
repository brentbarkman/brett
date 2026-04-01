import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  getCalendarAuthUrl,
  exchangeCalendarCode,
  getCalendarClient,
  stopWatch,
} from "../lib/google-calendar.js";
import { encryptToken } from "../lib/encryption.js";
import { initialSync } from "../services/calendar-sync.js";
import { resolveRelinkTask } from "../lib/connection-health.js";
import { generateId } from "@brett/utils";
import { google } from "googleapis";
import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import type { Context } from "hono";

/** Return an HTML page for the OAuth callback (shown in the browser tab that opened Google) */
function callbackHtml(c: Context, { title, message, isError }: { title: string; message: string; isError?: boolean }) {
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

const calendarAccounts = new Hono<AuthEnv>();

// All routes require auth
calendarAccounts.use("*", authMiddleware);

// GET / — List connected accounts with their calendars
calendarAccounts.get("/", async (c) => {
  const user = c.get("user");

  const accounts = await prisma.googleAccount.findMany({
    where: { userId: user.id },
    include: {
      calendars: {
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      },
    },
    orderBy: { connectedAt: "asc" },
  });

  return c.json(
    accounts.map((a) => ({
      id: a.id,
      googleEmail: a.googleEmail,
      connectedAt: a.connectedAt.toISOString(),
      calendars: a.calendars.map((cal) => ({
        id: cal.id,
        googleCalendarId: cal.googleCalendarId,
        name: cal.name,
        color: cal.color,
        isPrimary: cal.isPrimary,
        isVisible: cal.isVisible,
      })),
    })),
  );
});

// POST /connect — Initiate OAuth (returns URL, state = base64url(userId).nonce.hmac)
calendarAccounts.post("/connect", async (c) => {
  const user = c.get("user");
  const nonce = randomBytes(16).toString("hex");
  const hmac = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(user.id + ":" + nonce)
    .digest("hex");
  const state = `${Buffer.from(user.id).toString("base64url")}.${nonce}.${hmac}`;
  const url = getCalendarAuthUrl(state);
  return c.json({ url });
});

// GET /callback — OAuth callback: exchange code, get Google user info, upsert GoogleAccount
// NOTE: Desktop flow works via an ephemeral localhost server in Electron that
// catches the redirect and forwards to this endpoint.
calendarAccounts.get("/callback", async (c) => {
  // Handle denial — Google redirects with ?error= instead of ?code=
  const error = c.req.query("error");
  if (error) {
    return callbackHtml(c, {
      title: "Access denied",
      message: "Calendar access wasn't granted. Head back to Brett and try again from Settings if you change your mind.",
      isError: true,
    });
  }

  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return callbackHtml(c, { title: "Something went wrong", message: "Missing authorization data. Please try connecting again from Brett.", isError: true });
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
    !timingSafeEqual(
      Buffer.from(expectedHmac, "hex"),
      Buffer.from(parts[2], "hex"),
    )
  ) {
    return callbackHtml(c, { title: "Security check failed", message: "The authorization signature didn't match. Please try connecting again.", isError: true });
  }

  // Verify the state matches the authenticated user
  const user = c.get("user");
  if (userId !== user.id) {
    return callbackHtml(c, { title: "Session mismatch", message: "The authorization was started by a different session. Please try again.", isError: true });
  }

  // Exchange the auth code for tokens
  let tokens;
  try {
    tokens = await exchangeCalendarCode(code);
  } catch {
    return callbackHtml(c, { title: "Authorization expired", message: "The authorization code has expired. Head back to Brett and try connecting again.", isError: true });
  }
  if (!tokens.access_token || !tokens.refresh_token) {
    return callbackHtml(c, { title: "Something went wrong", message: "We couldn't get the right tokens from Google. Please try again.", isError: true });
  }

  // Verify required calendar scopes were granted (Google granular consent can omit them)
  const grantedScopes = (tokens.scope ?? "").split(" ");
  const requiredScopes = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
  ];
  const missingScopes = requiredScopes.filter((s) => !grantedScopes.includes(s));
  if (missingScopes.length > 0) {
    return callbackHtml(c, {
      title: "Permissions needed",
      message: "Brett needs full calendar access to work. Please try again and make sure all calendar permissions are checked.",
      isError: true,
    });
  }

  // Get Google user info
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: tokens.access_token });
  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const userInfo = await oauth2.userinfo.get();

  const googleEmail = userInfo.data.email;
  const googleUserId = userInfo.data.id;

  if (!googleEmail || !googleUserId) {
    return callbackHtml(c, { title: "Something went wrong", message: "Couldn't get your Google account info. Please try again.", isError: true });
  }

  // Upsert GoogleAccount with encrypted tokens
  const account = await prisma.googleAccount.upsert({
    where: {
      userId_googleUserId: {
        userId: user.id,
        googleUserId,
      },
    },
    create: {
      id: generateId(),
      userId: user.id,
      googleEmail,
      googleUserId,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      tokenExpiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 3600 * 1000),
    },
    update: {
      googleEmail,
      accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token),
      tokenExpiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 3600 * 1000),
    },
  });

  // Resolve any existing re-link task for this connection
  await resolveRelinkTask(user.id, "google-calendar").catch((e) =>
    console.error("[calendar-accounts] Failed to resolve re-link task:", e),
  );

  // Trigger initial sync in background
  initialSync(account.id).catch((err) => {
    console.error(`[calendar-accounts] Initial sync failed for account ${account.id}:`, err);
  });

  return callbackHtml(c, {
    title: "Calendar connected!",
    message: `${account.googleEmail} is now syncing. Head back to Brett — your events will appear shortly.`,
  });
});

// DELETE /:id — Disconnect: stop watches, cascade delete
calendarAccounts.delete("/:id", async (c) => {
  const user = c.get("user");
  const accountId = c.req.param("id");

  const account = await prisma.googleAccount.findFirst({
    where: { id: accountId, userId: user.id },
    include: { calendars: true },
  });

  if (!account) {
    return c.json({ error: "Not found" }, 404);
  }

  // Stop all webhook watches
  try {
    const client = await getCalendarClient(account.id);
    for (const cal of account.calendars) {
      if (cal.watchChannelId && cal.watchResourceId) {
        try {
          await stopWatch(client, cal.watchChannelId, cal.watchResourceId);
        } catch {
          // Watch may already be expired, safe to ignore
        }
      }
    }
  } catch {
    // If we can't get a client (e.g. tokens revoked), just proceed with deletion
  }

  // Cascade delete (GoogleAccount -> CalendarList -> CalendarEvent, etc.)
  await prisma.googleAccount.delete({ where: { id: account.id } });

  return c.json({ ok: true });
});

// PATCH /:accountId/calendars/:calId — Toggle calendar visibility
calendarAccounts.patch("/:accountId/calendars/:calId", async (c) => {
  const user = c.get("user");
  const accountId = c.req.param("accountId");
  const calId = c.req.param("calId");

  // Verify account ownership
  const account = await prisma.googleAccount.findFirst({
    where: { id: accountId, userId: user.id },
  });
  if (!account) {
    return c.json({ error: "Account not found" }, 404);
  }

  const calendar = await prisma.calendarList.findFirst({
    where: { id: calId, googleAccountId: accountId },
  });
  if (!calendar) {
    return c.json({ error: "Calendar not found" }, 404);
  }

  const body = await c.req.json();
  const isVisible = typeof body.isVisible === "boolean" ? body.isVisible : calendar.isVisible;

  const updated = await prisma.calendarList.update({
    where: { id: calendar.id },
    data: { isVisible },
  });

  return c.json({
    id: updated.id,
    googleCalendarId: updated.googleCalendarId,
    name: updated.name,
    color: updated.color,
    isPrimary: updated.isPrimary,
    isVisible: updated.isVisible,
  });
});

export default calendarAccounts;
