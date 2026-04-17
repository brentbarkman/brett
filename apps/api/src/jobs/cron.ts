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
let newsletterCleanupRunning = false;

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

  // Meeting notes: calendar-event-driven sync — every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    if (granolaSyncRunning) return;
    granolaSyncRunning = true;
    try {
      const { meetingCoordinator } = await import("../services/meeting-providers/registry.js");

      const now = new Date();
      const windowEnd = new Date(now.getTime() - 5 * 60 * 1000);
      const windowStart = new Date(now.getTime() - 15 * 60 * 1000);

      const recentlyEnded = await prisma.calendarEvent.findMany({
        where: {
          endTime: { gte: windowStart, lte: windowEnd },
          isAllDay: false,
        },
      });

      for (const event of recentlyEnded) {
        try {
          await meetingCoordinator.syncForEvent(event.userId, event);
        } catch (err) {
          console.error(`[cron] Meeting sync failed for event ${event.id}:`, err);
        }
      }
    } catch (err) {
      console.error("[cron] Post-meeting sync failed:", err);
    } finally {
      granolaSyncRunning = false;
    }
  });

  // Meeting notes: periodic sweep — every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    if (granolaSweepRunning) return;
    granolaSweepRunning = true;
    try {
      const { meetingCoordinator } = await import("../services/meeting-providers/registry.js");
      const { isWithinWorkingHours } = await import("../services/granola-sync.js");

      const [granolaUsers, googleUsers] = await Promise.all([
        prisma.granolaAccount.findMany({ select: { userId: true } }),
        prisma.googleAccount.findMany({ where: { hasMeetingNotesScope: true }, select: { userId: true } }),
      ]);

      const userIds = [...new Set([
        ...granolaUsers.map((a) => a.userId),
        ...googleUsers.map((a) => a.userId),
      ])];

      for (const userId of userIds) {
        try {
          // Skip users outside working hours (8am-7pm in their timezone)
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { timezone: true },
          });
          if (user?.timezone && !isWithinWorkingHours(user.timezone)) {
            continue;
          }

          const now = new Date();
          const startOfDay = new Date(now);
          startOfDay.setHours(0, 0, 0, 0);

          await meetingCoordinator.syncRecent(userId, startOfDay, now);
        } catch (err) {
          console.error(`[cron] Meeting sweep failed for ${userId}:`, err);
        }
      }
    } catch (err) {
      console.error("[cron] Meeting sweep failed:", err);
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

  // IdempotencyKey cleanup — daily at 3:15am. The sync-push table grows on
  // every mobile mutation and has no built-in expiry. Keep 30 days to comfortably
  // outlive client retry windows.
  cron.schedule("15 3 * * *", async () => {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { count } = await prisma.idempotencyKey.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (count > 0) {
        console.log(`[cron] Cleaned up ${count} stale idempotency keys`);
      }
    } catch (err) {
      console.error("[cron] Idempotency key cleanup failed:", err);
    }
  });

  // Pending newsletter cleanup — daily at 3am
  cron.schedule("0 3 * * *", async () => {
    if (newsletterCleanupRunning) return;
    newsletterCleanupRunning = true;
    try {
      const { cleanupExpiredPending } = await import("../lib/newsletter-ingest.js");
      const cleaned = await cleanupExpiredPending();
      if (cleaned > 0) {
        console.log(`[cron] Cleaned up ${cleaned} expired pending newsletters`);
      }
    } catch (err) {
      console.error("[cron] Pending newsletter cleanup failed:", err);
    } finally {
      newsletterCleanupRunning = false;
    }
  });

  console.log("[cron] Started: Scout tick (5m)");

  console.log(
    "[cron] Started: SSE heartbeat (30s), webhook renewal (6h), reconciliation (4h), meeting post-event (5m), meeting sweep (30m), verification cleanup (1h), newsletter cleanup (daily)",
  );
}
