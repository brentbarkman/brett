import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { createHmac } from "crypto";

const router = new Hono();
const syncDebounce = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 2000;

router.post("/google-calendar", async (c) => {
  const channelId = c.req.header("X-Goog-Channel-ID");
  const resourceId = c.req.header("X-Goog-Resource-ID");
  const channelToken = c.req.header("X-Goog-Channel-Token");

  if (!channelId || !resourceId) {
    return c.json({ error: "Missing channel headers" }, 400);
  }

  const calendarList = await prisma.calendarList.findFirst({
    where: { watchChannelId: channelId, watchResourceId: resourceId },
    include: { googleAccount: true },
  });
  if (!calendarList) return c.json({ error: "Unknown channel" }, 404);

  // Verify HMAC token — always require valid signature
  const hmacKey = process.env.CALENDAR_WEBHOOK_HMAC_KEY ?? process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
  if (!hmacKey) {
    console.error("[webhooks] CALENDAR_WEBHOOK_HMAC_KEY / CALENDAR_TOKEN_ENCRYPTION_KEY not set, rejecting webhook");
    return c.json({ error: "Server misconfigured" }, 500);
  }
  const expectedToken = createHmac("sha256", hmacKey)
    .update(channelId)
    .digest("hex");
  if (!channelToken || channelToken !== expectedToken) {
    return c.json({ error: "Invalid token" }, 403);
  }

  // Debounced sync — Google often sends multiple notifications for the same change
  const key = calendarList.id;
  if (syncDebounce.has(key)) clearTimeout(syncDebounce.get(key)!);

  syncDebounce.set(
    key,
    setTimeout(async () => {
      syncDebounce.delete(key);
      try {
        const { incrementalSync } = await import(
          "../services/calendar-sync.js"
        );
        await incrementalSync(calendarList.googleAccountId);
      } catch (err) {
        console.error(
          `Webhook sync failed for account ${calendarList.googleAccountId}:`,
          err,
        );
      }
    }, DEBOUNCE_MS),
  );

  return c.json({ ok: true });
});

export default router;
