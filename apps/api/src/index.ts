import { serve } from "@hono/node-server";

console.log("Starting server...");

try {
  const { app } = await import("./app.js");
  const port = Number(process.env.PORT) || 3001;
  serve({ fetch: app.fetch, port });
  console.log(`API server running on port ${port}`);
} catch (err) {
  console.error("Failed to start server:", err);
  process.exit(1);
}
