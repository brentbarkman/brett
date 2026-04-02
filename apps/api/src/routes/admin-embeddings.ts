import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { requireAdmin } from "@brett/api-core";
import { runEmbeddingBackfill } from "../lib/embedding-backfill.js";

const router = new Hono<AuthEnv>();

router.post("/backfill", authMiddleware, requireAdmin, async (c) => {
  // Fire-and-forget
  runEmbeddingBackfill().catch((err) => console.error("[backfill] Fatal:", err));

  return c.json({ status: "started" });
});

export default router;
