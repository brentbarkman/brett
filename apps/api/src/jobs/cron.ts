import cron from "node-cron";
import { sendHeartbeats, getConnectionCount } from "../lib/sse.js";
import { prisma } from "../lib/prisma.js";
import { getCalendarClient, watchCalendar, stopWatch } from "../lib/google-calendar.js";
import { generateId } from "@brett/utils";
import { createHmac } from "crypto";
import { withCronLock } from "../lib/cron-lock.js";

// Per-job lease windows. The lease must outlive the job's actual runtime
// but should be short enough that a crashed replica's lease expires before
// the next scheduled tick. All values are conservative upper bounds.
const LEASE = {
  webhookRenewal: 30 * 60_000, // 30 min
  reconciliation: 30 * 60_000,
  granolaPerEvent: 10 * 60_000,
  granolaSweep: 20 * 60_000,
  scoutTick: 10 * 60_000,
  verificationCleanup: 5 * 60_000,
  idempotencyCleanup: 5 * 60_000,
  newsletterCleanup: 5 * 60_000,
  briefingMorningBootstrap: 5 * 60_000,
} as const;

// Briefing morning bootstrap window — local time at the user. We sweep
// every 5 min (the cron cadence) and any user whose local time is in
// this window AND hasn't been triggered today gets a fresh dirty bit.
// Width must be ≥ cron cadence so we never miss the window across a
// boundary. Picked 7:00am as the centerpoint, ±5 min for safety.
const BRIEFING_BOOTSTRAP_HOUR_MIN = 6 * 60 + 55; // 6:55am local
const BRIEFING_BOOTSTRAP_HOUR_MAX = 7 * 60 + 5; // 7:05am local

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
    await withCronLock("webhookRenewal", LEASE.webhookRenewal, async () => {
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

      const webhookBaseUrl = process.env.GOOGLE_WEBHOOK_BASE_URL;
      if (!webhookBaseUrl) {
        console.warn("[cron] GOOGLE_WEBHOOK_BASE_URL not set, skipping webhook renewal");
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

          const channel = await watchCalendar(client, cal.googleCalendarId, channelId, token, webhookBaseUrl);

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
    });
  });

  // Periodic reconciliation — every 4 hours
  // Run incremental sync for all connected accounts
  cron.schedule("0 */4 * * *", async () => {
    await withCronLock("reconciliation", LEASE.reconciliation, async () => {
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
    });
  });

  // Meeting notes: calendar-event-driven sync — every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    await withCronLock("granolaSync", LEASE.granolaPerEvent, async () => {
      const { meetingCoordinator } = await import("../services/meeting-providers/registry.js");

      const now = new Date();
      const windowEnd = new Date(now.getTime() - 5 * 60 * 1000);
      const windowStart = new Date(now.getTime() - 15 * 60 * 1000);

      // Scope to users who have meeting-notes providers wired up — there's
      // no reason to pull events for users who can't act on them, and
      // pulling all users' events unfiltered scales poorly.
      const [granolaUsers, googleUsers] = await Promise.all([
        prisma.granolaAccount.findMany({ select: { userId: true } }),
        prisma.googleAccount.findMany({
          where: { hasMeetingNotesScope: true },
          select: { userId: true },
        }),
      ]);
      const eligibleUserIds = [...new Set([
        ...granolaUsers.map((a) => a.userId),
        ...googleUsers.map((a) => a.userId),
      ])];
      if (eligibleUserIds.length === 0) return;

      const recentlyEnded = await prisma.calendarEvent.findMany({
        where: {
          userId: { in: eligibleUserIds },
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
    });
  });

  // Meeting notes: periodic sweep — every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    await withCronLock("granolaSweep", LEASE.granolaSweep, async () => {
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

      if (userIds.length === 0) return;

      // Batch the timezone lookup. The previous per-iteration findUnique was
      // O(users) round-trips inside the cron-lock lease window — amplified
      // by multi-Granola (each user can have N accounts so the upstream
      // findMany returns more rows even though we dedupe). One query here.
      const usersWithTz = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, timezone: true },
      });
      const tzByUserId = new Map(usersWithTz.map((u) => [u.id, u.timezone]));

      for (const userId of userIds) {
        try {
          // Skip users outside working hours (8am-7pm in their timezone)
          const tz = tzByUserId.get(userId);
          if (tz && !isWithinWorkingHours(tz)) {
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
    });
  });

  // Scout tick — every 5 minutes
  cron.schedule("*/5 * * * *", async () => {
    await withCronLock("scoutTick", LEASE.scoutTick, async () => {
      const { tickScouts } = await import("../lib/scout-runner.js");
      await tickScouts();
    });
  });

  // Clean up expired Verification records (PKCE verifiers, email tokens, etc.) — every hour
  cron.schedule("0 * * * *", async () => {
    await withCronLock("verificationCleanup", LEASE.verificationCleanup, async () => {
      const { count } = await prisma.verification.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      if (count > 0) {
        console.log(`[cron] Cleaned up ${count} expired verification records`);
      }
    });
  });

  // IdempotencyKey cleanup — daily at 3:15am. The sync-push table grows on
  // every mobile mutation.
  //
  // Retention = 30 days. Shorter (e.g. 7d) is tempting because the typical
  // client retry window is seconds-to-minutes, but iOS `MutationQueue` has
  // NO age-based pruning — a mutation enqueued while offline lives
  // indefinitely and keeps its original idempotency key across restarts.
  // A device offline >7d that reconnects would have its queued mutations
  // replayed against an empty server-side cache, bypassing idempotency
  // and potentially double-applying CREATEs. Keys are user-scoped
  // (see `scopedKey` in routes/sync.ts), so cross-user collision isn't a
  // concern; row volume is the only real cost, which 30d handles fine.
  cron.schedule("15 3 * * *", async () => {
    await withCronLock("idempotencyCleanup", LEASE.idempotencyCleanup, async () => {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { count } = await prisma.idempotencyKey.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (count > 0) {
        console.log(`[cron] Cleaned up ${count} stale idempotency keys`);
      }
    });
  });

  // Pending newsletter cleanup — daily at 3am
  cron.schedule("0 3 * * *", async () => {
    await withCronLock("newsletterCleanup", LEASE.newsletterCleanup, async () => {
      const { cleanupExpiredPending } = await import("../lib/newsletter-ingest.js");
      const cleaned = await cleanupExpiredPending();
      if (cleaned > 0) {
        console.log(`[cron] Cleaned up ${cleaned} expired pending newsletters`);
      }
    });
  });

  // Briefing morning bootstrap — every 5 minutes.
  //
  // Find every user whose local time is in the 6:55-7:05 window AND
  // who hasn't been bootstrapped today, then set dirtyAt + reset the
  // per-day regen counter in a single bulk update. The actual pipeline
  // runs lazily on the next client /briefing/refresh after they open
  // the app.
  //
  // Iterates all users in memory (one User query + one UserBriefing
  // query) and issues a single bulk `updateMany`. At current scale
  // (low thousands) this is fine; the per-user TZ math is cheap
  // compared to a per-user `findUnique` round-trip.
  cron.schedule("*/5 * * * *", async () => {
    await withCronLock(
      "briefingMorningBootstrap",
      LEASE.briefingMorningBootstrap,
      async () => {
        const now = new Date();

        const localMinutesAndDay = (
          tz: string,
        ): { mins: number; dayKey: string } | null => {
          try {
            const parts = new Intl.DateTimeFormat("en-CA", {
              timeZone: tz,
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }).formatToParts(now);
            const get = (t: string) =>
              parts.find((p) => p.type === t)?.value ?? "";
            const hour = parseInt(get("hour"), 10) % 24;
            const minute = parseInt(get("minute"), 10);
            return {
              mins: hour * 60 + minute,
              dayKey: `${get("year")}-${get("month")}-${get("day")}`,
            };
          } catch {
            return null;
          }
        };

        // 1. All users (id + timezone). Cheap select.
        const users = await prisma.user.findMany({
          select: { id: true, timezone: true },
        });

        // 2. Filter to those currently in the bootstrap window.
        const inWindow: Array<{ id: string; dayKey: string }> = [];
        for (const u of users) {
          const parts = localMinutesAndDay(u.timezone);
          if (!parts) continue;
          if (
            parts.mins < BRIEFING_BOOTSTRAP_HOUR_MIN ||
            parts.mins >= BRIEFING_BOOTSTRAP_HOUR_MAX
          )
            continue;
          inWindow.push({ id: u.id, dayKey: parts.dayKey });
        }
        if (inWindow.length === 0) return;

        // 3. One bulk query to find existing rows that need updating.
        //    A row needs an update when regenDayKey != today (the day
        //    rolled over) — that's the only condition under which we
        //    haven't already bootstrapped today. Group by dayKey so we
        //    can update each group efficiently.
        const byDayKey = new Map<string, string[]>();
        for (const u of inWindow) {
          const arr = byDayKey.get(u.dayKey) ?? [];
          arr.push(u.id);
          byDayKey.set(u.dayKey, arr);
        }

        let totalBootstrapped = 0;
        for (const [dayKey, userIds] of byDayKey) {
          const result = await prisma.userBriefing.updateMany({
            where: {
              userId: { in: userIds },
              // Only bootstrap once per user-local day — if regenDayKey
              // already matches today, we've already fired the morning
              // dirty bit for this user.
              regenDayKey: { not: dayKey },
            },
            data: {
              dirtyAt: now,
              regenCountToday: 0,
              regenDayKey: dayKey,
              lastTriggerSource: "morning_bootstrap",
            },
          });
          totalBootstrapped += result.count;
        }

        if (totalBootstrapped > 0) {
          console.log(
            `[cron] Bootstrapped morning briefing for ${totalBootstrapped} users`,
          );
        }
      },
    );
  });

  console.log("[cron] Started: Scout tick (5m)");

  console.log(
    "[cron] Started: SSE heartbeat (30s), webhook renewal (6h), reconciliation (4h), meeting post-event (5m), meeting sweep (30m), verification cleanup (1h), newsletter cleanup (daily), briefing bootstrap (5m)",
  );
}
