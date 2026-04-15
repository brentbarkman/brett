// scripts/awakening-videos/process-videos.ts

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

type SourceEntry = {
  segment: string;
  pexelsId: number;
  videoFileUrl: string;
  duration: number;
};

const SOURCES_PATH = path.resolve(__dirname, "sources.json");
const DOWNLOAD_DIR = path.resolve(__dirname, "downloads");
const OUTPUT_DIR = path.resolve(__dirname, "../../apps/desktop/public/videos/awakening");

const TRIM_SECONDS = 2.5;
const TARGET_WIDTH = 2560;

async function downloadIfMissing(url: string, outPath: string) {
  if (fs.existsSync(outPath)) return;
  console.log(`  Downloading ${path.basename(outPath)}...`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

function ffprobeDuration(file: string): number {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`
  ).toString().trim();
  return parseFloat(out);
}

function trimAndEncodeMp4(input: string, output: string, startSec: number) {
  // H.264, AAC stripped (silent), scale to TARGET_WIDTH preserving aspect, CRF 24
  execSync(
    `ffmpeg -y -ss ${startSec} -i "${input}" -t ${TRIM_SECONDS} ` +
    `-vf "scale=${TARGET_WIDTH}:-2" -c:v libx264 -profile:v high -preset slow ` +
    `-crf 24 -pix_fmt yuv420p -movflags +faststart -an "${output}"`,
    { stdio: "inherit" }
  );
}

function trimAndEncodeWebm(input: string, output: string, startSec: number) {
  // VP9 fallback for browsers that don't support H.264 in MP4
  execSync(
    `ffmpeg -y -ss ${startSec} -i "${input}" -t ${TRIM_SECONDS} ` +
    `-vf "scale=${TARGET_WIDTH}:-2" -c:v libvpx-vp9 -crf 32 -b:v 0 -an "${output}"`,
    { stdio: "inherit" }
  );
}

async function main() {
  if (!fs.existsSync(SOURCES_PATH)) {
    console.error(`Missing ${SOURCES_PATH}. Run 'pnpm source:awakening' first.`);
    process.exit(1);
  }

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const sources: Record<string, SourceEntry> = JSON.parse(
    fs.readFileSync(SOURCES_PATH, "utf-8")
  );

  for (const [segment, src] of Object.entries(sources)) {
    console.log(`\n=== ${segment} (Pexels ${src.pexelsId}) ===`);

    const ext = src.videoFileUrl.split("?")[0].split(".").pop() ?? "mp4";
    const downloadPath = path.join(DOWNLOAD_DIR, `${segment}.${ext}`);
    await downloadIfMissing(src.videoFileUrl, downloadPath);

    const dur = ffprobeDuration(downloadPath);
    const startSec = Math.max(0, dur - TRIM_SECONDS);
    console.log(`  Duration ${dur.toFixed(2)}s → trim from ${startSec.toFixed(2)}s`);

    const mp4Out = path.join(OUTPUT_DIR, `${segment}.mp4`);
    const webmOut = path.join(OUTPUT_DIR, `${segment}.webm`);

    trimAndEncodeMp4(downloadPath, mp4Out, startSec);
    trimAndEncodeWebm(downloadPath, webmOut, startSec);

    const mp4KB = (fs.statSync(mp4Out).size / 1024).toFixed(0);
    const webmKB = (fs.statSync(webmOut).size / 1024).toFixed(0);
    console.log(`  → ${segment}.mp4 (${mp4KB} KB) + ${segment}.webm (${webmKB} KB)`);
  }

  console.log("\nDone. Output in " + OUTPUT_DIR);
  console.log("Verify clip sizes ≤ 3 MB each, total set ≤ 18 MB.");
}

main().catch((err) => { console.error(err); process.exit(1); });
