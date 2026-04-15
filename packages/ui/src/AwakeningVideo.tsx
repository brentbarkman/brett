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
