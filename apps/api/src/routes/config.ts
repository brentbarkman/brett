import { Hono } from "hono";
import { backgroundManifest } from "@brett/business";
import { getStorageUrls } from "../lib/storage-urls.js";

const config = new Hono();

// Public — no auth middleware
config.get("/", (c) => {
  const { base, videoBaseUrl } = getStorageUrls();
  // storageBaseUrl points to the /public proxy so backgrounds resolve correctly
  return c.json({ videoBaseUrl, storageBaseUrl: `${base}/public` });
});

// Public — the wallpaper manifest. Both clients used to bundle their
// own copy of `background-manifest.json`; iOS in particular shipped
// a stale copy whenever the desktop side curated new picks, leaving
// the phone with a smaller subset until the next App Store release.
// Serving the live manifest from the API lets a `pnpm upload:backgrounds`
// + an API redeploy propagate new wallpapers to every iOS user on next
// foreground without an iOS release. Bundled fallback still ships in
// `apps/ios/Brett/Resources/background-manifest.json` for cold launch
// / offline.
config.get("/background-manifest", (c) => {
  // 5 min cache so repeated cold launches don't hammer the API.
  // The manifest is small (~5 KB) and changes infrequently — a brief
  // staleness window is well worth the cache hit rate.
  c.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  return c.json(backgroundManifest);
});

export { config };
