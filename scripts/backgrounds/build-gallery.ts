// scripts/backgrounds/build-gallery.ts
//
// Reads gallery.html template + winners.json + candidates.json (+ any v2 meta)
// and emits gallery-built.html with WINNERS_DATA and PHOTOG_DATA inlined.
// Keeps the gallery viewable from any static server without fetch/CORS.

import fs from "fs";
import path from "path";

const ROOT = __dirname;
const TEMPLATE = path.join(ROOT, "gallery.template.html");
const OUT = path.join(ROOT, "gallery.html");
const WINNERS = JSON.parse(fs.readFileSync(path.join(ROOT, "winners.json"), "utf-8"));
const CANDIDATES = JSON.parse(fs.readFileSync(path.join(ROOT, "candidates.json"), "utf-8"));

// Build photographer index keyed by unsplash photo id.
const photog: Record<string, { name: string; url: string }> = {};
for (const arr of Object.values(CANDIDATES) as any[]) {
  for (const c of arr) {
    photog[c.id] = { name: c.photographer, url: c.unsplashUrl };
  }
}

// Pull in any re-sourced "-v2" folders so their photographers are credited too.
const v2Roots = fs
  .readdirSync(path.join(ROOT, "downloads/candidates"))
  .flatMap((seg) => {
    const segPath = path.join(ROOT, "downloads/candidates", seg);
    if (!fs.statSync(segPath).isDirectory()) return [];
    return fs.readdirSync(segPath)
      .filter((t) => t.endsWith("-v2"))
      .map((t) => path.join(segPath, t));
  });
for (const dir of v2Roots) {
  const metaPath = path.join(dir, "_meta.json");
  if (!fs.existsSync(metaPath)) continue;
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  for (const c of meta) {
    photog[c.id] = { name: c.photographer, url: c.unsplashUrl };
  }
}

const html = fs.readFileSync(TEMPLATE, "utf-8")
  .replace("WINNERS_DATA", JSON.stringify(WINNERS, null, 2))
  .replace("PHOTOG_DATA", JSON.stringify(photog, null, 2));

fs.writeFileSync(OUT, html);
console.log(`Wrote ${OUT}`);
console.log(`  ${Object.keys(WINNERS).length} winners`);
console.log(`  ${Object.keys(photog).length} photographers indexed`);
