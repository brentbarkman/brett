// scripts/awakening-videos/pexels-source.ts

import "dotenv/config";
import fs from "fs";
import path from "path";
import readline from "readline";
import { QUERY_BY_SEGMENT, SEGMENTS, type Segment } from "./pexels-queries";

type SourceEntry = {
  segment: Segment;
  pexelsId: number;
  photographer: string;
  pexelsUrl: string;
  videoFileUrl: string;
  width: number;
  height: number;
  duration: number;
};

const SOURCES_PATH = path.resolve(__dirname, "sources.json");
const KEY = process.env.PEXELS_API_KEY;

if (!KEY) {
  console.error("Set PEXELS_API_KEY in .env (see .env.example).");
  process.exit(1);
}

async function search(query: string, page = 1) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=landscape&size=large&per_page=10&page=${page}`;
  const resp = await fetch(url, { headers: { Authorization: KEY! } });
  if (!resp.ok) throw new Error(`Pexels API error: ${resp.status} ${await resp.text()}`);
  return await resp.json();
}

function pickHdFile(videoFiles: any[]) {
  // Prefer 1920x1080 or higher, mp4
  const hd = videoFiles.find((f: any) => f.width >= 1920 && f.file_type === "video/mp4");
  return hd ?? videoFiles.find((f: any) => f.file_type === "video/mp4") ?? videoFiles[0];
}

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function main() {
  const sources: Record<string, SourceEntry> = fs.existsSync(SOURCES_PATH)
    ? JSON.parse(fs.readFileSync(SOURCES_PATH, "utf-8"))
    : {};

  const remaining = SEGMENTS.filter((s) => !(s in sources));
  console.log(`\nNeed sources for: ${remaining.join(", ") || "(all done)"}\n`);

  if (remaining.length === 0) {
    console.log("All 6 segments sourced. Run 'pnpm process:awakening' next.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (const segment of remaining) {
    const query = QUERY_BY_SEGMENT[segment];
    console.log(`\n=== Segment: ${segment} ===`);
    console.log(`Query: "${query}"`);
    console.log(`Browse: https://www.pexels.com/search/videos/${encodeURIComponent(query)}/?orientation=landscape`);

    let page = 1;
    let skipped = false;
    while (true) {
      const data = await search(query, page);
      console.log(`\nPage ${page} — ${data.videos.length} candidates:`);
      data.videos.forEach((v: any, idx: number) => {
        console.log(`  [${idx + 1}] id=${v.id} duration=${v.duration}s by ${v.user.name}`);
        console.log(`      preview: ${v.url}`);
      });

      const choice = (await prompt(rl, "Pick (1-10), 'n' for next page, 'q' to skip: ")).trim().toLowerCase();
      if (choice === "n") { page++; continue; }
      if (choice === "q") { skipped = true; break; }

      const idx = parseInt(choice, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= data.videos.length) {
        console.log("Invalid pick.");
        continue;
      }

      const v = data.videos[idx];
      const file = pickHdFile(v.video_files);

      sources[segment] = {
        segment,
        pexelsId: v.id,
        photographer: v.user.name,
        pexelsUrl: v.url,
        videoFileUrl: file.link,
        width: file.width,
        height: file.height,
        duration: v.duration,
      };
      fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2));
      console.log(`✓ Saved.`);
      break;
    }

    if (skipped) continue;
  }

  rl.close();
  console.log("\nDone. Sources at " + SOURCES_PATH);
  console.log("Run 'pnpm process:awakening' next.");
}

main().catch((err) => { console.error(err); process.exit(1); });
