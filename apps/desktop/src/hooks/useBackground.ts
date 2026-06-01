// apps/desktop/src/hooks/useBackground.ts
import { useState, useEffect, useRef } from "react";
import {
  getTimeSegment,
  getBusynessTier,
  selectImage,
  backgroundManifest as manifest,
  type TimeSegment,
  type BusynessTier,
  type BackgroundStyle,
  type BackgroundManifest,
} from "@brett/business";
import { solidColors } from "../data/solid-colors";
import { useAppConfig } from "./useAppConfig";
import { useVisibilityAwareInterval } from "@brett/ui";
import { userStorage } from "../lib/userScopedStorage";
import fallbackBg from "../assets/fallback-bg.webp";

const SEGMENTS: TimeSegment[] = ["dawn", "morning", "afternoon", "goldenHour", "evening", "night"];
const TIERS: BusynessTier[] = ["light", "moderate", "packed"];

const ROTATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SEGMENT_CHECK_MS = 60 * 1000; // 60 seconds
const CROSSFADE_MS = 3000;

/// Per-slot shuffle-without-replacement bookkeeping, keyed by
/// `${style}/${segment}/${tier}`. Persisted via `userStorage` so the
/// no-repeat behaviour survives cold launches — without persistence,
/// every short-session app open was a uniform draw from a 2–4 image
/// pool, which read as "always image-1" to the user.
type ShownBySlot = Record<string, string[]>;
const SHOWN_PATHS_KEY = "brett-shown-paths.v1";

function loadShownPaths(): ShownBySlot {
  try {
    const raw = userStorage.getItem(SHOWN_PATHS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as ShownBySlot;
  } catch {
    return {};
  }
}

function persistShownPaths(dict: ShownBySlot): void {
  try {
    userStorage.setItem(SHOWN_PATHS_KEY, JSON.stringify(dict));
  } catch {
    // Quota / storage failures are non-fatal — we keep the in-memory
    // dict and the next pick is still deduplicated within the session.
  }
}

interface UseBackgroundInput {
  meetingCount: number;
  taskCount: number;
  backgroundStyle: BackgroundStyle;
  avgBusynessScore?: number;
  /** When set, overrides smart rotation with a fixed background */
  pinnedBackground?: string | null;
}

interface UseBackgroundOutput {
  /** Image URL for photography mode, empty string for abstract */
  imageUrl: string;
  nextImageUrl: string | null;
  isTransitioning: boolean;
  segment: TimeSegment;
  busynessTier: BusynessTier;
  /** CSS background value for abstract mode, null for photography */
  gradient: string | null;
  nextGradient: string | null;
  /** True once the first image (or gradient, for abstract/solid modes) is
   *  ready to render. Awakening gates its Ken Burns start on this — no
   *  point running the zoom on a placeholder/fallback. */
  hasLoadedImage: boolean;
  /** Dev only: cycle to the next image/gradient sequentially */
  devNext: () => void;
  /** Dev only: label for current background (segment/tier/index) */
  devLabel: string;
}

export function useBackground({
  meetingCount,
  taskCount,
  backgroundStyle,
  avgBusynessScore,
  pinnedBackground,
}: UseBackgroundInput): UseBackgroundOutput {
  const { data: config } = useAppConfig();
  const baseUrl = config?.storageBaseUrl ?? "";
  const isAbstract = backgroundStyle === "abstract";
  const isSolid = backgroundStyle === "solid";

  // Always start at the current time segment. (The App-level Ken Burns
  // reveal IS the cold-launch awakening now — no need to show the previous
  // segment and crossfade.) The lastSegmentKey is still written below so
  // other systems that read it (if any) keep working.
  const currentSegment = getTimeSegment(new Date().getHours());
  const lastSegmentKey = "brett-last-segment";
  const [segment, setSegment] = useState<TimeSegment>(currentSegment);
  const [busynessTier, setBusynessTier] = useState<BusynessTier>(() =>
    getBusynessTier(meetingCount, taskCount, avgBusynessScore)
  );

  // Image state (photography). Empty until the first real image loads —
  // LivingBackground treats empty as "don't render an img yet" so the user
  // sees black instead of fallbackBg flashing before the real wallpaper.
  const [currentImage, setCurrentImage] = useState<string>("");
  const [nextImage, setNextImage] = useState<string | null>(null);
  const [hasLoadedImage, setHasLoadedImage] = useState(false);
  const hasLoadedImageRef = useRef(false);

  const [isTransitioning, setIsTransitioning] = useState(false);

  // Per-slot shuffle-without-replacement state, hydrated from
  // userStorage so the no-repeat behaviour survives cold launches.
  // Each slot key `${style}/${segment}/${tier}` keeps its own list;
  // there's no global reset on category change because the lookup
  // naturally targets the right slot.
  const shownBySlotRef = useRef<ShownBySlot>(loadShownPaths());

  // Tracks the currently-active category so the segment-check
  // intervals below can detect a boundary crossing. Kept separate
  // from `shownBySlotRef` — pre-persistence these were entangled
  // (segment changes triggered a shown reset); they don't need to
  // be now.
  const categoryRef = useRef({ segment, busynessTier, backgroundStyle });
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRafRef = useRef<number | null>(null);

  const slotKeyFor = (style: BackgroundStyle, seg: TimeSegment, tier: BusynessTier) =>
    `${style}/${seg}/${tier}`;

  const buildUrl = (relativePath: string) => `${baseUrl}/backgrounds/${relativePath}`;

  // Cancel any in-flight transition
  const cancelTransition = () => {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
    if (pendingRafRef.current !== null) {
      cancelAnimationFrame(pendingRafRef.current);
      pendingRafRef.current = null;
    }
  };

  // Finalize a crossfade after CROSSFADE_MS. Two-step state update: paint
  // Layer B with the new image at opacity 0 first (set by the caller via
  // setNextImage), then flip opacity to 1 in a second frame. Without the
  // double rAF the src change and the opacity change land in the same paint
  // and the browser skips the CSS transition — visible as a flash instead
  // of a fade, especially on visibilitychange-triggered rotations where the
  // next image is already in the browser cache and onload fires in the
  // same task as the visibility flip.
  const startCrossfade = (onComplete: () => void) => {
    cancelTransition();
    pendingRafRef.current = requestAnimationFrame(() => {
      pendingRafRef.current = requestAnimationFrame(() => {
        pendingRafRef.current = null;
        setIsTransitioning(true);
        transitionTimeoutRef.current = setTimeout(() => {
          onComplete();
          setIsTransitioning(false);
          transitionTimeoutRef.current = null;
        }, CROSSFADE_MS);
      });
    });
  };

  const rotateImage = () => {
    const seg = getTimeSegment(new Date().getHours());
    const tier = getBusynessTier(meetingCount, taskCount, avgBusynessScore);

    // Keep `categoryRef` in sync for the segment-check intervals.
    // No shown-list reset needed — per-slot storage already isolates
    // each category's history.
    categoryRef.current = { segment: seg, busynessTier: tier, backgroundStyle };

    setSegment(seg);
    setBusynessTier(tier);

    {
      // Photography and Abstract both use images from the manifest
      const effectiveStyle = isAbstract ? "abstract" : backgroundStyle;
      const slotKey = slotKeyFor(effectiveStyle, seg, tier);
      const shown = shownBySlotRef.current[slotKey] ?? [];

      const relativePath = selectImage(
        manifest as BackgroundManifest,
        effectiveStyle,
        seg,
        tier,
        shown,
      );

      if (!relativePath || !baseUrl) return;

      const fullUrl = buildUrl(relativePath);
      // If the pool was exhausted, `selectImage` re-picks from the
      // full set ignoring `shown`; mirror that by clearing this slot's
      // history before recording the new pick so the cycle restarts
      // cleanly. (Without the clear we'd keep growing the array with
      // duplicates and the filter would no-op on every pick.)
      const refreshedShown = shown.includes(relativePath) ? [relativePath] : [...shown, relativePath];
      shownBySlotRef.current = { ...shownBySlotRef.current, [slotKey]: refreshedShown };
      persistShownPaths(shownBySlotRef.current);

      cancelTransition();

      const img = new Image();
      img.onload = () => {
        // First load: atomic swap, no crossfade. Lets the App-level
        // awakening (Ken Burns) run on the real image without a
        // fallback-to-real crossfade stomping on it.
        if (!hasLoadedImageRef.current) {
          hasLoadedImageRef.current = true;
          setCurrentImage(fullUrl);
          setHasLoadedImage(true);
          return;
        }
        setNextImage(fullUrl);
        startCrossfade(() => {
          setCurrentImage(fullUrl);
          setNextImage(null);
        });
      };
      img.onerror = () => {
        // Silently fail — stay on current, retry next rotation
      };
      img.src = fullUrl;
    }
  };

  // Stash the latest rotateImage in a ref. The interval/visibility/style
  // effects below depend on rotateImage, but rotateImage closes over many
  // props/state and changes identity on every render. Listing it in the
  // deps array would re-run those effects on every render — clearing and
  // resetting the 10-min interval before it ever fires (auto-rotation
  // would silently never run). The ref pattern lets the effects run
  // exactly once while still calling the latest rotateImage.
  const rotateImageRef = useRef(rotateImage);
  rotateImageRef.current = rotateImage;

  // Initial load when config becomes available — fetch the current segment
  // image directly. (Previous-segment-crossfade awakening was removed in
  // favor of the App-level Ken Burns reveal.)
  useEffect(() => {
    if (baseUrl) {
      rotateImageRef.current();
    }
  }, [baseUrl]);

  // Persist the current segment so next launch can do the awakening effect
  useEffect(() => {
    try { userStorage.setItem(lastSegmentKey, segment); } catch { /* noop */ }
  }, [segment]);

  // Rotation timer (10 min) — paused while hidden; the user can't see the
  // background anyway and the segment check below catches up on visible.
  useVisibilityAwareInterval(() => rotateImageRef.current(), ROTATION_INTERVAL_MS);

  // Segment check (60s) — paused while hidden; on becoming visible we
  // immediately re-check so a long hidden stretch that crossed a segment
  // boundary still rotates the moment the user looks at the app.
  useVisibilityAwareInterval(() => {
    const newSegment = getTimeSegment(new Date().getHours());
    if (newSegment !== categoryRef.current.segment) {
      rotateImageRef.current();
    }
  }, SEGMENT_CHECK_MS);

  useEffect(() => {
    const checkSegment = () => {
      const newSegment = getTimeSegment(new Date().getHours());
      if (newSegment !== categoryRef.current.segment) {
        rotateImageRef.current();
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkSegment();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Recalculate busyness when inputs change
  useEffect(() => {
    const newTier = getBusynessTier(meetingCount, taskCount, avgBusynessScore);
    setBusynessTier(newTier);
  }, [meetingCount, taskCount, avgBusynessScore]);

  // Immediately rotate when user switches background style. No
  // shown-list clear needed — switching style just looks up a
  // different slot in `shownBySlotRef`.
  const prevStyleRef = useRef(backgroundStyle);
  useEffect(() => {
    if (prevStyleRef.current !== backgroundStyle) {
      prevStyleRef.current = backgroundStyle;
      rotateImageRef.current();
    }
  }, [backgroundStyle]);

  // Preload next segment's image 5 minutes before boundary. Paused while
  // hidden — preloading offscreen wastes bandwidth and keeps the renderer
  // awake. The visibility-aware interval re-creates each render so the
  // callback closes over latest props.
  useVisibilityAwareInterval(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const minutesIntoHour = now.getMinutes();
    const currentSeg = getTimeSegment(currentHour);

    const segmentBoundaries: Record<string, number> = {
      night: 5, dawn: 7, morning: 12, afternoon: 17, goldenHour: 19, evening: 21,
    };
    const nextBoundaryHour = segmentBoundaries[currentSeg];
    if (nextBoundaryHour === undefined) return;

    const hoursUntil = nextBoundaryHour > currentHour
      ? nextBoundaryHour - currentHour
      : nextBoundaryHour + 24 - currentHour;
    const minutesUntilBoundary = (hoursUntil - 1) * 60 + (60 - minutesIntoHour);

    if (minutesUntilBoundary <= 5 && minutesUntilBoundary > 0) {
      const nextSeg = getTimeSegment(nextBoundaryHour);
      const tier = getBusynessTier(meetingCount, taskCount, avgBusynessScore);
      const path = selectImage(manifest as BackgroundManifest, backgroundStyle, nextSeg, tier, []);
      if (path && baseUrl) {
        const img = new Image();
        img.src = buildUrl(path);
      }
    }
  }, SEGMENT_CHECK_MS);

  // Dev: sequential cycling through ALL images, ignoring smart logic
  const devIndexRef = useRef(-1);
  const [devLabel, setDevLabel] = useState("");

  const devNext = () => {
    devIndexRef.current++;

    const setName = isAbstract ? "abstract" : "photography";
    const imageSet = (manifest as BackgroundManifest).sets[setName];
    const allImages: { seg: string; tier: string; path: string }[] = [];
    for (const seg of SEGMENTS) {
      for (const tier of TIERS) {
        const paths = imageSet?.[seg]?.[tier] ?? [];
        paths.forEach((p) => allImages.push({ seg, tier, path: p }));
      }
    }
    const pos = devIndexRef.current % allImages.length;
    const entry = allImages[pos];
    if (!baseUrl) return;
    const fullUrl = buildUrl(entry.path);
    setDevLabel(`${entry.seg}/${entry.tier}/${entry.path.split("/").pop()} (${pos + 1}/${allImages.length})`);

    cancelTransition();
    const img = new Image();
    img.onload = () => {
      setNextImage(fullUrl);
      startCrossfade(() => {
        setCurrentImage(fullUrl);
        setNextImage(null);
      });
    };
    img.src = fullUrl;
  };

  // Resolve pinned background — overrides smart rotation
  if (pinnedBackground) {
    if (pinnedBackground.startsWith("solid:")) {
      const color = pinnedBackground.slice(6);
      const solid = solidColors.find((s) => s.color === color);
      return {
        imageUrl: fallbackBg,
        nextImageUrl: null,
        isTransitioning: false,
        segment,
        busynessTier,
        gradient: solid?.color ?? color,
        nextGradient: null,
        hasLoadedImage: true,
        devNext,
        devLabel,
      };
    }
    // Photography or Abstract pin: "photo/dawn/light-1.webp" or "abstract/dawn/light-1.webp"
    const pinnedUrl = baseUrl ? buildUrl(pinnedBackground) : fallbackBg;
    return {
      imageUrl: pinnedUrl,
      nextImageUrl: null,
      isTransitioning: false,
      segment,
      busynessTier,
      gradient: null,
      nextGradient: null,
      hasLoadedImage: Boolean(baseUrl),
      devNext,
      devLabel,
    };
  }

  // Solid color mode (unpinned) — use a default dark color
  if (isSolid) {
    return {
      imageUrl: fallbackBg,
      nextImageUrl: null,
      isTransitioning: false,
      segment,
      busynessTier,
      gradient: solidColors[0].color,
      nextGradient: null,
      hasLoadedImage: true,
      devNext,
      devLabel,
    };
  }

  return {
    imageUrl: currentImage,
    nextImageUrl: nextImage,
    isTransitioning,
    segment,
    busynessTier,
    gradient: null,
    nextGradient: null,
    hasLoadedImage,
    devNext,
    devLabel,
  };
}
