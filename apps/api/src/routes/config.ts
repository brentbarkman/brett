import { Hono } from "hono";
import { getStorageUrls } from "../lib/storage-urls.js";

const config = new Hono();

// Public — no auth middleware
config.get("/", (c) => {
  const { base, videoBaseUrl } = getStorageUrls();
  const newsletterIngestEmail = process.env.NEWSLETTER_INGEST_EMAIL || null;
  // storageBaseUrl points to the /public proxy so backgrounds resolve correctly
  return c.json({ videoBaseUrl, storageBaseUrl: `${base}/public`, newsletterIngestEmail });
});

export { config };
