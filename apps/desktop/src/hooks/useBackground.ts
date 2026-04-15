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
import fallbackBg from "../assets/fallback-bg.webp";

const SEGMENTS: TimeSegment[] = ["dawn", "morning", "afternoon", "goldenHour", "evening", "night"];
const TIERS: BusynessTier[] = ["light", "moderate", "packed"];

const ROTATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SEGMENT_CHECK_MS = 60 * 1000; // 60 seconds
const CROSSFADE_MS = 3000;

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

  // Track shown items for shuffle-without-replacement
  const shownRef = useRef<(string | number)[]>([]);
  const categoryRef = useRef({ segment, busynessTier, backgroundStyle });
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildUrl = (relativePath: string) => `${baseUrl}/backgrounds/${relativePath}`;

  // Cancel any in-flight transition
  const cancelTransition = () => {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
  };

  // Finalize a crossfade after CROSSFADE_MS
  const startCrossfade = (onComplete: () => void) => {
    cancelTransition();
    setIsTransitioning(true);
    transitionTimeoutRef.current = setTimeout(() => {
      onComplete();
      setIsTransitioning(false);
      transitionTimeoutRef.current = null;
    }, CROSSFADE_MS);
  };

  const rotateImage = () => {
    const seg = getTimeSegment(new Date().getHours());
    const tier = getBusynessTier(meetingCount, taskCount, avgBusynessScore);

    // Reset shown list if category changed
    const cat = categoryRef.current;
    if (cat.segment !== seg || cat.busynessTier !== tier || cat.backgroundStyle !== backgroundStyle) {
      shownRef.current = [];
      categoryRef.current = { segment: seg, busynessTier: tier, backgroundStyle };
    }

    setSegment(seg);
    setBusynessTier(tier);

    {
      // Photography and Abstract both use images from the manifest
      const relativePath = selectImage(
        manifest as BackgroundManifest,
        isAbstract ? "abstract" : backgroundStyle,
        seg,
        tier,
        shownRef.current as string[]
      );

      if (!relativePath || !baseUrl) return;

      const fullUrl = buildUrl(relativePath);
      shownRef.current.push(relativePath);

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
  }, [baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: only run once when baseUrl becomes available; rotateImageRef.current always reads the latest

  // Persist the current segment so next launch can do the awakening effect
  useEffect(() => {
    try { localStorage.setItem(lastSegmentKey, segment); } catch { /* noop */ }
  }, [segment]);

  // Rotation timer (10 min)
  useEffect(() => {
    const interval = setInterval(() => rotateImageRef.current(), ROTATION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Segment check (60s) + visibility change listener
  useEffect(() => {
    const checkSegment = () => {
      const newSegment = getTimeSegment(new Date().getHours());
      if (newSegment !== categoryRef.current.segment) {
        rotateImageRef.current();
      }
    };

    const interval = setInterval(checkSegment, SEGMENT_CHECK_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        checkSegment();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Recalculate busyness when inputs change
  useEffect(() => {
    const newTier = getBusynessTier(meetingCount, taskCount, avgBusynessScore);
    setBusynessTier(newTier);
  }, [meetingCount, taskCount, avgBusynessScore]);

  // Immediately rotate when user switches background style
  const prevStyleRef = useRef(backgroundStyle);
  useEffect(() => {
    if (prevStyleRef.current !== backgroundStyle) {
      prevStyleRef.current = backgroundStyle;
      shownRef.current = [];
      rotateImageRef.current();
    }
  }, [backgroundStyle]);

  // Preload next segment's image 5 minutes before boundary
  useEffect(() => {

    const preloadCheck = () => {
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
    };

    const interval = setInterval(preloadCheck, SEGMENT_CHECK_MS);
    return () => clearInterval(interval);
  // buildUrl is a fresh closure each render but only references baseUrl, which is in deps —
  // safe to omit. Including it would re-run the effect (and reset the interval) on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingCount, taskCount, backgroundStyle, baseUrl, avgBusynessScore]);

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
