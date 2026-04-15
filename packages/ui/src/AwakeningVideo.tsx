import { useRef } from "react";

interface AwakeningVideoProps {
  /** Source URLs in priority order — webm first if available, mp4 fallback. */
  sources: string[];
  /** Optional playback cap (in seconds). When reached, the video is paused
   *  and onEnded fires, regardless of natural duration. Use for experimenting
   *  with timing without re-encoding the source. */
  maxDurationSeconds?: number;
  /** Fires ~500ms before effective end of playback (min of natural duration
   *  and maxDurationSeconds). Parent uses this to begin cross-fading while
   *  the video is still in motion. */
  onNearEnd: () => void;
  /** Fires at natural end, cap-pause, or on load error. Parent finalizes. */
  onEnded: () => void;
}

function getMimeType(url: string): string {
  if (url.endsWith(".webm")) return "video/webm";
  if (url.endsWith(".mp4")) return "video/mp4";
  return "";
}

/** How many seconds before the effective end to fire onNearEnd. */
const NEAR_END_SECONDS = 0.5;

/**
 * Plays an awakening video once on mount. The parent (App.tsx) decides
 * whether to mount us via useAwakeningVideo's status.
 *
 * The wrapper is transparent — the parent provides any background color
 * (typically black) so a transparent video element during loading doesn't
 * reveal LivingBackground beneath.
 */
export function AwakeningVideo({
  sources,
  maxDurationSeconds,
  onNearEnd,
  onEnded,
}: AwakeningVideoProps) {
  const nearEndFiredRef = useRef(false);
  const endedFiredRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (!Number.isFinite(video.duration)) return;

    const effectiveEnd = maxDurationSeconds
      ? Math.min(video.duration, maxDurationSeconds)
      : video.duration;

    // Cap enforcement: pause + onEnded when we reach the cap early
    if (!endedFiredRef.current && video.currentTime >= effectiveEnd) {
      endedFiredRef.current = true;
      video.pause();
      onEnded();
      return;
    }

    if (!nearEndFiredRef.current && effectiveEnd - video.currentTime <= NEAR_END_SECONDS) {
      nearEndFiredRef.current = true;
      onNearEnd();
    }
  };

  const handleNativeEnded = () => {
    if (endedFiredRef.current) return;
    endedFiredRef.current = true;
    onEnded();
  };

  const handleError = () => {
    if (endedFiredRef.current) return;
    endedFiredRef.current = true;
    onEnded();
  };

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      preload="auto"
      onTimeUpdate={handleTimeUpdate}
      onEnded={handleNativeEnded}
      onError={handleError}
      className="absolute inset-0 w-full h-full object-cover"
    >
      {sources.map((src) => (
        <source key={src} src={src} type={getMimeType(src)} />
      ))}
    </video>
  );
}
