import { Hono } from "hono";
import { requireSecret } from "../middleware/scout-secret.js";

const internalScoutsRouter = new Hono();

internalScoutsRouter.post("/tick", requireSecret("SCOUT_TICK_SECRET"), async (c) => {
  const { tickScouts } = await import("../lib/scout-runner.js");
  await tickScouts();

  return c.json({ ok: true });
});

export { internalScoutsRouter };
