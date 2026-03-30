import { Hono } from "hono";
import { getStorageUrls } from "../lib/storage-urls.js";

const config = new Hono();

// Public — no auth middleware
config.get("/", (c) => {
  const { videoBaseUrl } = getStorageUrls();
  return c.json({ videoBaseUrl });
});

export { config };
