interface LivingBackgroundProps {
  imageUrl: string;
  nextImageUrl: string | null;
  isTransitioning: boolean;
}

export function LivingBackground({
  imageUrl,
  nextImageUrl,
  isTransitioning,
}: LivingBackgroundProps) {
  return (
    <div className="absolute inset-0 z-0">
      {/* Image layer A — current */}
      <img
        src={imageUrl}
        alt=""
        className="absolute inset-0 w-full h-full object-cover transition-opacity duration-[3000ms]"
        style={{ opacity: isTransitioning ? 0 : 1 }}
        draggable={false}
      />

      {/* Image layer B — next (crossfade target) */}
      {nextImageUrl && (
        <img
          src={nextImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-[3000ms]"
          style={{ opacity: isTransitioning ? 1 : 0 }}
          draggable={false}
        />
      )}

      {/* Vignette overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />

      {/* Left-side scrim for nav readability */}
      <div className="absolute inset-y-0 left-0 w-[312px] bg-gradient-to-r from-black/60 to-transparent pointer-events-none" />
    </div>
  );
}
