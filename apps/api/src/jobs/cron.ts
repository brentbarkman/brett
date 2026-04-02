import cron from "node-cron";
import { sendHeartbeats, getConnectionCount } from "../lib/sse.js";
import { prisma } from "../lib/prisma.js";
import { getCalendarClient, watchCalendar, stopWatch } from "../lib/google-calendar.js";
import { generateId } from "@brett/utils";
import { createHmac } from "crypto";

let webhookRenewalRunning = false;
let reconciliationRunning = false;
let granolaSyncRunning = false;
let granolaSweepRunning = false;
let scoutTickRunning = false;

export function startCronJobs(): void {
  // SSE heartbeat — every 30 seconds
  cron.schedule("*/30 * * * * *", () => {
    try {
      sendHeartbeats();
    } catch (err) {
      console.error("[cron] Heartbeat failed:", err);
    }
  });

  // Webhook renewal — every 6 hours
  // Renew watches expiring within the next 24 hours
  cron.schedule("0 */6 * * *", async () => {
    if (webhookRenewalRunning) {
      console.log("[cron] Webhook renewal already running, skipping");
      return;
    }
    webhookRenewalRunning = true;
    try {
      const cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const expiring = await prisma.calendarList.findMany({
        where: {
          watchChannelId: { not: null },
          OR: [
            { watchExpiration: { lt: cutoff } },
            { watchExpiration: null },
          ],
        },
        include: { googleAccount: true },
      });

      if (expiring.length === 0) return;

      console.log(`[cron] Renewing ${expiring.length} expiring webhook watches`);

      const hmacSecret = process.env.CALENDAR_WEBHOOK_HMAC_KEY;
      if (!hmacSecret) {
        console.warn("[cron] CALENDAR_WEBHOOK_HMAC_KEY not set, skipping webhook renewal");
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
          const token = createHmac("sha256", hmacSecret)
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
    } finally {
      webhookRenewalRunning = false;
    }
  });

  // Periodic reconciliation — every 4 hours
  // Run incremental sync for all connected accounts
  cron.schedule("0 */4 * * *", async () => {
    if (reconciliationRunning) {
      console.log("[cron] Reconciliation already running, skipping");
      return;
    }
    reconciliationRunning = true;
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
    } finally {
      reconciliationRunning = false;
    }
  });

  // Granola: calendar-event-driven sync — every 5 minutes
  // Checks for recently ended calendar events and syncs Granola notes
  cron.schedule("*/5 * * * *", async () => {
    if (granolaSyncRunning) return;
    granolaSyncRunning = true;
    try {
      const { syncAfterMeeting } = await import("../services/granola-sync.js");

      // Find users with connected Granola accounts
      const granolaAccounts = await prisma.granolaAccount.findMany({
        select: { userId: true },
      });

      for (const account of granolaAccounts) {
        try {
          // Find calendar events that ended 5-15 minutes ago (window allows Granola processing time)
          const now = new Date();
          const windowEnd = new Date(now.getTime() - 5 * 60 * 1000);   // 5 min ago
          const windowStart = new Date(now.getTime() - 15 * 60 * 1000); // 15 min ago

          const recentlyEnded = await prisma.calendarEvent.findMany({
            where: {
              userId: account.userId,
              endTime: { gte: windowStart, lte: windowEnd },
              isAllDay: false,
            },
            select: { startTime: true, endTime: true },
          });

          for (const event of recentlyEnded) {
            await syncAfterMeeting(account.userId, event.startTime, event.endTime);
          }
        } catch (err) {
          console.error(`[cron] Granola post-meeting sync failed for ${account.userId}:`, err);
        }
      }
    } catch (err) {
      console.error("[cron] Granola post-meeting sync failed:", err);
    } finally {
      granolaSyncRunning = false;
    }
  });

  // Granola: periodic sweep — every 30 minutes
  // Safety net that catches any meetings missed by the event-driven trigger
  cron.schedule("*/30 * * * *", async () => {
    if (granolaSweepRunning) {
      console.log("[cron] Granola sweep already running, skipping");
      return;
    }
    granolaSweepRunning = true;
    try {
      const { incrementalGranolaSync } = await import("../services/granola-sync.js");

      const granolaAccounts = await prisma.granolaAccount.findMany({
        select: { userId: true },
      });

      for (const account of granolaAccounts) {
        try {
          await incrementalGranolaSync(account.userId);
        } catch (err) {
          console.error(`[cron] Granola sweep sync failed for ${account.userId}:`, err);
        }
      }
    } catch (err) {
      console.error("[cron] Granola sweep sync failed:", err);
    } finally {
      granolaSweepRunning = false;
    }
  });

  // Scout tick — every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    if (scoutTickRunning) {
      console.log("[cron] Scout tick already running, skipping");
      return;
    }
    scoutTickRunning = true;
    try {
      const { tickScouts } = await import("../lib/scout-runner.js");
      await tickScouts();
    } catch (err) {
      console.error("[cron] Scout tick failed:", err);
    } finally {
      scoutTickRunning = false;
    }
  });

  // Clean up expired Verification records (PKCE verifiers, email tokens, etc.) — every hour
  cron.schedule("0 * * * *", async () => {
    try {
      const { count } = await prisma.verification.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) {
        console.log(`[cron] Cleaned up ${count} expired verification records`);
      }
    } catch (err) {
      console.error("[cron] Verification cleanup failed:", err);
    }
  });

  console.log("[cron] Started: Scout tick (5m)");

  console.log(
    "[cron] Started: SSE heartbeat (30s), webhook renewal (6h), reconciliation (4h), granola post-meeting (5m), granola sweep (30m), verification cleanup (1h)",
  );
}
