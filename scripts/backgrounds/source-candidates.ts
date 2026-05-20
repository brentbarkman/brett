// scripts/backgrounds/source-candidates.ts
//
// Pull a wide candidate pool from Unsplash for every (segment, tier)
// slot in the wallpaper manifest. Bypasses the audit step — assumes a
// from-scratch refresh ("start over" mode).
//
// Output:
//   scripts/backgrounds/downloads/candidates/<segment>/<tier>/<id>.jpg
//   scripts/backgrounds/candidates.json   ← keyed by slot, value: [{ id, photographer, urls... }]
//
// Workflow:
//   1) pnpm source:candidates              ← this script
//   2) hand-curate via the review gallery  ← separate step
//   3) write winners to replacement-sources.json
//   4) pnpm process:backgrounds + portraits + upload
//
// Rate limit strategy:
//   Unsplash demo keys = 50 req/hr each. With 5 keys we round-robin
//   per request → ~250 req/hr effective. This script makes
//   18 slots × 1 search + 18 × 8 download-tracking pings = 162 reqs,
//   well under one hourly bucket. The download itself goes to the CDN
//   (no API quota) so it's free.

import "dotenv/config";
import fs from "fs";
import path from "path";
import { QUERY_BY_CATEGORY } from "./unsplash-queries";

type Candidate = {
  id: string;
  photographer: string;
  photographerUrl: string;
  unsplashUrl: string;
  downloadUrl: string;       // full-res image bytes
  trackDownloadUrl: string;  // call after download per API guidelines
  width: number;
  height: number;
  altDescription: string | null;
  color: string;             // Unsplash's dominant color (#rrggbb)
  likes: number;
};

type CandidatePool = Record<
  string, // slot path e.g. "photo/dawn/light-1.webp" — but here we use category key "dawn/light"
  Candidate[]
>;

const CANDIDATES_DIR = path.resolve(__dirname, "downloads/candidates");
const CANDIDATES_JSON = path.resolve(__dirname, "candidates.json");
const CANDIDATES_PER_SLOT = 8;

// ── Key rotation ────────────────────────────────────────────────────────
const keys = [1, 2, 3, 4, 5]
  .map((n) => process.env[`UNSPLASH_ACCESS_KEY_${n}`])
  .filter((k): k is string => Boolean(k));

if (keys.length === 0) {
  console.error("No UNSPLASH_ACCESS_KEY_1..5 in .env");
  process.exit(1);
}

let keyIdx = 0;
function nextKey(): string {
  const k = keys[keyIdx % keys.length];
  keyIdx++;
  return k;
}

async function api(pathname: string): Promise<any> {
  const key = nextKey();
  const url = `https://api.unsplash.com${pathname}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Client-ID ${key}` },
  });
  if (resp.status === 403) {
    const body = await resp.text();
    throw new Error(
      `Rate-limited on key #${(keyIdx - 1) % keys.length + 1}. Body: ${body}`
    );
  }
  if (!resp.ok) {
    throw new Error(`Unsplash ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

async function search(query: string): Promise<Candidate[]> {
  // editorial = Unsplash's hand-curated photo set; far higher photobook
  // hit rate than relevance ordering. orientation=landscape so the source
  // can be cropped to both 16:9 (desktop) and 9:19.5 (iOS portrait).
  const params = new URLSearchParams({
    query,
    orientation: "landscape",
    order_by: "editorial",
    per_page: String(CANDIDATES_PER_SLOT),
    page: "1",
  });
  const data = await api(`/search/photos?${params}`);
  return data.results.map((p: any): Candidate => ({
    id: p.id,
    photographer: p.user.name,
    photographerUrl: p.user.links.html,
    unsplashUrl: p.links.html,
    downloadUrl: p.urls.full,
    trackDownloadUrl: p.links.download_location,
    width: p.width,
    height: p.height,
    altDescription: p.alt_description,
    color: p.color,
    likes: p.likes,
  }));
}

async function downloadToDisk(c: Candidate, outPath: string): Promise<void> {
  if (fs.existsSync(outPath)) return; // resumable
  const resp = await fetch(c.downloadUrl);
  if (!resp.ok) throw new Error(`CDN download failed ${resp.status} for ${c.id}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  // Required by Unsplash API guidelines after any user-facing download.
  // Even though candidates are internal review, we count an effective
  // download once per pulled image. Errors here are non-fatal.
  try {
    await fetch(c.trackDownloadUrl, {
      headers: { Authorization: `Client-ID ${nextKey()}` },
    });
  } catch { /* ignore */ }
}

async function main() {
  fs.mkdirSync(CANDIDATES_DIR, { recursive: true });

  const pool: CandidatePool = {};
  const slots = Object.keys(QUERY_BY_CATEGORY);
  console.log(`Sourcing candidates for ${slots.length} slots using ${keys.length} keys...\n`);

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]; // e.g. "dawn/light"
    const query = QUERY_BY_CATEGORY[slot];
    const slotDir = path.join(CANDIDATES_DIR, slot);
    fs.mkdirSync(slotDir, { recursive: true });

    console.log(`[${i + 1}/${slots.length}] ${slot}  ← "${query}"`);
    try {
      const candidates = await search(query);
      console.log(`  found ${candidates.length}, downloading...`);

      for (const c of candidates) {
        const outPath = path.join(slotDir, `${c.id}.jpg`);
        await downloadToDisk(c, outPath);
        process.stdout.write(".");
      }
      console.log(" done");

      pool[slot] = candidates;
      // Persist after each slot so a mid-run failure is recoverable.
      fs.writeFileSync(CANDIDATES_JSON, JSON.stringify(pool, null, 2));
    } catch (err) {
      console.error(`  FAILED: ${(err as Error).message}`);
      // Keep going — partial pool is still useful.
    }
  }

  console.log(`\nDone. ${Object.values(pool).reduce((n, c) => n + c.length, 0)} candidates across ${Object.keys(pool).length} slots.`);
  console.log(`Metadata: ${CANDIDATES_JSON}`);
  console.log(`Files:    ${CANDIDATES_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
