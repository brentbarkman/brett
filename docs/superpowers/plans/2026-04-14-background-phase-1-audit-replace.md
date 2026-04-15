# Background Phase 1 — Image Audit & Replace

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the 54 photography images currently in rotation, cut every B-grade image, source replacements via the Unsplash API, and update the manifest with attribution metadata.

**Architecture:** Three small CLIs in `scripts/backgrounds/`: an interactive audit CLI that records verdicts, an Unsplash sourcing CLI that searches and downloads candidates, and a processing pipeline that converts to WebP. Reuses the existing `scripts/upload-backgrounds.ts` for the upload step. Manifest evolution: keep the existing `background-manifest.json` shape (string paths) and add a sidecar `image-attributions.json` so reading code is unchanged.

**Tech Stack:** Node + TypeScript scripts (run via `tsx`), `sharp` for WebP conversion, Unsplash API (user supplies API key), existing AWS SDK for upload.

**Reference spec:** [`docs/superpowers/specs/2026-04-14-background-system-audit-design.md`](../specs/2026-04-14-background-system-audit-design.md) — Phase 1 section.

**Prerequisite:** Phase 2 should ship first. With the scrim in place, some borderline images may upgrade from "replace" to "keep" — judge them under the final treatment.

---

## File Structure

**New files:**
- `scripts/backgrounds/audit-cli.ts` — interactive verdict recorder
- `scripts/backgrounds/unsplash-source.ts` — Unsplash search + download
- `scripts/backgrounds/process-images.ts` — convert downloads to WebP at 2560×1440
- `scripts/backgrounds/audit-results.json` — verdicts (gitignored — local artifact)
- `scripts/backgrounds/replacement-sources.json` — Unsplash IDs picked per slot (gitignored)
- `apps/desktop/src/data/image-attributions.json` — committed attribution sidecar
- `.env.example` — add `UNSPLASH_ACCESS_KEY`

**Modified files:**
- `package.json` (root) — add `audit:backgrounds`, `source:backgrounds`, `process:backgrounds` scripts
- `apps/desktop/src/data/background-manifest.json` — final image list after audit
- `.gitignore` — add the two local JSON artifacts

**Reused as-is:**
- `scripts/upload-backgrounds.ts` — already walks `backgrounds/**/*.webp` and uploads to S3

---

## Task 1: Add the `audit:backgrounds` CLI

**Files:**
- Create: `scripts/backgrounds/audit-cli.ts`
- Modify: `package.json` (root)
- Modify: `.gitignore`

**Workflow this script supports:** User runs the desktop app in one terminal, the audit CLI in another. CLI reads the manifest, walks all 54 images one at a time, and for each prompts `(k)eep / (c)ut / (r)eplace [notes]`. User pins each image in Settings → Background to look at it across views, then types the verdict. Output is JSON.

- [ ] **Step 1: Write the CLI**

```typescript
// scripts/backgrounds/audit-cli.ts

import fs from "fs";
import path from "path";
import readline from "readline";
import manifest from "../../apps/desktop/src/data/background-manifest.json";

type Verdict = "keep" | "cut" | "replace";
type AuditEntry = {
  path: string;
  segment: string;
  tier: string;
  verdict: Verdict;
  notes: string;
};

const RESULTS_PATH = path.resolve(__dirname, "audit-results.json");

function loadExistingResults(): Record<string, AuditEntry> {
  if (!fs.existsSync(RESULTS_PATH)) return {};
  return JSON.parse(fs.readFileSync(RESULTS_PATH, "utf-8"));
}

function saveResults(results: Record<string, AuditEntry>) {
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
}

function flattenManifest(): { path: string; segment: string; tier: string }[] {
  const photo = manifest.sets.photography;
  const out: { path: string; segment: string; tier: string }[] = [];
  for (const [segment, tiers] of Object.entries(photo)) {
    for (const [tier, paths] of Object.entries(tiers as Record<string, string[]>)) {
      for (const p of paths) {
        out.push({ path: p, segment, tier });
      }
    }
  }
  return out;
}

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function main() {
  const all = flattenManifest();
  const results = loadExistingResults();
  const remaining = all.filter((img) => !(img.path in results));

  console.log(`\nTotal images: ${all.length}`);
  console.log(`Already audited: ${Object.keys(results).length}`);
  console.log(`Remaining: ${remaining.length}\n`);

  if (remaining.length === 0) {
    console.log("All images audited. Run 'pnpm source:backgrounds' next.");
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (let i = 0; i < remaining.length; i++) {
    const img = remaining[i];
    console.log(`\n[${i + 1}/${remaining.length}] ${img.path}`);
    console.log(`  Category: ${img.segment} / ${img.tier}`);
    console.log(`  Pin this in Settings → Background to view it across the app.`);

    const v = (await prompt(rl, "  Verdict (k=keep, c=cut, r=replace, q=quit): ")).trim().toLowerCase();
    if (v === "q") break;

    let verdict: Verdict;
    if (v === "k") verdict = "keep";
    else if (v === "c") verdict = "cut";
    else if (v === "r") verdict = "replace";
    else {
      console.log("  Invalid input — skipping.");
      continue;
    }

    const notes = (await prompt(rl, "  Notes (optional): ")).trim();

    results[img.path] = { ...img, verdict, notes };
    saveResults(results);
    console.log(`  ✓ Saved.`);
  }

  rl.close();

  const counts = { keep: 0, cut: 0, replace: 0 };
  for (const e of Object.values(results)) counts[e.verdict]++;
  console.log(`\nDone. ${counts.keep} keep, ${counts.cut} cut, ${counts.replace} replace.`);
  console.log(`Results saved to ${RESULTS_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script to root `package.json`**

In the `"scripts"` block, add (matching the existing `upload:backgrounds` pattern):

```json
"audit:backgrounds": "npx tsx scripts/backgrounds/audit-cli.ts"
```

- [ ] **Step 3: Add the local artifacts to `.gitignore`**

Append to `.gitignore`:

```
# Background audit local artifacts (verdicts + sourced URLs)
scripts/backgrounds/audit-results.json
scripts/backgrounds/replacement-sources.json
scripts/backgrounds/downloads/
```

- [ ] **Step 4: Smoke-test the CLI without committing verdicts**

```bash
cd /Users/brentbarkman/code/brett/.claude/worktrees/exciting-chatelet
pnpm audit:backgrounds
```

Type `q` immediately to quit. The script should print the totals and exit cleanly.

- [ ] **Step 5: Commit the CLI and gitignore changes**

```bash
git add scripts/backgrounds/audit-cli.ts package.json .gitignore
git commit -m "$(cat <<'EOF'
chore(scripts): add background image audit CLI

Interactive readline-based CLI that walks all photography images in
the manifest and records keep/cut/replace verdicts. Verdicts persist
to audit-results.json (gitignored) so the CLI is resumable.

User pins each image in Settings → Background while running the CLI
to judge it across views.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Walk the audit (interactive — done with the user)

**No code changes.** This task is the actual audit pass.

- [ ] **Step 1: Start the desktop app**

```bash
pnpm dev:desktop
```

In the running app, open Settings → Background.

- [ ] **Step 2: Run the audit CLI in a second terminal**

```bash
pnpm audit:backgrounds
```

- [ ] **Step 3: For each of the 54 images, judge it together with the user**

For each image, in this order:
1. Pin the image in Settings → Background (click its tile).
2. Navigate Today, Inbox, Calendar, a list, Scouts. Look at how cards read on top.
3. Score against the rubric:
   - **Legibility zones** — content area (center-left top half) hosts cards readably?
   - **Distraction** — does the eye get pulled to a face, logo, weird shape?
   - **Tone match** — fits time-of-day + busyness tier?
   - **Quality** — beautiful, or just okay?
4. Type the verdict in the CLI: `k` (keep), `c` (cut, no replacement needed), `r` (replace, source a new one).
5. Add a brief note (1-2 words) if useful (e.g. "too saturated", "logo visible", "perfect").

- [ ] **Step 4: Sanity-check the results**

After completing all 54:

```bash
cat scripts/backgrounds/audit-results.json | jq 'group_by(.verdict) | map({verdict: .[0].verdict, count: length})'
```

Reasonable distribution: 30-40 keep, 5-10 cut, 10-20 replace. If everything came back "keep" the bar wasn't high enough; if everything came back "replace" the bar was too high — re-run a sample.

- [ ] **Step 5: Verify minimum 2 per category after cuts**

```bash
node -e '
const r = require("./scripts/backgrounds/audit-results.json");
const counts = {};
for (const e of Object.values(r)) {
  if (e.verdict === "cut") continue;
  const k = e.segment + "/" + e.tier;
  counts[k] = (counts[k] || 0) + 1;
}
const thin = Object.entries(counts).filter(([_, n]) => n < 2);
if (thin.length) {
  console.log("Categories below 2 after cuts:", thin);
  console.log("→ Mark these slots as replace instead of cut to keep min 2.");
} else {
  console.log("All categories have ≥2 surviving images. Good.");
}
'
```

If any category drops below 2, go back to the CLI and re-classify a `cut` as `replace` for that category.

---

## Task 3: Add the Unsplash sourcing CLI

**Files:**
- Create: `scripts/backgrounds/unsplash-source.ts`
- Modify: `package.json` (root)
- Modify: `.env.example`

This script reads `audit-results.json`, finds every `replace` verdict and every "thin category" needing a fresh image, queries Unsplash with a curated prompt per category, and prints candidate URLs for the user to review in their browser. The user picks one and pastes the Unsplash photo ID; the script records the choice in `replacement-sources.json`.

- [ ] **Step 1: Add the `UNSPLASH_ACCESS_KEY` env var to `.env.example`**

Append to `.env.example`:

```bash
# Unsplash Developer API key (https://unsplash.com/developers)
# Required only for background image sourcing scripts.
UNSPLASH_ACCESS_KEY=
```

User adds the real key to `.env` (not committed).

- [ ] **Step 2: Define the per-category Unsplash queries**

These queries shape the search. Keep them in a constants file co-located with the script:

```typescript
// scripts/backgrounds/unsplash-queries.ts

export const QUERY_BY_CATEGORY: Record<string, string> = {
  "dawn/light":         "misty lake dawn pastel landscape soft",
  "dawn/moderate":      "rolling hills fog dawn landscape",
  "dawn/packed":        "mountain ridge predawn dramatic landscape",
  "morning/light":      "open beach clear sky morning landscape",
  "morning/moderate":   "alpine meadow bright morning landscape",
  "morning/packed":     "dense forest canopy morning sunlight landscape",
  "afternoon/light":    "desert expanse wide horizon afternoon landscape",
  "afternoon/moderate": "vineyard rows afternoon warm landscape",
  "afternoon/packed":   "canyon walls dramatic afternoon shadows landscape",
  "goldenHour/light":   "calm shoreline golden hour amber landscape",
  "goldenHour/moderate":"wheat field golden hour landscape",
  "goldenHour/packed":  "volcanic landscape golden hour intense orange",
  "evening/light":      "still water cool blue evening landscape",
  "evening/moderate":   "city distance twilight skyline landscape",
  "evening/packed":     "moody coastline dark clouds evening landscape",
  "night/light":        "starfield open sky night landscape",
  "night/moderate":     "moon over mountains night landscape",
  "night/packed":       "northern lights aurora night landscape electric",
};
```

- [ ] **Step 3: Write the sourcing CLI**

```typescript
// scripts/backgrounds/unsplash-source.ts

import "dotenv/config";
import fs from "fs";
import path from "path";
import readline from "readline";
import { QUERY_BY_CATEGORY } from "./unsplash-queries";

type AuditEntry = {
  path: string;
  segment: string;
  tier: string;
  verdict: "keep" | "cut" | "replace";
  notes: string;
};

type SourceEntry = {
  segment: string;
  tier: string;
  slot: string;          // matches the manifest path slot, e.g. "photo/dawn/light-2.webp"
  unsplashId: string;
  photographer: string;
  unsplashUrl: string;
  downloadUrl: string;
};

const RESULTS_PATH = path.resolve(__dirname, "audit-results.json");
const SOURCES_PATH = path.resolve(__dirname, "replacement-sources.json");

const KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!KEY) {
  console.error("Set UNSPLASH_ACCESS_KEY in .env (see .env.example).");
  process.exit(1);
}

async function search(query: string, page = 1) {
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&orientation=landscape&per_page=10&page=${page}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Client-ID ${KEY}` },
  });
  if (!resp.ok) throw new Error(`Unsplash API error: ${resp.status} ${await resp.text()}`);
  return await resp.json();
}

async function prompt(rl: readline.Interface, q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function main() {
  const audit: Record<string, AuditEntry> = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf-8"));
  const sources: Record<string, SourceEntry> = fs.existsSync(SOURCES_PATH)
    ? JSON.parse(fs.readFileSync(SOURCES_PATH, "utf-8"))
    : {};

  const toReplace = Object.values(audit).filter(
    (e) => e.verdict === "replace" && !(e.path in sources)
  );

  console.log(`\nNeed sources for ${toReplace.length} slots.\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (let i = 0; i < toReplace.length; i++) {
    const slot = toReplace[i];
    const categoryKey = `${slot.segment}/${slot.tier}`;
    const query = QUERY_BY_CATEGORY[categoryKey];
    if (!query) {
      console.error(`No query defined for ${categoryKey} — add to unsplash-queries.ts.`);
      continue;
    }

    console.log(`\n[${i + 1}/${toReplace.length}] Slot: ${slot.path}`);
    console.log(`  Category: ${categoryKey}`);
    console.log(`  Query: "${query}"`);
    console.log(`  Browse: https://unsplash.com/s/photos/${encodeURIComponent(query)}?orientation=landscape`);

    let page = 1;
    while (true) {
      const data = await search(query, page);
      console.log(`\n  Page ${page} — ${data.results.length} candidates:`);
      data.results.forEach((p: any, idx: number) => {
        console.log(`    [${idx + 1}] ${p.id} — ${p.user.name} — ${p.alt_description ?? "(no description)"} — ${p.urls.regular}`);
      });

      const choice = (await prompt(rl, "  Pick (1-10), 'n' for next page, 'q' to skip slot: ")).trim().toLowerCase();
      if (choice === "n") { page++; continue; }
      if (choice === "q") break;

      const idx = parseInt(choice, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= data.results.length) {
        console.log("  Invalid pick.");
        continue;
      }

      const photo = data.results[idx];
      sources[slot.path] = {
        segment: slot.segment,
        tier: slot.tier,
        slot: slot.path,
        unsplashId: photo.id,
        photographer: photo.user.name,
        unsplashUrl: photo.links.html,
        downloadUrl: photo.urls.full, // full-resolution
      };
      fs.writeFileSync(SOURCES_PATH, JSON.stringify(sources, null, 2));

      // Trigger Unsplash download tracking endpoint (required by API guidelines)
      await fetch(photo.links.download_location, {
        headers: { Authorization: `Client-ID ${KEY}` },
      });

      console.log(`  ✓ Saved.`);
      break;
    }
  }

  rl.close();
  console.log(`\nDone. Sources saved to ${SOURCES_PATH}`);
  console.log(`Run 'pnpm process:backgrounds' next.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Add `dotenv` as a root devDep + the npm script**

The Unsplash script imports `dotenv/config` to read `.env`. Add the dep at the workspace root:

```bash
pnpm add -Dw dotenv
```

Then add the script to root `package.json`:

```json
"source:backgrounds": "npx tsx scripts/backgrounds/unsplash-source.ts"
```

- [ ] **Step 5: Verify the script compiles**

```bash
pnpm tsx --no-warnings -e "import('./scripts/backgrounds/unsplash-source')" 2>&1 | head -3
```

If you see no errors (only the missing-key error if you ran it without a key), it compiles.

- [ ] **Step 6: Commit**

```bash
git add scripts/backgrounds/unsplash-source.ts scripts/backgrounds/unsplash-queries.ts package.json .env.example
git commit -m "$(cat <<'EOF'
chore(scripts): add Unsplash sourcing CLI for background replacements

Reads audit-results.json, prompts the user to pick replacements for
each 'replace' verdict by querying Unsplash with category-tuned
prompts. Writes picks to replacement-sources.json (gitignored).
Honors Unsplash API's download-tracking requirement.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Source replacements (interactive — done with the user)

**No code changes.** Run the CLI built in Task 3.

- [ ] **Step 1: Confirm the API key is set**

```bash
grep UNSPLASH_ACCESS_KEY .env
```

If empty, get a key at https://unsplash.com/developers and set it. The free tier is 50 req/hour — plenty for this.

- [ ] **Step 2: Run the sourcing CLI**

```bash
pnpm source:backgrounds
```

For each replacement slot:
1. The CLI prints a list of 10 candidates from Unsplash with the photographer name, alt-description, and URL.
2. Open the URLs in a browser (CMD-click) to view full-size.
3. Type the number of the chosen candidate (1-10), or `n` for the next page, or `q` to skip this slot.

- [ ] **Step 3: Verify all slots have sources**

```bash
jq 'length' scripts/backgrounds/replacement-sources.json
```

Should equal the number of `replace` verdicts. If not, re-run the CLI to fill in the skipped slots.

---

## Task 5: Add the image processing pipeline

**Files:**
- Create: `scripts/backgrounds/process-images.ts`
- Modify: `package.json` (root)
- Verify: `sharp` package availability

This script downloads each Unsplash full-res image, converts to WebP at 2560×1440 (q=80), and writes to the correct path in `backgrounds/photo/<segment>/<slot>.webp` ready for the existing upload script.

- [ ] **Step 1: Verify or install `sharp`**

```bash
pnpm ls sharp 2>/dev/null | grep sharp || pnpm add -D sharp -w
```

If already present, skip the install.

- [ ] **Step 2: Write the processing script**

```typescript
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
```

- [ ] **Step 3: Add the script to `package.json`**

```json
"process:backgrounds": "npx tsx scripts/backgrounds/process-images.ts"
```

- [ ] **Step 4: Smoke-test (skip — requires real source data)**

This script needs `replacement-sources.json` to actually do anything. We'll exercise it in Task 7. For now, just verify it compiles:

```bash
pnpm tsx --no-warnings -e "import('./scripts/backgrounds/process-images')" 2>&1 | head -3
```

- [ ] **Step 5: Commit**

```bash
git add scripts/backgrounds/process-images.ts package.json
# Also commit the sharp dep if it was added:
git add package.json pnpm-lock.yaml 2>/dev/null
git commit -m "$(cat <<'EOF'
chore(scripts): add WebP processing pipeline for sourced backgrounds

Downloads each Unsplash full-res image, resizes to 2560x1440 with
center-cover fit, encodes WebP q=80, and writes to the correct slot
in backgrounds/photo/. Resumable — skips already-downloaded files.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Apply audit cuts to the manifest

**Files:**
- Modify: `apps/desktop/src/data/background-manifest.json`

For images marked `cut` (no replacement): remove their path from the manifest array. The remaining array shrinks but the structure is preserved.

- [ ] **Step 1: Generate the cut list**

```bash
jq -r 'to_entries | map(select(.value.verdict == "cut")) | .[].key' scripts/backgrounds/audit-results.json
```

This prints every cut path. Copy it for reference.

- [ ] **Step 2: Edit the manifest**

For each cut path:
- Open `apps/desktop/src/data/background-manifest.json`
- Find the array containing that path
- Remove the string

Manual edit. After the edits, every `cut` path should be gone, and every category should still have ≥2 entries (verified in Task 2 Step 5).

- [ ] **Step 3: Verify minimums**

```bash
node -e '
const m = require("./apps/desktop/src/data/background-manifest.json");
const photo = m.sets.photography;
let ok = true;
for (const [seg, tiers] of Object.entries(photo)) {
  for (const [tier, paths] of Object.entries(tiers)) {
    if (paths.length < 2) {
      console.log(`✗ ${seg}/${tier} has only ${paths.length} images`);
      ok = false;
    }
  }
}
if (ok) console.log("All categories ≥2. Good.");
'
```

If any category fails, source one more from Unsplash to bring it to 2.

---

## Task 7: Run the pipeline + upload

**No code changes.** Run the existing scripts.

- [ ] **Step 1: Process all sourced images**

```bash
pnpm process:backgrounds
```

This downloads from Unsplash, converts to WebP, writes into `backgrounds/photo/<segment>/<slot>.webp`. New files overwrite the old ones at the same slot path (which is what we want — the manifest path doesn't change for replaced slots).

- [ ] **Step 2: Inspect a few outputs visually**

```bash
ls -lh backgrounds/photo/dawn backgrounds/photo/morning 2>/dev/null
open backgrounds/photo/dawn/light-1.webp 2>/dev/null  # or any path that was replaced
```

Check that the new images look right.

- [ ] **Step 3: Total size check**

```bash
du -sh backgrounds/photo
```

Should be roughly ≤ 22 MB (the original photography set total). If significantly larger, lower `QUALITY` in process-images.ts from 80 to 75 and re-run.

- [ ] **Step 4: Upload to Railway Object Storage**

Verify the storage env vars are set:

```bash
grep -E "STORAGE_(URL|REGION|BUCKET|ACCESS|SECRET)" .env
```

Then run the existing upload script:

```bash
pnpm tsx scripts/upload-backgrounds.ts
```

This walks `backgrounds/**/*.webp` and uploads everything (the existing script's behavior). Replaced slots get overwritten with the new images.

---

## Task 8: Add the attribution sidecar

**Files:**
- Create: `apps/desktop/src/data/image-attributions.json`

We don't surface attribution in V1 (deferred per spec), but we record it in the codebase so the data is there when we want to display it.

- [ ] **Step 1: Generate the sidecar from `replacement-sources.json` (and stub keep verdicts)**

```typescript
// One-off node script — paste into a terminal:
node -e '
const fs = require("fs");
const sources = JSON.parse(fs.readFileSync("./scripts/backgrounds/replacement-sources.json", "utf-8"));
const audit = JSON.parse(fs.readFileSync("./scripts/backgrounds/audit-results.json", "utf-8"));

const attribs = {};

// Replaced slots: full attribution
for (const e of Object.values(sources)) {
  attribs[e.slot] = {
    photographer: e.photographer,
    unsplashId: e.unsplashId,
    unsplashUrl: e.unsplashUrl,
  };
}

// Kept slots: stub (we do not have attribution for original images)
for (const e of Object.values(audit)) {
  if (e.verdict === "keep" && !(e.path in attribs)) {
    attribs[e.path] = { photographer: null, unsplashId: null, unsplashUrl: null, note: "original curated set" };
  }
}

fs.writeFileSync("./apps/desktop/src/data/image-attributions.json", JSON.stringify(attribs, null, 2));
console.log("Wrote", Object.keys(attribs).length, "entries.");
'
```

- [ ] **Step 2: Verify the sidecar**

```bash
jq 'length' apps/desktop/src/data/image-attributions.json
```

Should equal the number of paths remaining in the manifest.

---

## Task 9: Final verification + commit

- [ ] **Step 1: Type and lint check**

```bash
pnpm typecheck
pnpm lint
```

Expected: green. The manifest is JSON and the attribution sidecar is JSON; no schema validation runs at build time, so the typecheck mostly verifies untouched code still compiles.

- [ ] **Step 2: Walk the app**

```bash
pnpm dev:desktop
```

In Settings → Background, verify:
- Every category shows the expected count (no broken image tiles)
- Pin a few of the new replacement images and view across Today, Inbox, Calendar
- Replaced images load (no 404s in DevTools network tab)

- [ ] **Step 3: Commit the manifest + attribution sidecar**

```bash
git add apps/desktop/src/data/background-manifest.json apps/desktop/src/data/image-attributions.json
git commit -m "$(cat <<'EOF'
feat(desktop): refresh background image pool after audit

Cuts B-grade images from the photography set and replaces flagged
slots with Unsplash-sourced images at 2560x1440 WebP q=80. Every
category retains a minimum of 2 images.

Adds image-attributions.json sidecar recording photographer + Unsplash
ID for replaced slots. No UI surfacing this pass (deferred).

Part of Phase 1 (audit & replace) in the background audit spec.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

The image binaries themselves are NOT committed — they live in Railway Object Storage and were uploaded in Task 7 Step 4. The manifest is the source of truth for what's in the pool.

---

## Self-Review — Spec Coverage

Spec Phase 1 section requires:
- ✅ Score every existing image against rubric → Task 1 + Task 2 (CLI + audit walk)
- ✅ Source replacements via Unsplash → Task 3 + Task 4 (CLI + interactive)
- ✅ Upload + regenerate manifest → Task 5 + Task 7 (process + existing upload script)
- ✅ Pool size: A+ only, minimum 2 per category → Task 2 Step 5 + Task 6 Step 3 (verification)
- ✅ Resolution 2560×1440 WebP q=80 → Task 5 Step 2 (script constants)
- ✅ Total footprint stays ≤ ~22 MB → Task 7 Step 3
- ✅ Attribution recorded in manifest, no UI surfacing → Task 8

No gaps.
