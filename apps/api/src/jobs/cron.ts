import cron from "node-cron";
import { sendHeartbeats, getConnectionCount } from "../lib/sse.js";
import { prisma } from "../lib/prisma.js";

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

      // TODO: implement renewWatch in calendar-sync service
      // const { renewWatch } = await import("../services/calendar-sync.js");
      // for (const cal of expiring) {
      //   try {
      //     await renewWatch(cal);
      //   } catch (err) {
      //     console.error(`[cron] Failed to renew watch for calendar ${cal.id}:`, err);
      //   }
      // }
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
