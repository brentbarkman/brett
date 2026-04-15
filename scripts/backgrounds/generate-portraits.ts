// scripts/backgrounds/generate-portraits.ts
//
// Produces iOS-ready portrait variants of every wallpaper slot.
//
// Source per slot:
//   • If image-attributions.json has an unsplashId → download full-res from
//     Unsplash's public /download endpoint (no API key needed).
//   • Otherwise ("original curated set") → pull the existing landscape WebP
//     from PUBLIC bucket storage and upscale. Flag the slot so we know to
//     re-source when possible.
//
// Output: 1290×2796 (iPhone 15 Pro Max 3x) WebP, sharp `position: "attention"`
// picks the most interesting crop window. Written to backgrounds/photo-portrait/
// mirroring the landscape layout.
//
// Run locally first against MinIO to preview, then again with Railway env
// vars to publish to production.

import "dotenv/config";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { publicS3 as s3, PUBLIC_BUCKET as BUCKET } from "../s3";

const ATTR_PATH = path.resolve(
  __dirname,
  "../../apps/desktop/src/data/image-attributions.json"
);
const PORTRAIT_DIR = path.resolve(__dirname, "../../backgrounds/photo-portrait");
const CACHE_DIR = path.resolve(__dirname, "downloads-portrait-src");

const TARGET_W = 1290;
const TARGET_H = 2796;
const QUALITY = 80;

type Attr = {
  photographer: string | null;
  unsplashId: string | null;
  unsplashUrl: string | null;
  note?: string;
};

async function downloadUnsplash(id: string, outPath: string) {
  // Public download endpoint auto-redirects to the CDN. No API key needed.
  const url = `https://unsplash.com/photos/${id}/download?force=true`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Unsplash download failed ${resp.status} for ${id}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

async function downloadFromStorage(slotKey: string, outPath: string) {
  // slotKey is like "photo/dawn/light-2.webp" — the storage object key under
  // the "backgrounds/" prefix is "backgrounds/photo/dawn/light-2.webp".
  const key = `backgrounds/${slotKey}`;
  const resp = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!resp.Body) throw new Error(`Empty body for ${key}`);
  const chunks: Buffer[] = [];
  // @ts-expect-error Node Readable stream
  for await (const chunk of resp.Body) chunks.push(Buffer.from(chunk));
  fs.writeFileSync(outPath, Buffer.concat(chunks));
}

async function processSlot(slotKey: string, attr: Attr) {
  const cacheExt = attr.unsplashId ? "jpg" : "webp";
  const cacheName = `${slotKey.replace(/[/]/g, "_").replace(/\.webp$/, "")}.${cacheExt}`;
  const cachePath = path.join(CACHE_DIR, cacheName);
  const outPath = path.resolve(PORTRAIT_DIR, "..", "photo-portrait", slotKey.replace(/^photo\//, ""));
  // ^ slotKey e.g. "photo/dawn/light-1.webp" → outPath .../photo-portrait/dawn/light-1.webp

  // Fetch source if not cached
  if (!fs.existsSync(cachePath)) {
    if (attr.unsplashId) {
      process.stdout.write(`  ↓ Unsplash ${attr.unsplashId}... `);
      await downloadUnsplash(attr.unsplashId, cachePath);
    } else {
      process.stdout.write(`  ↓ storage ${slotKey}... `);
      await downloadFromStorage(slotKey, cachePath);
    }
    const sizeKB = (fs.statSync(cachePath).size / 1024).toFixed(0);
    console.log(`${sizeKB} KB`);
  } else {
    console.log(`  ✓ cached source`);
  }

  // Crop + resize. Sharp can upscale if source is smaller than target.
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await sharp(cachePath)
    .resize(TARGET_W, TARGET_H, {
      fit: "cover",
      position: "attention", // entropy-based smart crop
      kernel: "lanczos3",
    })
    .webp({ quality: QUALITY })
    .toFile(outPath);

  const outSize = (fs.statSync(outPath).size / 1024).toFixed(0);
  const note = attr.unsplashId ? "" : "  ⚠ upscaled from landscape";
  console.log(`  → ${path.relative(process.cwd(), outPath)} (${outSize} KB)${note}`);

  return outPath;
}

async function uploadPortrait(localPath: string) {
  const relative = path.relative(path.resolve(__dirname, "../.."), localPath);
  // relative is like "backgrounds/photo-portrait/dawn/light-1.webp"
  const key = relative;
  const body = fs.readFileSync(localPath);
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "image/webp",
      ACL: "public-read",
    })
  );
}

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(PORTRAIT_DIR, { recursive: true });

  const attributions: Record<string, Attr> = JSON.parse(
    fs.readFileSync(ATTR_PATH, "utf-8")
  );

  const slots = Object.entries(attributions);
  console.log(`\nProcessing ${slots.length} slots → photo-portrait/\n`);

  const uploaded: string[] = [];
  const skipMode = process.argv.includes("--no-upload");

  for (let i = 0; i < slots.length; i++) {
    const [slotKey, attr] = slots[i];
    console.log(`[${i + 1}/${slots.length}] ${slotKey}`);
    try {
      const outPath = await processSlot(slotKey, attr);
      if (!skipMode) {
        await uploadPortrait(outPath);
        uploaded.push(slotKey);
        console.log(`  ↑ uploaded`);
      }
    } catch (err) {
      console.error(`  ✗ failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `\nDone. Processed ${slots.length} slots, uploaded ${uploaded.length} to ${BUCKET}.`
  );
  console.log(`Local output: ${PORTRAIT_DIR}/`);
  console.log(`Source cache: ${CACHE_DIR}/ (delete to force re-download)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
