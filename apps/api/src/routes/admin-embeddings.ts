import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { requireAdmin } from "@brett/api-core";
import { runEmbeddingBackfill } from "../lib/embedding-backfill.js";

const router = new Hono<AuthEnv>();

// Single-flight guard, PER API INSTANCE. The backfill walks every user's
// items and calls the embedding provider — without a guard, two admin
// clicks launch two parallel walks that fight over DB connections and
// burn provider quota.
//
// CAVEAT: this is an in-process boolean, so it only guards against two
// clicks hitting the SAME replica. On a multi-replica deploy a second
// click that routes to another replica would still launch a parallel
// walk. If we ever scale past one replica, promote this to the CronLock
// pattern in `lib/cron-lock.ts`.
let backfillRunning = false;

router.post("/backfill", authMiddleware, requireAdmin, async (c) => {
  if (backfillRunning) {
    return c.json({ status: "already-running" }, 409);
  }
  backfillRunning = true;
  runEmbeddingBackfill()
    .catch((err) => console.error("[backfill] Fatal:", err))
    .finally(() => {
      backfillRunning = false;
    });

  return c.json({ status: "started" });
});

export default router;
