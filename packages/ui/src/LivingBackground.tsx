interface LivingBackgroundProps {
  imageUrl: string;
  nextImageUrl: string | null;
  isTransitioning: boolean;
  /** CSS background value for abstract mode */
  gradient?: string | null;
  nextGradient?: string | null;
}

export function LivingBackground({
  imageUrl,
  nextImageUrl,
  isTransitioning,
  gradient,
  nextGradient,
}: LivingBackgroundProps) {
  const useGradients = gradient != null;

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
            draggable={false}
          />

          {/* Image layer B — next (fades in on top) */}
          <img
            src={nextImageUrl ?? imageUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-[3000ms] ease-in-out"
            style={{ opacity: isTransitioning ? 1 : 0 }}
            draggable={false}
          />
        </>
      )}

      {/* Readability overlays — only for images, not solid colors */}
      {!useGradients && (
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />
          <div className="absolute inset-y-0 left-0 w-[312px] bg-gradient-to-r from-black/60 to-transparent pointer-events-none" />
        </>
      )}
    </div>
  );
}
