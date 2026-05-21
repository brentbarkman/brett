// scripts/backgrounds/rehydrate-sources.ts
//
// Walks `winners.json`, downloads any missing source JPG from Unsplash's
// public `/photos/<id>/download?force=true` endpoint, and writes it to
// the exact path the winner entry expects. Uses no API key — the public
// endpoint redirects to the CDN and is rate-limited per-IP rather than
// per-key, which is what we want for a one-shot rehydrate.
//
// Why this exists: `winners.json` paths point into `downloads/candidates/`
// which is gitignored. After a fresh checkout (or after deleting a
// worktree, like we just did), `finalize.ts` would fail trying to read
// JPGs that aren't on disk. This script makes finalize idempotent
// against the curated set — re-fetches sources by ID so the next
// finalize/upload cycle produces the exact images that were curated.

import fs from "fs";
import path from "path";

type WinnerImage = {
  id: string;
  path: string;
  why?: string;
  approved?: boolean;
};

type WinnerSlot = {
  locked?: boolean;
  note?: string;
  images: WinnerImage[];
};

const ROOT = __dirname;
const WINNERS = JSON.parse(
  fs.readFileSync(path.join(ROOT, "winners.json"), "utf-8"),
) as Record<string, WinnerSlot>;

async function downloadById(id: string, outPath: string): Promise<"hit" | "downloaded"> {
  if (fs.existsSync(outPath)) return "hit";
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Public Unsplash download endpoint — auto-redirects to CDN. No API
  // key needed. Per-IP rate limit is generous (we measured ~30/min).
  const url = `https://unsplash.com/photos/${id}/download?force=true`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`${id}: HTTP ${resp.status}`);
  }
  fs.writeFileSync(outPath, Buffer.from(await resp.arrayBuffer()));
  return "downloaded";
}

async function main() {
  const allImages: Array<{ slot: string; img: WinnerImage }> = [];
  for (const [slotKey, slot] of Object.entries(WINNERS)) {
    for (const img of slot.images) {
      allImages.push({ slot: slotKey, img });
    }
  }
  console.log(`Walking ${allImages.length} winners across ${Object.keys(WINNERS).length} slots...\n`);

  let hits = 0;
  let downloads = 0;
  let failures = 0;
  for (let i = 0; i < allImages.length; i++) {
    const { slot, img } = allImages[i];
    const fullPath = path.join(ROOT, img.path);
    try {
      const result = await downloadById(img.id, fullPath);
      if (result === "hit") {
        hits++;
        process.stdout.write(".");
      } else {
        downloads++;
        process.stdout.write("D");
        // Tiny throttle between fresh downloads — public endpoint's
        // rate limit is by-IP-per-window; this keeps us comfortable
        // under it without slowing cache-hit runs.
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      failures++;
      console.error(`\n  ✗ ${slot} / ${img.id}: ${(err as Error).message}`);
    }
    if ((i + 1) % 20 === 0) {
      process.stdout.write(` [${i + 1}/${allImages.length}]\n`);
    }
  }

  console.log(`\n\nDone.`);
  console.log(`  Cache hits:   ${hits}`);
  console.log(`  Downloaded:   ${downloads}`);
  console.log(`  Failures:     ${failures}`);
  if (failures > 0) {
    console.log(`\n  Re-run to retry failed downloads (they're cached-or-skipped).`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
