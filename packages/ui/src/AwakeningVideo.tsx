interface AwakeningVideoProps {
  /** Source URLs in priority order — webm first if available, mp4 fallback. */
  sources: string[];
  /** Fired when video playback completes naturally OR when all sources fail to load
   *  (so the parent can fall through to LivingBackground instead of hanging on a
   *  black overlay forever). */
  onEnded: () => void;
}

function getMimeType(url: string): string {
  if (url.endsWith(".webm")) return "video/webm";
  if (url.endsWith(".mp4")) return "video/mp4";
  return "";
}

/**
 * Plays an awakening video once on mount. The parent (App.tsx) decides
 * whether to mount us via useAwakeningVideo's status.
 *
 * The wrapper is transparent — the parent provides any background color
 * (typically black) so a transparent video element during loading doesn't
 * reveal LivingBackground beneath.
 */
export function AwakeningVideo({ sources, onEnded }: AwakeningVideoProps) {
  return (
    <video
      autoPlay
      muted
      playsInline
      preload="auto"
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
