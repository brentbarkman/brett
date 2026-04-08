import { Hono } from "hono";
import { getStorageUrls } from "../lib/storage-urls.js";

const config = new Hono();

// Public — no auth middleware
config.get("/", (c) => {
  const { base, videoBaseUrl } = getStorageUrls();
  // storageBaseUrl points to the /public proxy so backgrounds resolve correctly
  return c.json({ videoBaseUrl, storageBaseUrl: `${base}/public` });
});

export { config };
