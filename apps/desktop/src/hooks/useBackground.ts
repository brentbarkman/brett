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
import { useAppConfig } from "./useAppConfig";
import fallbackBg from "../assets/fallback-bg.webp";

const ROTATION_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const SEGMENT_CHECK_MS = 60 * 1000; // 60 seconds
const CROSSFADE_MS = 3000;

interface UseBackgroundInput {
  meetingCount: number;
  taskCount: number;
  backgroundStyle: BackgroundStyle;
}

interface UseBackgroundOutput {
  imageUrl: string;
  nextImageUrl: string | null;
  isTransitioning: boolean;
  segment: TimeSegment;
  busynessTier: BusynessTier;
}

export function useBackground({
  meetingCount,
  taskCount,
  backgroundStyle,
}: UseBackgroundInput): UseBackgroundOutput {
  const { data: config } = useAppConfig();
  const baseUrl = config?.storageBaseUrl ?? "";

  const [segment, setSegment] = useState<TimeSegment>(() =>
    getTimeSegment(new Date().getHours())
  );
  const [busynessTier, setBusynessTier] = useState<BusynessTier>(() =>
    getBusynessTier(meetingCount, taskCount)
  );

  const [currentImage, setCurrentImage] = useState<string>(fallbackBg);
  const [nextImage, setNextImage] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const shownRef = useRef<string[]>([]);
  const categoryRef = useRef({ segment, busynessTier, backgroundStyle });
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildUrl = useCallback(
    (relativePath: string) => `${baseUrl}/backgrounds/${relativePath}`,
    [baseUrl]
  );

  const rotateImage = useCallback(() => {
    const seg = getTimeSegment(new Date().getHours());
    const tier = getBusynessTier(meetingCount, taskCount);

    const cat = categoryRef.current;
    if (cat.segment !== seg || cat.busynessTier !== tier || cat.backgroundStyle !== backgroundStyle) {
      shownRef.current = [];
      categoryRef.current = { segment: seg, busynessTier: tier, backgroundStyle };
    }

    setSegment(seg);
    setBusynessTier(tier);

    const relativePath = selectImage(
      manifest as BackgroundManifest,
      backgroundStyle,
      seg,
      tier,
      shownRef.current
    );

    if (!relativePath || !baseUrl) return;

    const fullUrl = buildUrl(relativePath);
    shownRef.current.push(relativePath);

    // Cancel any in-flight transition before starting a new one
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
      transitionTimeoutRef.current = null;
    }

    const img = new Image();
    img.onload = () => {
      setNextImage(fullUrl);
      setIsTransitioning(true);

      transitionTimeoutRef.current = setTimeout(() => {
        setCurrentImage(fullUrl);
        setNextImage(null);
        setIsTransitioning(false);
        transitionTimeoutRef.current = null;
      }, CROSSFADE_MS);
    };
    img.onerror = () => {
      // Silently fail — stay on current image, retry next rotation
    };
    img.src = fullUrl;
  }, [meetingCount, taskCount, backgroundStyle, baseUrl, buildUrl]);

  // Initial image load when config becomes available
  useEffect(() => {
    if (baseUrl) {
      rotateImage();
    }
  }, [baseUrl]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const newTier = getBusynessTier(meetingCount, taskCount);
    setBusynessTier(newTier);
  }, [meetingCount, taskCount]);

  // Immediately rotate when user switches background style
  const prevStyleRef = useRef(backgroundStyle);
  useEffect(() => {
    if (prevStyleRef.current !== backgroundStyle && baseUrl) {
      prevStyleRef.current = backgroundStyle;
      rotateImage();
    }
  }, [backgroundStyle, baseUrl, rotateImage]);

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

      // Handle wrap-around for night (e.g., hour 23 → boundary 5)
      const hoursUntil = nextBoundaryHour > currentHour
        ? nextBoundaryHour - currentHour
        : nextBoundaryHour + 24 - currentHour;
      const minutesUntilBoundary = (hoursUntil - 1) * 60 + (60 - minutesIntoHour);

      if (minutesUntilBoundary <= 5 && minutesUntilBoundary > 0) {
        const nextSeg = getTimeSegment(nextBoundaryHour);
        const tier = getBusynessTier(meetingCount, taskCount);
        const path = selectImage(manifest as BackgroundManifest, backgroundStyle, nextSeg, tier, []);
        if (path && baseUrl) {
          const img = new Image();
          img.src = buildUrl(path);
        }
      }
    };

    const interval = setInterval(preloadCheck, SEGMENT_CHECK_MS);
    return () => clearInterval(interval);
  }, [meetingCount, taskCount, backgroundStyle, baseUrl, buildUrl]);

  return {
    imageUrl: currentImage,
    nextImageUrl: nextImage,
    isTransitioning,
    segment,
    busynessTier,
  };
}
