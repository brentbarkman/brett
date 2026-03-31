import crypto from "node:crypto";
import { Hono } from "hono";

const internalScoutsRouter = new Hono();

internalScoutsRouter.post("/tick", async (c) => {
  const secret = c.req.header("x-scout-secret") ?? "";
  const expected = process.env.SCOUT_TICK_SECRET ?? "";

  if (!expected || secret.length !== expected.length) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  try {
    if (!crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { tickScouts } = await import("../lib/scout-runner.js");
  await tickScouts();

  return c.json({ ok: true });
});

export { internalScoutsRouter };
