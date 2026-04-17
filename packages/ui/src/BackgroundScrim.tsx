// packages/ui/src/BackgroundScrim.tsx

/**
 * Full-viewport radial vignette that sits between LivingBackground and
 * app content. Darkens the outer edges (especially the bottom-right where
 * there's no sidebar chrome) so glass cards have enough contrast with
 * whatever image or gradient is behind them.
 *
 * Centered at 30% from left / 45% from top to bias toward the content
 * area (sidebar lives on the left, content is slightly above center).
 *
 * Static by design — no animation. Ambient chrome.
 */
export function BackgroundScrim() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          "radial-gradient(ellipse at 30% 45%, transparent 0%, rgba(0,0,0,0.25) 75%)",
      }}
    />
  );
}
