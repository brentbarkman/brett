// scripts/backgrounds/resource-round3.ts
//
// Third round of re-sourcing — bias even harder toward DARK upper zones so
// briefing prose (white serif, lives in the top ~25% of the desktop frame)
// reads cleanly.
//
//   dawn/light       — need TWO dark-topped picks (segment color story
//                      naturally pushes bright sky; force pre-dawn / blue
//                      hour / canopy-up shots)
//   afternoon/moderate — need ONE pick without sun glare in upper zone

import "dotenv/config";
import fs from "fs";
import path from "path";

const SLOTS: Record<string, string> = {
  "dawn/light":         "blue hour pre-dawn dark forest mist mountains",
  "afternoon/moderate": "rolling hills afternoon overcast soft natural landscape",
};

const PER_SLOT = 12;

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
    id: p.id, photographer: p.user.name, photographerUrl: p.user.links.html,
    unsplashUrl: p.links.html, downloadUrl: p.urls.full,
    trackDownloadUrl: p.links.download_location,
    width: p.width, height: p.height,
    altDescription: p.alt_description, color: p.color, likes: p.likes,
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
  const existing = JSON.parse(fs.readFileSync(CANDIDATES_JSON, "utf-8")) as Record<string, Candidate[]>;

  for (const [slot, query] of Object.entries(SLOTS)) {
    const [seg, tier] = slot.split("/");
    const v3Dir = path.join(CANDIDATES_DIR, seg, `${tier}-v3`);
    fs.mkdirSync(v3Dir, { recursive: true });
    console.log(`[${slot}]  query: "${query}"`);
    const candidates = await search(query);
    console.log(`  found ${candidates.length}, downloading...`);
    for (const c of candidates) {
      const outPath = path.join(v3Dir, `${c.id}.jpg`);
      await downloadToDisk(c, outPath);
      process.stdout.write(".");
    }
    console.log(" done");
    fs.writeFileSync(path.join(v3Dir, "_meta.json"), JSON.stringify(candidates, null, 2));
    existing[`${slot}-v3`] = candidates;
    fs.writeFileSync(CANDIDATES_JSON, JSON.stringify(existing, null, 2));
  }
  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
