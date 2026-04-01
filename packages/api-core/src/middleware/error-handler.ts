import type { Context } from "hono";

export function errorHandler(err: Error, c: Context) {
  console.error(`[api-core] Unhandled error: ${err.message}`, err.stack);
  return c.json({ error: "Internal server error" }, 500);
}
