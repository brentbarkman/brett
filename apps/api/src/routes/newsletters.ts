import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import {
  extractEmail,
  verifyIngestSecret,
  findApprovedSender,
  ingestNewsletter,
  createPendingNewsletter,
  approveSender,
  blockSender,
} from "../lib/newsletter-ingest.js";
import { prisma } from "../lib/prisma.js";
import { randomBytes } from "crypto";

const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB

// ── Webhook Router (public, secret-gated) ──

const webhookRouter = new Hono();

/**
 * Extract the secret from either:
 *  - Authorization: Basic <base64(user:pass)>   (preferred — Postmark's
 *    inbound webhook URL accepts `https://user:pass@host/...` and rewrites
 *    it to this header, keeping the secret out of proxy logs and referrer
 *    chains), or
 *  - the `:secret` path param (legacy; kept for back-compat during rollover).
 *
 * The password half of Basic creds is the shared secret. The username is
 * ignored — Postmark requires one, but we don't use it.
 */
function extractIngestSecret(c: {
  req: {
    header: (name: string) => string | undefined;
    param: (name: string) => string;
  };
}): string {
  const auth = c.req.header("authorization") || "";
  if (auth.toLowerCase().startsWith("basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf-8");
      const colonIdx = decoded.indexOf(":");
      if (colonIdx !== -1) return decoded.slice(colonIdx + 1);
    } catch {
      // fall through to path param
    }
  }
  return c.req.param("secret") || "";
}

async function handleNewsletterIngest(c: any) {
  // 1. Validate secret
  const expected = process.env.NEWSLETTER_INGEST_SECRET;
  if (!expected) {
    console.error("[newsletter-webhook] NEWSLETTER_INGEST_SECRET not set");
    return c.json({ error: "Server misconfigured" }, 500);
  }

  const provided = extractIngestSecret(c);
  if (!verifyIngestSecret(provided, expected)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // 2. Parse JSON body
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: true, skipped: "malformed payload" }, 200);
  }

  // 3. Extract required fields
  const from = body.From ?? body.from;
  const fromName = body.FromName ?? body.fromName ?? "";
  const subject = body.Subject ?? body.subject;
  const htmlBody: string = body.HtmlBody ?? body.htmlBody ?? "";
  const textBody: string | null = body.TextBody ?? body.textBody ?? null;
  const date: string = body.Date ?? body.date ?? new Date().toISOString();
  const messageId: string = body.MessageID ?? body.messageId ?? "";
  const to: string = body.To ?? body.to ?? "";

  if (!from || !subject || (!htmlBody && !textBody) || !messageId) {
    return c.json({ ok: true, skipped: "missing required fields" }, 200);
  }

  const senderEmail = extractEmail(from);

  // 4. Size guard (check both HTML and text bodies)
  if (htmlBody.length > MAX_BODY_SIZE || (textBody && textBody.length > MAX_BODY_SIZE)) {
    return c.json({ ok: true, skipped: "body too large" }, 200);
  }

  // 5. Resolve user from To address — parse ingest+{token}@domain.com
  const toEmail = extractEmail(to);
  const tokenMatch = toEmail.match(/^ingest\+([a-z0-9]+)@/);
  if (!tokenMatch) {
    return c.json({ ok: true, skipped: "no ingest token in To address" }, 200);
  }

  const user = await prisma.user.findUnique({
    where: { newsletterIngestToken: tokenMatch[1] },
    select: { id: true, banned: true },
  });
  if (!user || user.banned) {
    return c.json({ ok: true, skipped: "unknown ingest token" }, 200);
  }
  const userId = user.id;

  try {
    // 6. Dedup by MessageID
    const existing = await prisma.item.findFirst({
      where: { sourceId: messageId, userId },
    });
    if (existing) {
      return c.json({ ok: true, skipped: "duplicate" }, 200);
    }

    // 7. Sender resolution
    const sender = await findApprovedSender(userId, senderEmail);

    if (sender && !sender.active) {
      // Blocked sender — drop silently
      return c.json({ ok: true, skipped: "blocked sender" }, 200);
    }

    if (sender && sender.active) {
      // Approved sender — ingest
      await ingestNewsletter({
        userId,
        senderName: fromName || sender.name,
        senderEmail,
        subject,
        htmlBody,
        textBody,
        messageId,
        receivedAt: date,
      });
      return c.json({ ok: true }, 200);
    }

    // Unknown sender — create pending
    await createPendingNewsletter({
      userId,
      senderName: fromName || senderEmail,
      senderEmail,
      subject,
      htmlBody,
      textBody,
      messageId,
      receivedAt: date,
    });
    return c.json({ ok: true }, 200);
  } catch (err) {
    console.error("[newsletter-webhook] DB error:", err);
    return c.json({ error: "Internal error" }, 500);
  }
}

// Preferred path — Postmark's Inbound Webhook URL can embed Basic Auth
// credentials (`https://user:pass@host/webhooks/email/ingest`). Postmark
// rewrites them to an `Authorization: Basic …` header, keeping the shared
// secret out of URL paths, referrer headers, and proxy access logs.
webhookRouter.post("/email/ingest", handleNewsletterIngest);

// Legacy path — secret in URL. Retained so existing Postmark configs keep
// working during rollover. Safe to remove once all webhooks use Basic Auth.
webhookRouter.post("/email/ingest/:secret", handleNewsletterIngest);

// ── Sender Management Router (authed) ──

const senderRouter = new Hono<AuthEnv>();

// Get the user's personalized ingest address (auto-generates token on first call)
senderRouter.get("/ingest-address", authMiddleware, async (c) => {
  const user = c.get("user");
  const baseDomain = process.env.NEWSLETTER_INGEST_EMAIL;
  if (!baseDomain) {
    return c.json({ ingestEmail: null });
  }

  // Parse the domain from the base email (e.g., "ingest@domain.com" → "domain.com")
  const atIdx = baseDomain.indexOf("@");
  if (atIdx === -1) {
    return c.json({ ingestEmail: null });
  }
  const domain = baseDomain.slice(atIdx + 1);

  // Get or create the user's ingest token
  let dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { newsletterIngestToken: true },
  });

  if (!dbUser?.newsletterIngestToken) {
    const token = randomBytes(12).toString("hex"); // 24-char lowercase hex
    dbUser = await prisma.user.update({
      where: { id: user.id },
      data: { newsletterIngestToken: token },
      select: { newsletterIngestToken: true },
    });
  }

  return c.json({ ingestEmail: `ingest+${dbUser.newsletterIngestToken}@${domain}` });
});

// List all senders for user
senderRouter.get("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const senders = await prisma.newsletterSender.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return c.json(senders);
});

// List pending newsletters — MUST be before /:id routes.
// Projects metadata only (NOT `htmlBody` / `textBody`, which can be megabytes
// each) — matches the `PendingNewsletterSummary` shape the client expects.
senderRouter.get("/pending", authMiddleware, async (c) => {
  const user = c.get("user");
  const pending = await prisma.pendingNewsletter.findMany({
    where: { userId: user.id },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      senderEmail: true,
      senderName: true,
      subject: true,
      receivedAt: true,
    },
  });
  return c.json(
    pending.map((p) => ({
      id: p.id,
      senderEmail: p.senderEmail,
      senderName: p.senderName,
      subject: p.subject,
      receivedAt: p.receivedAt.toISOString(),
    }))
  );
});

// Update sender (name or active flag)
senderRouter.patch("/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const body = await c.req.json<{ name?: string; active?: boolean }>();
  const data: { name?: string; active?: boolean } = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.active !== undefined) data.active = body.active;

  if (Object.keys(data).length === 0) {
    return c.json({ error: "No valid fields to update" }, 400);
  }

  try {
    const sender = await prisma.newsletterSender.update({
      where: { id, userId: user.id },
      data,
    });
    return c.json(sender);
  } catch {
    return c.json({ error: "Sender not found" }, 404);
  }
});

// Delete sender
senderRouter.delete("/:id", authMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  try {
    await prisma.newsletterSender.delete({
      where: { id, userId: user.id },
    });
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "Sender not found" }, 404);
  }
});

// Approve sender by email (idempotent)
senderRouter.post("/approve", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ senderEmail?: string }>();
  const senderEmail = body.senderEmail?.trim();
  if (!senderEmail) {
    return c.json({ error: "senderEmail required" }, 400);
  }

  try {
    const result = await approveSender(user.id, senderEmail);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

// Block sender by email (idempotent)
senderRouter.post("/block", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ senderEmail?: string }>();
  const senderEmail = body.senderEmail?.trim();
  if (!senderEmail) {
    return c.json({ error: "senderEmail required" }, 400);
  }

  try {
    await blockSender(user.id, senderEmail);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

export { webhookRouter as newsletterWebhook, senderRouter as newsletterSenders };
