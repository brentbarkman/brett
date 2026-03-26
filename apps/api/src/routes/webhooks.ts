import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { createHmac, timingSafeEqual } from "crypto";

const router = new Hono();

/** Debounce per Google account (not per calendar) — collapses all calendar
 *  notifications for the same account into a single incrementalSync call. */
const syncDebounce = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 10_000; // 10 seconds

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
  const hmacKey = process.env.CALENDAR_WEBHOOK_HMAC_KEY;
  if (!hmacKey) {
    console.error("[webhooks] CALENDAR_WEBHOOK_HMAC_KEY not set, rejecting webhook");
    return c.json({ error: "Server misconfigured" }, 500);
  }
  const expectedToken = createHmac("sha256", hmacKey)
    .update(channelId)
    .digest("hex");
  if (
    !channelToken ||
    channelToken.length !== expectedToken.length ||
    !timingSafeEqual(Buffer.from(channelToken), Buffer.from(expectedToken))
  ) {
    return c.json({ error: "Invalid token" }, 403);
  }

  // Debounce per account — all calendars for this Google account collapse
  const accountId = calendarList.googleAccountId;
  if (syncDebounce.has(accountId)) clearTimeout(syncDebounce.get(accountId)!);

  syncDebounce.set(
    accountId,
    setTimeout(async () => {
      syncDebounce.delete(accountId);
      try {
        const { incrementalSync } = await import(
          "../services/calendar-sync.js"
        );
        await incrementalSync(accountId);
      } catch (err) {
        console.error(
          `Webhook sync failed for account ${accountId}:`,
          err,
        );
      }
    }, DEBOUNCE_MS),
  );

  return c.json({ ok: true });
});

export default router;
