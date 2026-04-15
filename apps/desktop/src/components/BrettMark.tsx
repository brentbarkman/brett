/**
 * Brett brand mark — the gold-metallic app icon.
 * Kept in sync with apps/desktop/resources/icon.svg and the download page SVG.
 *
 * Uses a per-instance ID prefix so multiple marks on the same page don't collide
 * on gradient `url(#...)` references.
 */
let instanceCounter = 0;

interface BrettMarkProps {
  size?: number;
  className?: string;
}

export function BrettMark({ size = 40, className }: BrettMarkProps) {
  const id = `brett-mark-${++instanceCounter}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      aria-label="Brett"
    >
      <defs>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F5D96B" />
          <stop offset="40%" stopColor="#E8B931" />
          <stop offset="100%" stopColor="#B8891A" />
        </linearGradient>
        <linearGradient id={`${id}-bar-hl`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FBE88A" stopOpacity="0.6" />
          <stop offset="35%" stopColor="#F5D96B" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-sphere1`} cx="38%" cy="35%" r="55%">
          <stop offset="0%" stopColor="#FBE88A" />
          <stop offset="40%" stopColor="#E8B931" />
          <stop offset="100%" stopColor="#A67B10" />
        </radialGradient>
        <radialGradient id={`${id}-sphere2`} cx="38%" cy="35%" r="55%">
          <stop offset="0%" stopColor="#D4B060" />
          <stop offset="40%" stopColor="#BF9A28" />
          <stop offset="100%" stopColor="#8A6A10" />
        </radialGradient>
        <radialGradient id={`${id}-sphere3`} cx="38%" cy="35%" r="55%">
          <stop offset="0%" stopColor="#A89050" />
          <stop offset="40%" stopColor="#917A20" />
          <stop offset="100%" stopColor="#6B5510" />
        </radialGradient>
        <radialGradient id={`${id}-bg`} cx="50%" cy="44%" r="60%">
          <stop offset="0%" stopColor="#181C2A" />
          <stop offset="100%" stopColor="#0C0F15" />
        </radialGradient>
        <radialGradient id={`${id}-vignette`} cx="50%" cy="46%" r="58%">
          <stop offset="0%" stopColor="black" stopOpacity="0" />
          <stop offset="75%" stopColor="black" stopOpacity="0" />
          <stop offset="100%" stopColor="black" stopOpacity="0.35" />
        </radialGradient>
        <radialGradient id={`${id}-warmth`} cx="52%" cy="50%" r="38%">
          <stop offset="0%" stopColor="#E8B931" stopOpacity="0.14" />
          <stop offset="60%" stopColor="#E8B931" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#E8B931" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-inner`} cx="48%" cy="50%" r="25%">
          <stop offset="0%" stopColor="#E8B931" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#E8B931" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-border`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F5D96B" stopOpacity="0.5" />
          <stop offset="50%" stopColor="#C49A1A" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#F2D04A" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill={`url(#${id}-bg)`} />
      <rect width="512" height="512" rx="112" fill={`url(#${id}-vignette)`} />
      <rect width="512" height="512" rx="112" fill={`url(#${id}-warmth)`} />
      <rect width="512" height="512" rx="112" fill={`url(#${id}-inner)`} />
      <ellipse cx="256" cy="45" rx="140" ry="35" fill="white" opacity="0.012" />
      <rect
        x="1.5"
        y="1.5"
        width="509"
        height="509"
        rx="111"
        fill="none"
        stroke={`url(#${id}-border)`}
        strokeWidth="2"
      />
      <circle cx="135" cy="170" r="28" fill={`url(#${id}-sphere1)`} />
      <rect x="191" y="159" width="196" height="22" rx="11" fill={`url(#${id}-gold)`} />
      <rect x="191" y="159" width="196" height="10" rx="5" fill={`url(#${id}-bar-hl)`} />
      <g opacity="0.75">
        <circle cx="135" cy="256" r="28" fill={`url(#${id}-sphere2)`} />
        <rect x="191" y="245" width="155" height="22" rx="11" fill={`url(#${id}-gold)`} />
        <rect x="191" y="245" width="155" height="10" rx="5" fill={`url(#${id}-bar-hl)`} />
      </g>
      <g opacity="0.45">
        <circle cx="135" cy="342" r="28" fill={`url(#${id}-sphere3)`} />
        <rect x="191" y="331" width="108" height="22" rx="11" fill={`url(#${id}-gold)`} />
        <rect x="191" y="331" width="108" height="10" rx="5" fill={`url(#${id}-bar-hl)`} />
      </g>
    </svg>
  );
}
