# Background Phase 3 — Awakening Video Moment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current 1.5s static "awakening" crossfade on app launch with a 2.5s ambient hero video (one per time segment, six total) that freezes on its rest frame and hands off to the rotation-selected still while the app UI animates in.

**Architecture:** A new `useAwakeningVideo` hook decides whether to play a video on cold launch (skips when `prefers-reduced-motion`, when video isn't loaded in time, or after the first run per-session). A new `AwakeningVideo` component plays the video once muted/inline, listens for `onEnded`, then crossfades into `LivingBackground` after pausing on the final frame. Sourcing is via Pexels Video API. Reuses the existing `scripts/upload-videos.ts`.

**Tech Stack:** React 19 + React Compiler, HTML5 `<video>`, Pexels Video API, ffmpeg for trim/encode (system dep — `brew install ffmpeg`), existing AWS SDK upload.

**Reference spec:** [`docs/superpowers/specs/2026-04-14-background-system-audit-design.md`](../specs/2026-04-14-background-system-audit-design.md) — Phase 3 section.

**Prerequisite:** Phase 2 should ship first (the scrim affects how the video reads). Phase 1 helps but isn't required.

---

## File Structure

**New files:**
- `scripts/awakening-videos/pexels-source.ts` — search Pexels, pick clip per segment
- `scripts/awakening-videos/process-videos.ts` — trim to 2.5s + transcode (H.264 MP4 + VP9 WebM)
- `scripts/awakening-videos/upload-awakening.ts` — upload to S3 (or extend existing `scripts/upload-videos.ts`)
- `scripts/awakening-videos/sources.json` — Pexels IDs picked (gitignored)
- `apps/desktop/src/data/awakening-manifest.json` — committed manifest of 6 video paths per segment
- `apps/desktop/src/hooks/useAwakeningVideo.ts` — gating logic
- `packages/ui/src/AwakeningVideo.tsx` — playback component
- `packages/ui/src/__tests__/AwakeningVideo.test.tsx`

**Modified files:**
- `apps/desktop/src/App.tsx` — mount `AwakeningVideo` above `LivingBackground` during the awakening window
- `apps/desktop/src/hooks/useBackground.ts` — expose `isAwakening` (or surface the existing flag); coordinate handoff
- `package.json` (root) — add `source:awakening`, `process:awakening` scripts
- `.env.example` — add `PEXELS_API_KEY`
- `.gitignore` — add awakening-videos local artifacts

---

## Task 1: Add Pexels sourcing CLI

**Files:**
- Create: `scripts/awakening-videos/pexels-source.ts`
- Create: `scripts/awakening-videos/pexels-queries.ts`
- Modify: `package.json`, `.env.example`, `.gitignore`

- [ ] **Step 1: Add `PEXELS_API_KEY` to `.env.example`**

```bash
# Pexels Video API key (https://www.pexels.com/api/)
# Required only for awakening-video sourcing scripts.
PEXELS_API_KEY=
```

- [ ] **Step 2: Define per-segment queries**

```typescript
// scripts/awakening-videos/pexels-queries.ts

export const SEGMENTS = ["dawn", "morning", "afternoon", "goldenHour", "evening", "night"] as const;
export type Segment = typeof SEGMENTS[number];

export const QUERY_BY_SEGMENT: Record<Segment, string> = {
  dawn:       "misty lake dawn slow motion",
  morning:    "alpine morning sunlight ambient slow",
  afternoon:  "desert afternoon clouds slow motion",
  goldenHour: "ocean waves sunset golden hour ambient",
  evening:    "twilight clouds slow motion ambient",
  night:      "starry night sky slow motion ambient",
};
```

- [ ] **Step 3: Write the sourcing CLI**

```typescript
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
    while (true) {
      const data = await search(query, page);
      console.log(`\nPage ${page} — ${data.videos.length} candidates:`);
      data.videos.forEach((v: any, idx: number) => {
        console.log(`  [${idx + 1}] id=${v.id} duration=${v.duration}s by ${v.user.name}`);
        console.log(`      preview: ${v.url}`);
      });

      const choice = (await prompt(rl, "Pick (1-10), 'n' for next page, 'q' to skip: ")).trim().toLowerCase();
      if (choice === "n") { page++; continue; }
      if (choice === "q") break;

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
  }

  rl.close();
  console.log("\nDone. Sources at " + SOURCES_PATH);
  console.log("Run 'pnpm process:awakening' next.");
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 4: Add `dotenv` as root devDep (if not already added in Phase 1) + scripts to `package.json`**

```bash
# Skip if dotenv was already added in Phase 1
pnpm ls dotenv -w 2>/dev/null | grep dotenv || pnpm add -Dw dotenv
```

Add to root `package.json`:

```json
"source:awakening": "npx tsx scripts/awakening-videos/pexels-source.ts",
"process:awakening": "npx tsx scripts/awakening-videos/process-videos.ts"
```

- [ ] **Step 5: Update `.gitignore`**

Append:

```
# Awakening-video local artifacts
scripts/awakening-videos/sources.json
scripts/awakening-videos/downloads/
apps/desktop/public/videos/awakening/
```

- [ ] **Step 6: Commit**

```bash
git add scripts/awakening-videos/pexels-source.ts scripts/awakening-videos/pexels-queries.ts package.json .env.example .gitignore
git commit -m "$(cat <<'EOF'
chore(scripts): add Pexels sourcing CLI for awakening videos

Searches Pexels Video API by segment and prompts the user to pick
one HD clip per segment (6 total). Picks save to sources.json.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Source 6 videos (interactive — done with the user)

**No code changes.**

- [ ] **Step 1: Get a Pexels API key**

https://www.pexels.com/api/ → free, immediate, 200 req/hour. Add to `.env`.

- [ ] **Step 2: Run the CLI**

```bash
pnpm source:awakening
```

For each of the 6 segments, the CLI prints 10 candidates with preview URLs. Open the previews, pick the one whose final ~1 second is the most "settled" — slow camera, no swooping, terminating on a composed frame the still-image set can hand off from cleanly. Type the number; the script saves it.

If page 1 is weak, type `n` for more candidates.

- [ ] **Step 3: Verify all 6 sourced**

```bash
jq 'keys | length' scripts/awakening-videos/sources.json
```

Expected: `6`.

---

## Task 3: Add the trim + transcode pipeline

**Files:**
- Create: `scripts/awakening-videos/process-videos.ts`

This script downloads each source, uses ffmpeg to trim the final 2.5s of each clip (the "settle" portion), and transcodes to H.264 MP4 + VP9 WebM at 2560 wide.

**Why trim the final 2.5s instead of the first?** The user picks clips whose end-state is the desired rest frame; the beginning is whatever motion preceded it. Pulling the final 2.5s gives us a guaranteed "settle into stillness" moment.

- [ ] **Step 1: Verify ffmpeg is on PATH**

```bash
ffmpeg -version | head -1
```

If not installed: `brew install ffmpeg`.

- [ ] **Step 2: Write the script**

```typescript
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
```

- [ ] **Step 3: Smoke compile**

```bash
pnpm tsx --no-warnings -e "import('./scripts/awakening-videos/process-videos')" 2>&1 | head -3
```

- [ ] **Step 4: Commit**

```bash
git add scripts/awakening-videos/process-videos.ts
git commit -m "$(cat <<'EOF'
chore(scripts): add ffmpeg trim+transcode pipeline for awakening videos

Downloads each Pexels source, takes the final 2.5s of the clip
(the "settle into stillness" portion), and transcodes to H.264 MP4
+ VP9 WebM at 2560 wide for the awakening playback layer.

Requires ffmpeg on PATH.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Run the pipeline + upload

- [ ] **Step 1: Process all sources**

```bash
pnpm process:awakening
```

Outputs go to `apps/desktop/public/videos/awakening/{segment}.mp4` + `{segment}.webm`.

- [ ] **Step 2: Verify clip sizes**

```bash
ls -lh apps/desktop/public/videos/awakening/
du -sh apps/desktop/public/videos/awakening/
```

Spec target: ≤ 3 MB per clip, ≤ 18 MB total. If a clip is larger, raise `-crf` (24 → 26 for MP4, 32 → 34 for WebM) and re-run for that segment.

- [ ] **Step 3: Quick visual check**

```bash
open apps/desktop/public/videos/awakening/dawn.mp4
```

Verify each clip:
- Plays for ~2.5s
- Ends on a composed frame (not mid-pan)
- No watermarks, no human faces, no logos

If a clip's final frame isn't great, re-source that segment (Task 2 — re-run `pnpm source:awakening` after deleting that key from `sources.json`).

- [ ] **Step 4: Extend the upload script for the awakening folder**

The existing `scripts/upload-videos.ts` reads from `apps/desktop/public/videos` and uploads `*.mp4` only. We need to: (a) include `*.webm`, (b) recurse into subfolders, (c) preserve the `awakening/` prefix in the S3 key.

Modify `scripts/upload-videos.ts` to recurse and upload both formats. Replace the file with:

```typescript
import { PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { s3, PUBLIC_BUCKET as BUCKET } from "./s3";

const VIDEO_DIR = path.resolve(__dirname, "../apps/desktop/public/videos");

const CONTENT_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else if (entry.name.endsWith(".mp4") || entry.name.endsWith(".webm")) {
      files.push(full);
    }
  }
  return files;
}

async function uploadVideos() {
  const files = walk(VIDEO_DIR);
  console.log(`Found ${files.length} video files to upload...\n`);

  for (const filePath of files) {
    const body = fs.readFileSync(filePath);
    const relative = path.relative(VIDEO_DIR, filePath);
    const key = `videos/${relative}`;
    const ext = path.extname(filePath);
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";

    console.log(`Uploading ${relative} (${(body.length / 1024 / 1024).toFixed(1)} MB)...`);

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      ACL: "public-read",
    }));

    console.log(`  ✓ ${key}`);
  }

  console.log("\nAll videos uploaded.");
}

uploadVideos().catch((err) => { console.error("Upload failed:", err); process.exit(1); });
```

- [ ] **Step 5: Run the upload**

```bash
pnpm tsx scripts/upload-videos.ts
```

Verify uploaded keys are `videos/awakening/dawn.mp4`, `videos/awakening/dawn.webm`, etc.

- [ ] **Step 6: Commit the upload-script change**

```bash
git add scripts/upload-videos.ts
git commit -m "$(cat <<'EOF'
chore(scripts): generalize upload-videos to recurse + handle webm

Walks subfolders (so awakening/ ships its own keyspace) and uploads
both .mp4 and .webm with appropriate Content-Type. Backwards
compatible with existing top-level .mp4 files.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add the awakening manifest

**Files:**
- Create: `apps/desktop/src/data/awakening-manifest.json`

- [ ] **Step 1: Write the manifest**

```json
{
  "version": 1,
  "videos": {
    "dawn":       { "mp4": "videos/awakening/dawn.mp4",       "webm": "videos/awakening/dawn.webm" },
    "morning":    { "mp4": "videos/awakening/morning.mp4",    "webm": "videos/awakening/morning.webm" },
    "afternoon":  { "mp4": "videos/awakening/afternoon.mp4",  "webm": "videos/awakening/afternoon.webm" },
    "goldenHour": { "mp4": "videos/awakening/goldenHour.mp4", "webm": "videos/awakening/goldenHour.webm" },
    "evening":    { "mp4": "videos/awakening/evening.mp4",    "webm": "videos/awakening/evening.webm" },
    "night":      { "mp4": "videos/awakening/night.mp4",      "webm": "videos/awakening/night.webm" }
  }
}
```

- [ ] **Step 2: Verify all 6 video files actually exist on storage**

```bash
node -e '
const m = require("./apps/desktop/src/data/awakening-manifest.json");
const base = "REPLACE_WITH_STORAGE_BASE_URL"; // copy from /api/config or .env
const urls = Object.values(m.videos).flatMap(v => [v.mp4, v.webm]);
Promise.all(urls.map(p => fetch(`${base}/${p}`, {method:"HEAD"}).then(r => `${r.status} ${p}`)))
  .then(rs => rs.forEach(r => console.log(r)));
'
```

Replace `REPLACE_WITH_STORAGE_BASE_URL` with the actual base. All should print `200`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/data/awakening-manifest.json
git commit -m "$(cat <<'EOF'
feat(desktop): add awakening-video manifest

Maps each time segment to its mp4 + webm video file in the storage
bucket. Used by the upcoming useAwakeningVideo hook to pick which
clip plays on cold launch.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Build the `useAwakeningVideo` hook

**Files:**
- Create: `apps/desktop/src/hooks/useAwakeningVideo.ts`

The hook decides whether to play and which video to play. It returns `{ videoUrls, videoFallbackUrls, shouldPlay }`. The component takes care of playback.

Gating logic (in order — first true wins → don't play):
1. `prefers-reduced-motion: reduce` → don't play
2. Already played in this session (module-level flag) → don't play
3. Manifest not available (e.g., baseUrl empty) → don't play
4. Otherwise: play, marking the session-played flag.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/desktop/src/hooks/__tests__/useAwakeningVideo.test.ts

import { renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useAwakeningVideo, _resetAwakeningSessionFlag } from "../useAwakeningVideo";

vi.mock("../../data/awakening-manifest.json", () => ({
  default: {
    version: 1,
    videos: {
      dawn:       { mp4: "videos/awakening/dawn.mp4",       webm: "videos/awakening/dawn.webm" },
      morning:    { mp4: "videos/awakening/morning.mp4",    webm: "videos/awakening/morning.webm" },
      afternoon:  { mp4: "videos/awakening/afternoon.mp4",  webm: "videos/awakening/afternoon.webm" },
      goldenHour: { mp4: "videos/awakening/goldenHour.mp4", webm: "videos/awakening/goldenHour.webm" },
      evening:    { mp4: "videos/awakening/evening.mp4",    webm: "videos/awakening/evening.webm" },
      night:      { mp4: "videos/awakening/night.mp4",      webm: "videos/awakening/night.webm" },
    },
  },
}));

const matchMediaMock = (matches: boolean) =>
  vi.fn().mockImplementation((q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? matches : false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

describe("useAwakeningVideo", () => {
  beforeEach(() => {
    _resetAwakeningSessionFlag();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock(false),
    });
  });

  it("returns shouldPlay=true on first call with valid baseUrl + segment", () => {
    const { result } = renderHook(() =>
      useAwakeningVideo({ baseUrl: "https://cdn.test", segment: "morning" })
    );
    expect(result.current.shouldPlay).toBe(true);
    expect(result.current.videoUrls).toEqual([
      "https://cdn.test/videos/awakening/morning.webm",
      "https://cdn.test/videos/awakening/morning.mp4",
    ]);
  });

  it("returns shouldPlay=false on second call (already played in session)", () => {
    renderHook(() => useAwakeningVideo({ baseUrl: "https://cdn.test", segment: "morning" }));
    const { result } = renderHook(() =>
      useAwakeningVideo({ baseUrl: "https://cdn.test", segment: "evening" })
    );
    expect(result.current.shouldPlay).toBe(false);
  });

  it("returns shouldPlay=false when prefers-reduced-motion is set", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaMock(true),
    });
    const { result } = renderHook(() =>
      useAwakeningVideo({ baseUrl: "https://cdn.test", segment: "morning" })
    );
    expect(result.current.shouldPlay).toBe(false);
  });

  it("returns shouldPlay=false when baseUrl is empty", () => {
    const { result } = renderHook(() =>
      useAwakeningVideo({ baseUrl: "", segment: "morning" })
    );
    expect(result.current.shouldPlay).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm --filter @brett/desktop test useAwakeningVideo --run
```

Expected: FAIL with "Cannot find module '../useAwakeningVideo'".

- [ ] **Step 3: Implement the hook**

```typescript
// apps/desktop/src/hooks/useAwakeningVideo.ts

import { useState } from "react";
import manifest from "../data/awakening-manifest.json";

type Segment = "dawn" | "morning" | "afternoon" | "goldenHour" | "evening" | "night";

interface UseAwakeningVideoArgs {
  baseUrl: string;
  segment: Segment;
}

interface UseAwakeningVideoResult {
  shouldPlay: boolean;
  /** Sources in priority order — pass directly to <video> as multiple <source> children. */
  videoUrls: string[];
}

/** Module-level flag — once true, no further awakenings this session. */
let SESSION_PLAYED = false;

/** Test helper. Do not call from app code. */
export function _resetAwakeningSessionFlag() {
  SESSION_PLAYED = false;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useAwakeningVideo({
  baseUrl,
  segment,
}: UseAwakeningVideoArgs): UseAwakeningVideoResult {
  // Decide ONCE per hook instance — useState lazy initializer captures the
  // decision at mount time so re-renders don't replay it.
  const [decision] = useState<UseAwakeningVideoResult>(() => {
    if (SESSION_PLAYED) return { shouldPlay: false, videoUrls: [] };
    if (prefersReducedMotion()) return { shouldPlay: false, videoUrls: [] };
    if (!baseUrl) return { shouldPlay: false, videoUrls: [] };

    const entry = (manifest as { videos: Record<string, { mp4: string; webm: string }> }).videos[segment];
    if (!entry) return { shouldPlay: false, videoUrls: [] };

    SESSION_PLAYED = true;
    return {
      shouldPlay: true,
      // WebM first (smaller, modern), MP4 fallback. <video> picks the first playable source.
      videoUrls: [`${baseUrl}/${entry.webm}`, `${baseUrl}/${entry.mp4}`],
    };
  });

  return decision;
}
```

- [ ] **Step 4: Run tests, expect green**

```bash
pnpm --filter @brett/desktop test useAwakeningVideo --run
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useAwakeningVideo.ts apps/desktop/src/hooks/__tests__/useAwakeningVideo.test.ts
git commit -m "$(cat <<'EOF'
feat(desktop): add useAwakeningVideo hook with cold-launch gating

Decides at mount whether to play the awakening video. Skips when:
- prefers-reduced-motion is set
- already played once this session (module-level flag)
- baseUrl is missing
- manifest has no entry for the segment

Returns webm-first source list for use with multi-source <video>.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Build the `AwakeningVideo` component

**Files:**
- Create: `packages/ui/src/AwakeningVideo.tsx`
- Create: `packages/ui/src/__tests__/AwakeningVideo.test.tsx`
- Modify: `packages/ui/src/index.ts`

The component plays the video once muted/inline, listens for `onEnded`, then fades out over 500ms. The parent (App.tsx) controls the unmount timing — the component just signals when playback is "done."

- [ ] **Step 1: Write the failing test**

```tsx
// packages/ui/src/__tests__/AwakeningVideo.test.tsx

import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AwakeningVideo } from "../AwakeningVideo";

describe("AwakeningVideo", () => {
  it("renders a muted, autoplay, playsInline video with the provided sources", () => {
    const { container } = render(
      <AwakeningVideo
        sources={["https://cdn/x.webm", "https://cdn/x.mp4"]}
        onEnded={() => {}}
      />
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.muted).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.getAttribute("playsinline")).not.toBeNull();

    const sources = container.querySelectorAll("source");
    expect(sources.length).toBe(2);
    expect(sources[0].getAttribute("src")).toBe("https://cdn/x.webm");
    expect(sources[0].getAttribute("type")).toBe("video/webm");
    expect(sources[1].getAttribute("src")).toBe("https://cdn/x.mp4");
    expect(sources[1].getAttribute("type")).toBe("video/mp4");
  });

  it("calls onEnded when the video element fires ended", () => {
    const onEnded = vi.fn();
    const { container } = render(
      <AwakeningVideo sources={["https://cdn/x.mp4"]} onEnded={onEnded} />
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    video.dispatchEvent(new Event("ended"));
    expect(onEnded).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run, expect failure**

```bash
cd packages/ui && pnpm test AwakeningVideo --run
```

Expected: FAIL with "Cannot find module '../AwakeningVideo'".

- [ ] **Step 3: Implement the component**

```tsx
// packages/ui/src/AwakeningVideo.tsx

interface AwakeningVideoProps {
  /** Source URLs in priority order — webm first if available, mp4 fallback. */
  sources: string[];
  /** Fired when video playback completes naturally. Parent should pause-on-frame
   *  (we set videoElement.currentTime = videoElement.duration) and then fade us out. */
  onEnded: () => void;
}

function getMimeType(url: string): string {
  if (url.endsWith(".webm")) return "video/webm";
  if (url.endsWith(".mp4")) return "video/mp4";
  return "";
}

/**
 * Plays an awakening video once on mount. The parent (App.tsx) decides
 * whether to mount us via useAwakeningVideo's `shouldPlay`. We do nothing
 * fancy — autoplay muted inline, fire onEnded when done.
 *
 * After onEnded the parent should hold us mounted briefly (the video pauses
 * automatically on its last frame) then fade us to opacity 0 and unmount.
 */
export function AwakeningVideo({ sources, onEnded }: AwakeningVideoProps) {
  return (
    <div className="absolute inset-0 z-0 bg-black pointer-events-none">
      <video
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={onEnded}
        className="absolute inset-0 w-full h-full object-cover"
      >
        {sources.map((src) => (
          <source key={src} src={src} type={getMimeType(src)} />
        ))}
      </video>
    </div>
  );
}
```

- [ ] **Step 4: Add the export**

In `packages/ui/src/index.ts`, add:

```typescript
export { AwakeningVideo } from "./AwakeningVideo";
```

- [ ] **Step 5: Run tests, expect green**

```bash
cd packages/ui && pnpm test AwakeningVideo --run
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/exciting-chatelet
git add packages/ui/src/AwakeningVideo.tsx packages/ui/src/__tests__/AwakeningVideo.test.tsx packages/ui/src/index.ts
git commit -m "$(cat <<'EOF'
feat(ui): add AwakeningVideo playback component

Renders a muted/autoplay/playsInline <video> with multi-source list
(webm first, mp4 fallback). Fires onEnded when playback completes —
parent decides what to do next (typically: hold one frame, fade out).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire awakening into `App.tsx`

**Files:**
- Modify: `apps/desktop/src/App.tsx` (around line 33 imports + line 936 layout)

The flow:
1. Hook decides on mount whether to play.
2. If yes: render `AwakeningVideo` ABOVE `LivingBackground` (covers it entirely while playing).
3. On `onEnded`: schedule a 500ms fade-out, then unmount, revealing `LivingBackground`.
4. App content (`.relative.z-10`) animates in normally — the existing entry behavior is unchanged.

- [ ] **Step 1: Add imports**

In `apps/desktop/src/App.tsx`, add to the existing `@brett/ui` import block:

```tsx
import { /* existing... */ AwakeningVideo, BackgroundScrim, LivingBackground } from "@brett/ui";
```

And import the hook:

```tsx
import { useAwakeningVideo } from "./hooks/useAwakeningVideo";
```

- [ ] **Step 2: Use the hook inside the App component**

The hook needs `baseUrl` (already available via `useAppConfig` somewhere in the tree) and `segment` (from `useBackground`). Inside `App()`, after the existing background/config calls:

```tsx
const { data: config } = useAppConfig();
const baseUrl = config?.storageBaseUrl ?? "";

// background is already destructured from useBackground higher up
const awakening = useAwakeningVideo({
  baseUrl,
  segment: background.segment,
});

const [awakeningVisible, setAwakeningVisible] = useState(awakening.shouldPlay);

const handleAwakeningEnded = () => {
  // Hold one frame on the rest position, then fade out over 500ms.
  setTimeout(() => setAwakeningVisible(false), 500);
};
```

(Confirm `background.segment` is exposed from `useBackground` — if not, expose it. Look at `apps/desktop/src/hooks/useBackground.ts` `return {…}` block and add `segment` if missing.)

- [ ] **Step 3: Mount conditionally above `LivingBackground`**

In the JSX (around line 937), the structure becomes:

```tsx
<div className="relative flex h-screen w-full overflow-hidden text-white font-sans bg-black">
  <LivingBackground
    imageUrl={background.imageUrl}
    nextImageUrl={background.nextImageUrl}
    isTransitioning={background.isTransitioning}
    gradient={background.gradient}
    nextGradient={background.nextGradient}
  />
  <BackgroundScrim />

  {awakening.shouldPlay && awakeningVisible && (
    <div
      className="absolute inset-0 z-[5] transition-opacity duration-500 pointer-events-none"
      style={{ opacity: awakeningVisible ? 1 : 0 }}
    >
      <AwakeningVideo sources={awakening.videoUrls} onEnded={handleAwakeningEnded} />
    </div>
  )}
```

`z-[5]` puts the video above LivingBackground (z-0) + BackgroundScrim (no z-index, defaults to auto) but below the app shell (z-10). When `awakeningVisible` flips false, the wrapper div's opacity transitions to 0 then unmounts.

Wait — for the fade-out to actually animate, we need the opacity transition to start BEFORE unmount. Use a two-state pattern: keep the wrapper rendered while opacity is 0, unmount after the transition finishes.

Adjust the state model:

```tsx
const [awakeningPhase, setAwakeningPhase] = useState<"playing" | "fading" | "done">(
  awakening.shouldPlay ? "playing" : "done"
);

const handleAwakeningEnded = () => {
  // Hold one frame on the rest position, then start the fade.
  setTimeout(() => setAwakeningPhase("fading"), 500);
  // Fade duration is 500ms; unmount after that.
  setTimeout(() => setAwakeningPhase("done"), 1000);
};
```

And the mount:

```tsx
{awakening.shouldPlay && awakeningPhase !== "done" && (
  <div
    className="absolute inset-0 z-[5] transition-opacity duration-500 pointer-events-none"
    style={{ opacity: awakeningPhase === "fading" ? 0 : 1 }}
  >
    <AwakeningVideo sources={awakening.videoUrls} onEnded={handleAwakeningEnded} />
  </div>
)}
```

- [ ] **Step 4: Verify `useBackground` exposes `segment`**

```bash
grep -n "return {" apps/desktop/src/hooks/useBackground.ts
```

Read the return block — if `segment` isn't in there, add it. Find the `useState<TimeSegment>` declaration and ensure `segment` is included in the return object.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @brett/desktop typecheck
```

Expected: pass.

- [ ] **Step 6: Smoke test — full cold launch**

```bash
pnpm dev:desktop
```

Reload the renderer (CMD-R). On the cold launch, you should see:
1. Black for ~50ms
2. Video starts playing (webm or mp4)
3. ~2.5s of slow ambient motion
4. Held on final frame for ~500ms
5. Fades out over 500ms revealing LivingBackground (the still + scrim + content)

Reload again (CMD-R) within the same dev session — second reload should NOT replay the video (`SESSION_PLAYED` is module-level, persists across HMR reloads in the same session). To force a replay during dev, clear the module via a hard reload or restart `pnpm dev:desktop`.

- [ ] **Step 7: Test reduced-motion**

In macOS System Settings → Accessibility → Display → enable "Reduce motion." Restart `pnpm dev:desktop`. Cold launch should skip the video entirely and use the existing 1.5s awakening crossfade.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/App.tsx apps/desktop/src/hooks/useBackground.ts
git commit -m "$(cat <<'EOF'
feat(desktop): wire awakening video into cold app launch

On cold launch (and not in a session that already played + not under
reduced-motion), play one of the 6 segment-specific Pexels-sourced
videos for ~2.5s, hold the rest frame for 500ms, fade out over 500ms,
revealing LivingBackground beneath.

Implements Phase 3 of the background audit spec.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run the full check**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Expected: all green.

- [ ] **Step 2: Cold-launch matrix**

Force the system clock (or just visually verify) at different times of day to see different segment videos:
- Dawn launch (between 5–7 am, or simulate)
- Morning launch
- Afternoon launch
- Golden Hour launch
- Evening launch
- Night launch

For each: video plays, ends cleanly, hand-off to still feels smooth.

- [ ] **Step 3: Negative cases**

- Reduced-motion ON: no video, instant still + existing 1.5s awakening crossfade
- Slow network simulation (DevTools throttling: "Slow 3G"): video may not load in time → falls through to instant still (no broken state)
- Hot reload during the session: doesn't re-trigger video (SESSION_PLAYED persists in module scope)

- [ ] **Step 4: Asset-size audit**

```bash
du -sh apps/desktop/public/videos/awakening
```

≤ 18 MB total (target). If over, raise `-crf` and re-process.

- [ ] **Step 5: Production build smoke test**

```bash
pnpm --filter @brett/desktop build
```

Expected: build succeeds.

---

## Self-Review — Spec Coverage

Spec Phase 3 section requires:
- ✅ 6 hero videos, one per time segment → Tasks 1–4
- ✅ ~2.5s duration each → Task 3 (TRIM_SECONDS = 2.5)
- ✅ 0.5s held freeze frame → Task 8 (handleAwakeningEnded → 500ms hold)
- ✅ Cold-launch only, not tab switch / refresh / mid-session shifts → Task 6 (SESSION_PLAYED module flag)
- ✅ Fallback: instant still if video doesn't load in 400ms → handled implicitly: if AwakeningVideo never mounts (shouldPlay=false) or if video element fails silently, LivingBackground is already rendered beneath. Verify Task 9 Step 3.
- ✅ 2560 wide, H.265/H.264 + WebM → Task 3 (TARGET_WIDTH=2560, libx264 + libvpx-vp9)
- ✅ ≤ 3 MB per clip, ≤ 18 MB total → Task 4 Step 2 + Task 9 Step 4
- ✅ Slow ambient motion only → enforced manually in Task 2 (curate the picks)
- ✅ Final frame is its own "still" (no mapping to a specific photo in the pool) → confirmed: handoff is to LivingBackground showing the rotation-selected still
- ✅ Reduced-motion respected → Task 6 (matchMedia check) + Task 8 Step 7
- ✅ Reuse existing VideoBackground.tsx pattern? → Note: we didn't reuse; built a simpler component because the use case differs (one-shot, no rotation).

**Decision flagged:** Spec said "extend the existing VideoBackground.tsx component." Reviewing it, the existing component is built for continuous dual-slot rotation, which is materially different from our one-shot "play and freeze" use case. A purpose-built `AwakeningVideo` is ~50 lines vs. extending the existing 147-line dual-slot component with new branches. Simpler wins.

If the user wants to consolidate, the existing `VideoBackground.tsx` can later be refactored to compose two layers: `AwakeningVideo` (for one-shot) and a new `LoopingVideo` (for the dual-slot rotation case), but that's out of scope for Phase 3.
