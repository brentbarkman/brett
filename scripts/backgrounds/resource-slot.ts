// scripts/backgrounds/resource-slot.ts
//
// One-off: re-source a single slot with an override query.
// Usage: pnpm tsx scripts/backgrounds/resource-slot.ts <slot> "<query>"
// Example: pnpm tsx scripts/backgrounds/resource-slot.ts evening/moderate "blue hour mountains layered calm minimal"
//
// Writes into a fresh subfolder downloads/candidates/<slot>-v2/

import "dotenv/config";
import fs from "fs";
import path from "path";

const keys = [1, 2, 3, 4, 5]
  .map((n) => process.env[`UNSPLASH_ACCESS_KEY_${n}`])
  .filter((k): k is string => Boolean(k));

if (keys.length === 0) {
  console.error("No UNSPLASH_ACCESS_KEY_1..5 in .env");
  process.exit(1);
}

let keyIdx = 0;
const nextKey = () => keys[keyIdx++ % keys.length];

const slot = process.argv[2];
const query = process.argv[3];
if (!slot || !query) {
  console.error('Usage: tsx resource-slot.ts <slot> "<query>"');
  process.exit(1);
}

const outDir = path.resolve(__dirname, "downloads/candidates", `${slot}-v2`);
fs.mkdirSync(outDir, { recursive: true });

async function main() {
  console.log(`Re-sourcing ${slot} with query: "${query}"`);
  const params = new URLSearchParams({
    query, orientation: "landscape", order_by: "editorial",
    per_page: "8", page: "1",
  });
  const resp = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
    headers: { Authorization: `Client-ID ${nextKey()}` },
  });
  if (!resp.ok) throw new Error(`Unsplash ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  console.log(`Got ${data.results.length} candidates, downloading...`);

  const meta: any[] = [];
  for (const p of data.results) {
    const file = path.join(outDir, `${p.id}.jpg`);
    if (!fs.existsSync(file)) {
      const r = await fetch(p.urls.full);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      process.stdout.write(".");
    }
    meta.push({
      id: p.id,
      photographer: p.user.name,
      unsplashUrl: p.links.html,
      downloadUrl: p.urls.full,
      trackDownloadUrl: p.links.download_location,
      color: p.color,
    });
  }
  fs.writeFileSync(path.join(outDir, "_meta.json"), JSON.stringify(meta, null, 2));
  console.log(`\nDone. Files in ${outDir}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
