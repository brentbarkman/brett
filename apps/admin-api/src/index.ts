import { serve } from "@hono/node-server";

console.log("Starting admin API server...");

try {
  const { app } = await import("./app.js");
  const port = Number(process.env.PORT) || 3002;
  serve({ fetch: app.fetch, port });
  console.log(`Admin API server running on port ${port}`);
} catch (err) {
  console.error("Failed to start admin API server:", err);
  process.exit(1);
}
