// apps/desktop/src/hooks/useBackground.ts
import { useState, useEffect, useCallback, useRef } from "react";
import {
  getTimeSegment,
  getBusynessTier,
  selectImage,
  type TimeSegment,
  type BusynessTier,
  type BackgroundStyle,
  type BackgroundManifest,
} from "@brett/business";
import manifest from "../data/background-manifest.json";
import { selectGradient, gradients } from "../data/abstract-gradients";
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

  const [segment, setSegment] = useState<TimeSegment>(() =>
    getTimeSegment(new Date().getHours())
  );
  const [busynessTier, setBusynessTier] = useState<BusynessTier>(() =>
    getBusynessTier(meetingCount, taskCount, avgBusynessScore)
  );

  // Image state (photography)
  const [currentImage, setCurrentImage] = useState<string>(fallbackBg);
  const [nextImage, setNextImage] = useState<string | null>(null);

  // Gradient state (abstract)
  const [currentGradient, setCurrentGradient] = useState<string | null>(null);
  const [nextGradient, setNextGradient] = useState<string | null>(null);

  const [isTransitioning, setIsTransitioning] = useState(false);

  // Track shown items for shuffle-without-replacement
  const shownRef = useRef<(string | number)[]>([]);
  const categoryRef = useRef({ segment, busynessTier, backgroundStyle });
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildUrl = useCallback(
    (relativePath: string) => `${baseUrl}/backgrounds/${relativePath}`,
    [baseUrl]
  );

  // Cancel any in-flight transition
  const cancelTransition = useCallback(() => {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }
  }, []);

  // Finalize a crossfade after CROSSFADE_MS
  const startCrossfade = useCallback((onComplete: () => void) => {
    cancelTransition();
    setIsTransitioning(true);
    transitionTimeoutRef.current = setTimeout(() => {
      onComplete();
      setIsTransitioning(false);
      transitionTimeoutRef.current = null;
    }, CROSSFADE_MS);
  }, [cancelTransition]);

  const rotateImage = useCallback(() => {
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

    if (isAbstract) {
      // Abstract mode: pick a gradient
      const result = selectGradient(seg, tier, shownRef.current as number[]);
      if (!result) return;

      shownRef.current.push(result.index);
      const gradientCss = result.gradient.background;

      setNextGradient(gradientCss);
      startCrossfade(() => {
        setCurrentGradient(gradientCss);
        setNextGradient(null);
      });
    } else {
      // Photography mode: pick and preload an image
      const relativePath = selectImage(
        manifest as BackgroundManifest,
        backgroundStyle,
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
  }, [meetingCount, taskCount, backgroundStyle, isAbstract, baseUrl, buildUrl, cancelTransition, startCrossfade]);

  // Initial load
  useEffect(() => {
    if (isAbstract) {
      // Gradients don't need network — load immediately
      rotateImage();
    } else if (baseUrl) {
      rotateImage();
    }
  }, [baseUrl, isAbstract]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rotation timer (10 min)
  useEffect(() => {
    const interval = setInterval(rotateImage, ROTATION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [rotateImage]);

  // Segment check (60s) + visibility change listener
  useEffect(() => {
    const checkSegment = () => {
      const newSegment = getTimeSegment(new Date().getHours());
      if (newSegment !== categoryRef.current.segment) {
        rotateImage();
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
  }, [rotateImage]);

  // Recalculate busyness when inputs change
  useEffect(() => {
    const newTier = getBusynessTier(meetingCount, taskCount, avgBusynessScore);
    setBusynessTier(newTier);
  }, [meetingCount, taskCount]);

  // Immediately rotate when user switches background style
  const prevStyleRef = useRef(backgroundStyle);
  useEffect(() => {
    if (prevStyleRef.current !== backgroundStyle) {
      prevStyleRef.current = backgroundStyle;
      // Clear opposite mode's state
      if (backgroundStyle === "abstract") {
        setCurrentImage(fallbackBg);
        setNextImage(null);
      } else {
        setCurrentGradient(null);
        setNextGradient(null);
      }
      shownRef.current = [];
      rotateImage();
    }
  }, [backgroundStyle, rotateImage]);

  // Preload next segment's image 5 minutes before boundary (photography only)
  useEffect(() => {
    if (isAbstract) return; // Gradients don't need preloading

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
  }, [isAbstract, meetingCount, taskCount, backgroundStyle, baseUrl, buildUrl]);

  // Dev: sequential cycling through ALL images, ignoring smart logic
  const devIndexRef = useRef(-1);
  const [devLabel, setDevLabel] = useState("");

  const devNext = useCallback(() => {
    devIndexRef.current++;

    if (isAbstract) {
      // Flatten all gradients: segment → tier → index
      const allGradients: { seg: TimeSegment; tier: BusynessTier; idx: number; bg: string }[] = [];
      for (const seg of SEGMENTS) {
        for (const tier of TIERS) {
          const defs = gradients[seg]?.[tier] ?? [];
          defs.forEach((g, i) => allGradients.push({ seg, tier, idx: i, bg: g.background }));
        }
      }
      const pos = devIndexRef.current % allGradients.length;
      const entry = allGradients[pos];
      setDevLabel(`${entry.seg}/${entry.tier}/${entry.idx + 1} (${pos + 1}/${allGradients.length})`);

      setNextGradient(entry.bg);
      startCrossfade(() => {
        setCurrentGradient(entry.bg);
        setNextGradient(null);
      });
    } else {
      // Flatten all photo paths: segment → tier → image
      const allImages: { seg: string; tier: string; path: string }[] = [];
      const photoSet = (manifest as BackgroundManifest).sets.photography;
      for (const seg of SEGMENTS) {
        for (const tier of TIERS) {
          const paths = photoSet?.[seg]?.[tier] ?? [];
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
    }
  }, [isAbstract, baseUrl, buildUrl, cancelTransition, startCrossfade]);

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
        gradient: solid?.background ?? color,
        nextGradient: null,
        devNext,
        devLabel,
      };
    }
    if (pinnedBackground.startsWith("abstract:")) {
      const [, seg, tier, idx] = pinnedBackground.split(":");
      const defs = gradients[seg as TimeSegment]?.[tier as BusynessTier];
      const bg = defs?.[Number(idx)]?.background ?? null;
      return {
        imageUrl: fallbackBg,
        nextImageUrl: null,
        isTransitioning: false,
        segment,
        busynessTier,
        gradient: bg,
        nextGradient: null,
        devNext,
        devLabel,
      };
    }
    // Photography pin: "photo/dawn/light-1.webp"
    const pinnedUrl = baseUrl ? buildUrl(pinnedBackground) : fallbackBg;
    return {
      imageUrl: pinnedUrl,
      nextImageUrl: null,
      isTransitioning: false,
      segment,
      busynessTier,
      gradient: null,
      nextGradient: null,
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
      gradient: solidColors[0].background,
      nextGradient: null,
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
    gradient: isAbstract ? currentGradient : null,
    nextGradient: isAbstract ? nextGradient : null,
    devNext,
    devLabel,
  };
}
