interface LivingBackgroundProps {
  imageUrl: string;
  nextImageUrl: string | null;
  isTransitioning: boolean;
  /** CSS background value for abstract mode */
  gradient?: string | null;
  nextGradient?: string | null;
  /** When true, the image layer is scaled up (scale 1.08). Toggle to false to
   *  animate it back to natural scale (scale 1.0). Used for the "Ken Burns"
   *  awakening mode — a slow zoom-out as the cold-launch reveal. */
  awakeningZoom?: boolean;
  /** Duration of the scale transition in ms. Only applied when awakeningZoom
   *  is a defined boolean (i.e., the caller is driving the zoom animation). */
  awakeningZoomDurationMs?: number;
}

export function LivingBackground({
  imageUrl,
  nextImageUrl,
  isTransitioning,
  gradient,
  nextGradient,
  awakeningZoom,
  awakeningZoomDurationMs,
}: LivingBackgroundProps) {
  const useGradients = gradient != null;
  const zoomStyle =
    awakeningZoom !== undefined
      ? {
          transform: awakeningZoom ? "scale(1.15)" : "scale(1)",
          transition: awakeningZoomDurationMs
            ? `transform ${awakeningZoomDurationMs}ms cubic-bezier(0.16, 1, 0.3, 1)`
            : undefined,
        }
      : undefined;

  return (
    <div className="absolute inset-0 z-0">
      {useGradients ? (
        <>
          {/* Gradient layer A — current */}
          <div
            className="absolute inset-0 transition-opacity duration-[3000ms]"
            style={{
              background: gradient,
              opacity: isTransitioning ? 0 : 1,
            }}
          />

          {/* Gradient layer B — next */}
          <div
            className="absolute inset-0 transition-opacity duration-[3000ms]"
            style={{
              background: nextGradient ?? gradient,
              opacity: isTransitioning ? 1 : 0,
            }}
          />
        </>
      ) : (
        <>
          {/*
           * Two-layer crossfade: layer B sits ABOVE layer A.
           * When transitioning, B fades in over A (which stays at full opacity).
           * This prevents the dark flash caused by both layers at partial opacity.
           * After the transition completes, A updates to the new image and B hides.
           */}

          {/* Image layer A — current (always visible) */}
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={zoomStyle}
            draggable={false}
          />

          {/* Image layer B — next (fades in on top) */}
          <img
            src={nextImageUrl ?? imageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-[3000ms] ease-in-out"
            style={{ opacity: isTransitioning ? 1 : 0, ...zoomStyle }}
            draggable={false}
          />
        </>
      )}

      {/* Readability overlays — only for images, not solid colors.
       *
       * Linear gradients here complement BackgroundScrim (mounted above
       * LivingBackground in App.tsx) which provides the full-viewport radial
       * darkening. These linears serve purposes the radial doesn't:
       *
       * - Top gradient: contrast behind the macOS traffic-light window chrome
       *   (reduced from to-black/40 → to-black/30 now that the scrim sits on top)
       * - Left gradient: darkens behind the fixed sidebar nav (unchanged)
       *
       * Bottom gradient removed — the radial scrim handles bottom-edge
       * darkening and doubling up muddied night scenes.
       */}
      {!useGradients && (
        <>
          <div className="absolute inset-x-0 top-0 h-[40%] bg-gradient-to-b from-black/30 to-transparent pointer-events-none" />
          <div className="absolute inset-y-0 left-0 w-[312px] bg-gradient-to-r from-black/60 to-transparent pointer-events-none" />
        </>
      )}
    </div>
  );
}
