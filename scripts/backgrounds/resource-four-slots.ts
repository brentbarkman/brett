// scripts/backgrounds/resource-four-slots.ts
//
// One-off re-source for four slots whose first pick the user rejected:
//   dawn/light       — original mid-band too bright (briefing readability)
//   afternoon/light  — user disliked the Moroccan-village character
//   afternoon/moderate — user disliked the close-up macro "faux-photo" feel
//   night/moderate   — first pick too bright (briefing readability)
//
// Strategy: tighter queries biased toward dark mid-bands for the night/dawn
// slots, and toward pure natural landscapes (no architecture, no macro) for
// the afternoon slots. Saves to "<seg>/<tier>-v2/" so the existing candidates
// stay intact for fallback.

import "dotenv/config";
import fs from "fs";
import path from "path";

const SLOTS: Record<string, string> = {
  "dawn/light":         "dawn forest fog dark calm atmospheric landscape",
  "afternoon/light":    "open prairie afternoon soft warm minimal landscape",
  "afternoon/moderate": "rolling hills afternoon warm landscape painterly nature",
  "night/moderate":     "moonlit mountains starry dark landscape long exposure",
};

const PER_SLOT = 10; // pull more than usual since we're narrowing afterward

type Candidate = {
  id: string;
  photographer: string;
  photographerUrl: string;
  unsplashUrl: string;
  downloadUrl: string;
  trackDownloadUrl: string;
  width: number;
  height: number;
  altDescription: string | null;
  color: string;
  likes: number;
};

const ROOT = __dirname;
const CANDIDATES_DIR = path.join(ROOT, "downloads/candidates");
const CANDIDATES_JSON = path.join(ROOT, "candidates.json");

const keys = [1, 2, 3, 4, 5]
  .map((n) => process.env[`UNSPLASH_ACCESS_KEY_${n}`])
  .filter((k): k is string => Boolean(k));
if (keys.length === 0) { console.error("No UNSPLASH_ACCESS_KEY_1..5 set"); process.exit(1); }
let keyIdx = 0;
const nextKey = () => keys[keyIdx++ % keys.length];

async function api(pathname: string) {
  const resp = await fetch(`https://api.unsplash.com${pathname}`, {
    headers: { Authorization: `Client-ID ${nextKey()}` },
  });
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function search(query: string): Promise<Candidate[]> {
  const params = new URLSearchParams({
    query, orientation: "landscape", order_by: "editorial",
    per_page: String(PER_SLOT), page: "1",
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

async function downloadToDisk(c: Candidate, outPath: string) {
  if (fs.existsSync(outPath)) return;
  const resp = await fetch(c.downloadUrl);
  if (!resp.ok) throw new Error(`CDN ${resp.status}`);
  fs.writeFileSync(outPath, Buffer.from(await resp.arrayBuffer()));
  try {
    await fetch(c.trackDownloadUrl, { headers: { Authorization: `Client-ID ${nextKey()}` } });
  } catch { /* ignore */ }
}

async function main() {
  // Load the existing combined candidates.json so build-gallery can still find
  // photographer info for the new picks once we merge them in.
  const existing = JSON.parse(fs.readFileSync(CANDIDATES_JSON, "utf-8")) as Record<string, Candidate[]>;

  for (const [slot, query] of Object.entries(SLOTS)) {
    const [seg, tier] = slot.split("/");
    const v2Dir = path.join(CANDIDATES_DIR, seg, `${tier}-v2`);
    fs.mkdirSync(v2Dir, { recursive: true });
    console.log(`[${slot}]  query: "${query}"`);
    const candidates = await search(query);
    console.log(`  found ${candidates.length}, downloading...`);
    for (const c of candidates) {
      const outPath = path.join(v2Dir, `${c.id}.jpg`);
      await downloadToDisk(c, outPath);
      process.stdout.write(".");
    }
    console.log(" done");
    // Write meta so build-gallery can map id → photographer.
    fs.writeFileSync(path.join(v2Dir, "_meta.json"), JSON.stringify(candidates, null, 2));
    // Merge into candidates.json under v2 key so the gallery photog index picks it up too.
    existing[`${slot}-v2`] = candidates;
    fs.writeFileSync(CANDIDATES_JSON, JSON.stringify(existing, null, 2));
  }

  console.log("\nDone. Candidates added under -v2 dirs.");
}

main().catch((e) => { console.error(e); process.exit(1); });
