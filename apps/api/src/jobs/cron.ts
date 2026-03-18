import cron from "node-cron";
import { sendHeartbeats, getConnectionCount } from "../lib/sse.js";
import { prisma } from "../lib/prisma.js";
import { getCalendarClient, watchCalendar, stopWatch } from "../lib/google-calendar.js";
import { generateId } from "@brett/utils";
import { createHmac } from "crypto";

export function startCronJobs(): void {
  // SSE heartbeat — every 30 seconds
  cron.schedule("*/30 * * * * *", () => {
    sendHeartbeats();
  });

  // Webhook renewal — every 6 hours
  // Renew watches expiring within the next 24 hours
  cron.schedule("0 */6 * * *", async () => {
    try {
      const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const expiring = await prisma.calendarList.findMany({
        where: {
          watchExpiration: { lt: cutoff },
          watchChannelId: { not: null },
        },
        include: { googleAccount: true },
      });

      if (expiring.length === 0) return;

      console.log(`[cron] Renewing ${expiring.length} expiring webhook watches`);

      const encryptionKey = process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
      if (!encryptionKey) {
        console.warn("[cron] CALENDAR_TOKEN_ENCRYPTION_KEY not set, skipping webhook renewal");
        return;
      }

      for (const cal of expiring) {
        try {
          const client = await getCalendarClient(cal.googleAccountId);

          // Stop the old watch if we have the resourceId
          if (cal.watchChannelId && cal.watchResourceId) {
            try {
              await stopWatch(client, cal.watchChannelId, cal.watchResourceId);
            } catch {
              // Old watch may already be expired, safe to ignore
            }
          }

          // Register a new watch
          const channelId = generateId();
          const token = createHmac("sha256", encryptionKey)
            .update(channelId)
            .digest("hex");

          const channel = await watchCalendar(client, cal.googleCalendarId, channelId, token);

          await prisma.calendarList.update({
            where: { id: cal.id },
            data: {
              watchChannelId: channelId,
              watchResourceId: channel.resourceId ?? null,
              watchToken: token,
              watchExpiration: channel.expiration
                ? new Date(Number(channel.expiration))
                : null,
            },
          });

          console.log(`[cron] Renewed watch for calendar ${cal.googleCalendarId}`);
        } catch (err) {
          console.error(`[cron] Failed to renew watch for calendar ${cal.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[cron] Webhook renewal failed:", err);
    }
  });

  // Periodic reconciliation — every 4 hours
  // Run incremental sync for all connected accounts
  cron.schedule("0 */4 * * *", async () => {
    try {
      const accounts = await prisma.googleAccount.findMany({
        select: { id: true },
      });

      if (accounts.length === 0) return;

      console.log(`[cron] Running reconciliation sync for ${accounts.length} accounts`);

      const { incrementalSync } = await import("../services/calendar-sync.js");
      for (const account of accounts) {
        try {
          await incrementalSync(account.id);
        } catch (err) {
          console.error(`[cron] Reconciliation sync failed for account ${account.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[cron] Reconciliation sync failed:", err);
    }
  });

  console.log(
    "[cron] Started: SSE heartbeat (30s), webhook renewal (6h), reconciliation (4h)",
  );
}
