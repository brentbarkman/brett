# Awakening Videos — Archived Asset Pipeline

_Abandoned 2026-04-15. Cold-launch reveal switched to Ken Burns + cover fade on
the existing wallpaper image ([`apps/desktop/src/App.tsx`](../../apps/desktop/src/App.tsx))._

This doc preserves the original sourcing and processing pipeline so the videos
can be rebuilt if we ever want ambient-motion backgrounds again (e.g., login
screen refresh, tvOS-style aerials, screen-saver mode).

## Why they existed

Phase 3 of the background system audit proposed a brief cinematic clip on cold
launch — a 1–3s atmospheric motion beat keyed to the current time-of-day
segment (dawn/morning/afternoon/goldenHour/evening/night), crossfading into the
settled wallpaper image. After prototyping, the motion-to-still handoff was
unavoidably jarring (composition mismatch, two visual events), so we replaced
it with a pure Ken Burns zoom on the actual wallpaper. See commits
`ef34c8a`..`cfd11fc` for the cutover.

## Source

**Pexels Video API** (free tier). Pick HD clips (1920×1080 or higher). Each
segment got one clip; the last 1.5 seconds were trimmed and transcoded.

## Segments + search queries

From `scripts/awakening-videos/pexels-queries.ts` (deleted; reproduced here):

| Segment      | Query                                       |
| ------------ | ------------------------------------------- |
| `dawn`       | `misty lake dawn slow motion`               |
| `morning`    | `alpine morning sunlight ambient slow`      |
| `afternoon`  | `desert afternoon clouds slow motion`       |
| `goldenHour` | `ocean waves sunset golden hour ambient`    |
| `evening`    | `twilight clouds slow motion ambient`       |
| `night`      | `starry night sky slow motion ambient`      |

The original pipeline picked one HD clip per segment via interactive prompt
(user-curated, not automatic). Specific Pexels IDs were never committed —
`sources.json` was gitignored. If rebuilding: plan to re-curate.

## Processing

Each sourced clip was run through ffmpeg to:

1. **Trim the last 1.5 seconds** — the "settling" portion is where the motion
   reads most naturally against a still wallpaper composition.
2. **Scale to 2560px wide** (retina-friendly width, preserves aspect).
3. **Strip audio** (silent).
4. **Encode twice** — H.264 MP4 (universal fallback) + VP9 WebM (smaller on
   modern browsers).

```bash
# MP4 (H.264)
ffmpeg -y -ss <start> -i <input> -t 1.5 \
  -vf "scale=2560:-2" -c:v libx264 -profile:v high -preset slow \
  -crf 24 -pix_fmt yuv420p -movflags +faststart -an <output>.mp4

# WebM (VP9)
ffmpeg -y -ss <start> -i <input> -t 1.5 \
  -vf "scale=2560:-2" -c:v libvpx-vp9 -crf 32 -b:v 0 -an <output>.webm
```

Where `<start> = ffprobeDuration - 1.5` (trims the last 1.5s).

## Size budget

Per clip target: **≤ 3 MB**. Total set: **≤ 18 MB** (6 segments × mp4 + webm
wasn't actually 12 files on-prem — prod served both encodings via a `<source>`
fallback list, so each segment was ~2× total).

## Storage layout

Railway public bucket, under `videos/awakening/`:

```
videos/awakening/dawn.mp4        videos/awakening/dawn.webm
videos/awakening/morning.mp4     videos/awakening/morning.webm
videos/awakening/afternoon.mp4   videos/awakening/afternoon.webm
videos/awakening/goldenHour.mp4  videos/awakening/goldenHour.webm
videos/awakening/evening.mp4     videos/awakening/evening.webm
videos/awakening/night.mp4       videos/awakening/night.webm
```

Delete all of them with `pnpm delete:awakening-videos` (see
[`scripts/delete-awakening-videos.ts`](../../scripts/delete-awakening-videos.ts)).

## If rebuilding

Recreate the deleted files in this order:

1. **`scripts/awakening-videos/pexels-queries.ts`** — the segment → query map
   above.
2. **`scripts/awakening-videos/pexels-source.ts`** — interactive CLI: search
   Pexels for each segment, print thumbnails / URLs, prompt to pick. Save
   picks to `scripts/awakening-videos/sources.json` (gitignored). Needs
   `PEXELS_API_KEY` env var.
3. **`scripts/awakening-videos/process-videos.ts`** — reads sources.json,
   downloads each clip into `scripts/awakening-videos/downloads/` (cached),
   runs the ffmpeg pipeline above, writes into
   `apps/desktop/public/videos/awakening/`.
4. **`pnpm upload:videos`** — uploads to Railway storage.

Reference the pre-deletion commit `9868ced^` to recover exact script source:

```bash
git show 9868ced^:scripts/awakening-videos/pexels-source.ts > scripts/awakening-videos/pexels-source.ts
git show 9868ced^:scripts/awakening-videos/process-videos.ts > scripts/awakening-videos/process-videos.ts
git show 9868ced^:scripts/awakening-videos/pexels-queries.ts > scripts/awakening-videos/pexels-queries.ts
```

## Consumer code (also removed)

The app-side code paths that rendered videos are archived at the same commit:

- `packages/ui/src/AwakeningVideo.tsx` — `<video>` wrapper with mp4/webm
  `<source>` list, `onNearEnd` callback (fired ~500ms before end), `onEnded`,
  `maxDurationSeconds` cap.
- `apps/desktop/src/data/awakening-manifest.json` — `{ segment: { mp4, webm } }`
  map pointing at the Railway URLs.
- `useAwakeningVideo` hook — resolved segment → URL list (replaced by
  [`useAwakening`](../../apps/desktop/src/hooks/useAwakening.ts), which keeps
  only the session/reduced-motion gating).

Recoverable with `git show 9868ced^:<path>`.
