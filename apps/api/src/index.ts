import { serve } from "@hono/node-server";

// Fail fast if critical secrets are missing or misconfigured
const REQUIRED_ENV = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: Required environment variable ${key} is not set`);
    process.exit(1);
  }
}
if (process.env.BETTER_AUTH_SECRET!.length < 32) {
  console.error("FATAL: BETTER_AUTH_SECRET must be at least 32 characters");
  process.exit(1);
}
const encKey = process.env.TOKEN_ENCRYPTION_KEY || process.env.CALENDAR_TOKEN_ENCRYPTION_KEY;
if (encKey && encKey.length !== 64) {
  console.error("FATAL: TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  process.exit(1);
}

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
