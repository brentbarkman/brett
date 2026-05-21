// packages/ui/src/BriefingCanopy.tsx

/**
 * Top-edge gradient overlay that sits above the wallpaper and below all
 * UI chrome on the Today page. Gives the briefing prose a uniform field
 * to sit on regardless of the wallpaper's upper composition — a
 * lightweight structural fix that replaces the per-wallpaper
 * sample-and-swap dance with a single ambient layer.
 *
 * V2 calibration (selected in the May 2026 briefing-readability review):
 *   - 55% of viewport height
 *   - linear-gradient: rgba(0,0,0,0.55) → 0.26 at 50% → transparent
 *   - feathers naturally into the wallpaper below the briefing block
 *
 * Mount on the Today route only — every other page has its own chrome
 * occupying the top area, so the scrim would just darken the wallpaper
 * behind nav/cards without serving readability.
 *
 * Static by design — no animation. Ambient chrome.
 */
export function BriefingCanopy() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-0 top-0 pointer-events-none"
      style={{
        height: "55%",
        background:
          "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.26) 50%, transparent 100%)",
      }}
    />
  );
}
