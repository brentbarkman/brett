// scripts/backgrounds/process-images.ts

import fs from "fs";
import path from "path";
import sharp from "sharp";

type SourceEntry = {
  segment: string;
  tier: string;
  slot: string;
  unsplashId: string;
  photographer: string;
  unsplashUrl: string;
  downloadUrl: string;
};

const SOURCES_PATH = path.resolve(__dirname, "replacement-sources.json");
const DOWNLOAD_DIR = path.resolve(__dirname, "downloads");
const BG_DIR = path.resolve(__dirname, "../../backgrounds");

const TARGET_WIDTH = 2560;
const TARGET_HEIGHT = 1440;
const QUALITY = 80;

async function downloadImage(url: string, outPath: string) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status} ${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

async function main() {
  if (!fs.existsSync(SOURCES_PATH)) {
    console.error(`Missing ${SOURCES_PATH}. Run 'pnpm source:backgrounds' first.`);
    process.exit(1);
  }

  if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const sources: Record<string, SourceEntry> = JSON.parse(
    fs.readFileSync(SOURCES_PATH, "utf-8")
  );

  const entries = Object.values(sources);
  console.log(`Processing ${entries.length} images...\n`);

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const downloadPath = path.join(DOWNLOAD_DIR, `${e.unsplashId}.jpg`);
    const outPath = path.resolve(BG_DIR, e.slot);

    // Download (skip if already on disk — script is resumable)
    if (!fs.existsSync(downloadPath)) {
      console.log(`[${i + 1}/${entries.length}] Downloading ${e.unsplashId}...`);
      await downloadImage(e.downloadUrl, downloadPath);
    } else {
      console.log(`[${i + 1}/${entries.length}] Already downloaded ${e.unsplashId}`);
    }

    // Convert
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await sharp(downloadPath)
      .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "cover", position: "center" })
      .webp({ quality: QUALITY })
      .toFile(outPath);

    const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(0);
    console.log(`  → ${e.slot} (${sizeKB} KB)`);
  }

  console.log("\nDone. Run 'pnpm tsx scripts/upload-backgrounds.ts' to upload.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
