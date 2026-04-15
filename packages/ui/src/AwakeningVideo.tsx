import { useRef } from "react";

interface AwakeningVideoProps {
  /** Source URLs in priority order — webm first if available, mp4 fallback. */
  sources: string[];
  /** Fires ~500ms before the video ends, so the parent can begin fading the
   *  cover out / UI in while the video is still playing — avoids the jarring
   *  "video freezes, then fade starts" moment. */
  onNearEnd: () => void;
  /** Fires when playback fully completes OR when all sources fail to load.
   *  Parent should finalize the awakening (e.g., mark phase = "done"). */
  onEnded: () => void;
}

function getMimeType(url: string): string {
  if (url.endsWith(".webm")) return "video/webm";
  if (url.endsWith(".mp4")) return "video/mp4";
  return "";
}

/** How many seconds before the natural end of the video to fire onNearEnd. */
const NEAR_END_SECONDS = 0.5;

/**
 * Plays an awakening video once on mount. The parent (App.tsx) decides
 * whether to mount us via useAwakeningVideo's status.
 *
 * The wrapper is transparent — the parent provides any background color
 * (typically black) so a transparent video element during loading doesn't
 * reveal LivingBackground beneath.
 */
export function AwakeningVideo({ sources, onNearEnd, onEnded }: AwakeningVideoProps) {
  // Track whether we've fired onNearEnd yet — don't re-fire on every frame
  const nearEndFiredRef = useRef(false);

  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (nearEndFiredRef.current) return;
    const video = e.currentTarget;
    // duration may be NaN while metadata is still loading
    if (!Number.isFinite(video.duration)) return;
    if (video.duration - video.currentTime <= NEAR_END_SECONDS) {
      nearEndFiredRef.current = true;
      onNearEnd();
    }
  };

  return (
    <video
      autoPlay
      muted
      playsInline
      preload="auto"
      onTimeUpdate={handleTimeUpdate}
      onEnded={onEnded}
      // If the <video> element exhausts all sources without one playing, browsers
      // fire `error` on the video element. Treat that as "done" so the parent
      // unmounts us and reveals LivingBackground.
      onError={onEnded}
      className="absolute inset-0 w-full h-full object-cover"
    >
      {sources.map((src) => (
        <source key={src} src={src} type={getMimeType(src)} />
      ))}
    </video>
  );
}
