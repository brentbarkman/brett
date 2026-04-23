import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { requireAdmin } from "@brett/api-core";
import { runEmbeddingBackfill } from "../lib/embedding-backfill.js";

const router = new Hono<AuthEnv>();

// Single-flight guard. The backfill walks every user's items and calls the
// embedding provider — without a guard, two admin clicks launch two parallel
// walks that fight over DB connections and burn provider quota.
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
