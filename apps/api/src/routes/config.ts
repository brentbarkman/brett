import { Hono } from "hono";

const config = new Hono();

// Public — no auth middleware
config.get("/", (c) => {
  const endpoint = process.env.STORAGE_ENDPOINT || "";
  const bucket = process.env.STORAGE_BUCKET || "brett";
  const videoBaseUrl = endpoint ? `${endpoint}/${bucket}/public/videos` : "";

  return c.json({ videoBaseUrl });
});

export { config };
