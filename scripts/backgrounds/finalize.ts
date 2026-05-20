// scripts/backgrounds/finalize.ts
//
// Takes the curated winners.json and produces:
//   • backgrounds/photo/<segment>/<tier>-<N>.webp           (2560×1440 landscape)
//   • backgrounds/photo-portrait/<segment>/<tier>-<N>.webp  (1290×2796 portrait)
//   • packages/business/src/data/background-manifest.json   (slot → [paths])
//   • packages/business/src/data/image-attributions.json    (path → photographer info)
//
// Source JPGs are taken from scripts/backgrounds/downloads/candidates/... — no
// re-downloading from Unsplash. Run AFTER `pnpm source:candidates` + curation.
//
// Run: pnpm tsx scripts/backgrounds/finalize.ts

import fs from "fs";
import path from "path";
import sharp from "sharp";

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
type Winners = Record<string, WinnerSlot>;

type CandidateMeta = {
  id: string;
  photographer: string;
  unsplashUrl: string;
};
type CandidatePool = Record<string, Array<{
  id: string;
  photographer: string;
  unsplashUrl: string;
}>>;

const ROOT = path.resolve(__dirname, "../..");
const BG_DIR = path.join(ROOT, "backgrounds");
const LANDSCAPE_DIR = path.join(BG_DIR, "photo");
const PORTRAIT_DIR = path.join(BG_DIR, "photo-portrait");
const MANIFEST_OUT = path.join(ROOT, "packages/business/src/data/background-manifest.json");
const ATTR_OUT = path.join(ROOT, "packages/business/src/data/image-attributions.json");

const WINNERS = JSON.parse(fs.readFileSync(path.join(__dirname, "winners.json"), "utf-8")) as Winners;
const CANDIDATES = JSON.parse(fs.readFileSync(path.join(__dirname, "candidates.json"), "utf-8")) as CandidatePool;

const LANDSCAPE = { width: 2560, height: 1440, quality: 82 };
const PORTRAIT  = { width: 1290, height: 2796, quality: 82 };

// ─── Build photographer index from candidates.json + all v2 _meta.json files ─
const photog: Record<string, { name: string; url: string }> = {};
for (const arr of Object.values(CANDIDATES)) {
  for (const c of arr) photog[c.id] = { name: c.photographer, url: c.unsplashUrl };
}
const candidatesDir = path.join(__dirname, "downloads/candidates");
for (const seg of fs.readdirSync(candidatesDir)) {
  const segPath = path.join(candidatesDir, seg);
  if (!fs.statSync(segPath).isDirectory()) continue;
  for (const tier of fs.readdirSync(segPath)) {
    const metaPath = path.join(segPath, tier, "_meta.json");
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as CandidateMeta[];
    for (const c of meta) photog[c.id] = { name: c.photographer, url: c.unsplashUrl };
  }
}

async function processImage(
  source: string,
  outRel: string,
  config: typeof LANDSCAPE,
  cropFocus: "center" | "attention"
) {
  const outPath = path.join(BG_DIR, outRel);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(source)
    .resize(config.width, config.height, {
      fit: "cover",
      position: cropFocus,
      kernel: "lanczos3",
    })
    .webp({ quality: config.quality })
    .toFile(outPath);
  return outPath;
}

async function main() {
  // Wipe existing photo/ and photo-portrait/ so stale paths from the old
  // manifest don't linger and get uploaded.
  if (fs.existsSync(LANDSCAPE_DIR)) fs.rmSync(LANDSCAPE_DIR, { recursive: true });
  if (fs.existsSync(PORTRAIT_DIR))  fs.rmSync(PORTRAIT_DIR,  { recursive: true });

  const manifest: { version: number; sets: { photography: Record<string, Record<string, string[]>> } } = {
    version: 2,
    sets: { photography: {} },
  };
  const attributions: Record<string, {
    photographer: string;
    unsplashId: string;
    unsplashUrl: string;
  }> = {};

  const slots = Object.entries(WINNERS);
  console.log(`Finalizing ${slots.length} slots...\n`);

  for (let i = 0; i < slots.length; i++) {
    const [slotKey, info] = slots[i];
    const [seg, tier] = slotKey.split("/");

    manifest.sets.photography[seg] ??= {};
    manifest.sets.photography[seg][tier] = [];

    console.log(`[${i + 1}/${slots.length}] ${slotKey} (${info.images.length} image${info.images.length === 1 ? "" : "s"})`);

    for (let idx = 0; idx < info.images.length; idx++) {
      const img = info.images[idx];
      const source = path.join(__dirname, img.path);
      if (!fs.existsSync(source)) {
        console.error(`  ✗ Missing source: ${source}`);
        continue;
      }

      const n = idx + 1;
      const landscapeRel = `photo/${seg}/${tier}-${n}.webp`;
      const portraitRel  = `photo-portrait/${seg}/${tier}-${n}.webp`;
      const manifestKey  = landscapeRel; // manifest stores landscape paths

      await processImage(source, landscapeRel, LANDSCAPE, "center");
      await processImage(source, portraitRel,  PORTRAIT,  "attention");

      const landscapeKB = (fs.statSync(path.join(BG_DIR, landscapeRel)).size / 1024).toFixed(0);
      const portraitKB  = (fs.statSync(path.join(BG_DIR, portraitRel )).size / 1024).toFixed(0);
      console.log(`  → ${landscapeRel}  (${landscapeKB} KB landscape · ${portraitKB} KB portrait)`);

      manifest.sets.photography[seg][tier].push(manifestKey);
      const p = photog[img.id] ?? { name: "Unknown", url: `https://unsplash.com/photos/${img.id}` };
      attributions[manifestKey] = {
        photographer: p.name,
        unsplashId: img.id,
        unsplashUrl: p.url,
      };
    }
  }

  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(ATTR_OUT,     JSON.stringify(attributions, null, 2) + "\n");

  console.log(`\nWrote:`);
  console.log(`  ${MANIFEST_OUT}`);
  console.log(`  ${ATTR_OUT}`);
  console.log(`\nLandscape + portrait pairs in backgrounds/`);
  console.log(`Next: pnpm upload:backgrounds`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
