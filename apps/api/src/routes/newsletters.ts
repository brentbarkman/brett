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

const MAX_BODY_SIZE = 2 * 1024 * 1024; // 2 MB

// ── Webhook Router (public, secret-gated) ──

const webhookRouter = new Hono();

webhookRouter.post("/email/ingest/:secret", async (c) => {
  // 1. Validate secret
  const expected = process.env.NEWSLETTER_INGEST_SECRET;
  if (!expected) {
    console.error("[newsletter-webhook] NEWSLETTER_INGEST_SECRET not set");
    return c.json({ error: "Server misconfigured" }, 500);
  }

  const provided = c.req.param("secret");
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

  if (!from || !subject || (!htmlBody && !textBody) || !messageId) {
    return c.json({ ok: true, skipped: "missing required fields" }, 200);
  }

  const senderEmail = extractEmail(from);

  // 4. Size guard (check both HTML and text bodies)
  if (htmlBody.length > MAX_BODY_SIZE || (textBody && textBody.length > MAX_BODY_SIZE)) {
    return c.json({ ok: true, skipped: "body too large" }, 200);
  }

  // 5. Resolve user — single-user: find the one active user in the system
  const user = await prisma.user.findFirst({
    where: { banned: false },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!user) {
    console.error("[newsletter-webhook] No active user found");
    return c.json({ error: "Server misconfigured" }, 500);
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
});

// ── Sender Management Router (authed) ──

const senderRouter = new Hono<AuthEnv>();

// List all senders for user
senderRouter.get("/", authMiddleware, async (c) => {
  const user = c.get("user");
  const senders = await prisma.newsletterSender.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return c.json(senders);
});

// List pending newsletters — MUST be before /:id routes
senderRouter.get("/pending", authMiddleware, async (c) => {
  const user = c.get("user");
  const pending = await prisma.pendingNewsletter.findMany({
    where: { userId: user.id },
    orderBy: { receivedAt: "desc" },
  });
  // Serialize receivedAt to ISO string
  const serialized = pending.map((p) => ({
    ...p,
    receivedAt: p.receivedAt.toISOString(),
  }));
  return c.json(serialized);
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

// Approve pending sender
senderRouter.post("/:pendingId/approve", authMiddleware, async (c) => {
  const user = c.get("user");
  const pendingId = c.req.param("pendingId");

  try {
    const result = await approveSender(user.id, pendingId);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

// Block pending sender
senderRouter.post("/:pendingId/block", authMiddleware, async (c) => {
  const user = c.get("user");
  const pendingId = c.req.param("pendingId");

  try {
    await blockSender(user.id, pendingId);
    return c.json({ ok: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 404);
  }
});

export { webhookRouter as newsletterWebhook, senderRouter as newsletterSenders };
