/**
 * Brett's Mark — the single bullet (gold dot + cerulean line).
 * Used as Brett's AI avatar across all surfaces.
 *
 * Also exports ProductMark (stacked brief) for the app logo.
 *
 * In-app marks use brighter, tighter gradient ranges than the app icon
 * because they render at 12–36px on variable backgrounds (including
 * bright sky/ocean through glass). Deep amber shadows that work at
 * 512px on navy look muddy at small sizes on light glass.
 */

interface BrettMarkProps {
  size?: number;
  className?: string;
  thinking?: boolean;
}

/**
 * Brett's AI mark: gold sphere dot + cerulean line.
 *
 * When `thinking` is true, the cerulean line shoots out from the dot
 * and retracts repeatedly — a visible signal pulse.
 */
export function BrettMark({ size = 16, className = "", thinking = false }: BrettMarkProps) {
  const strokeWidth = size <= 14 ? 5 : 4.5;
  const lineLen = 25;

  return (
    <svg
      width={size}
      height={size * 0.55}
      viewBox="0 0 52 28"
      className={className}
    >
      <defs>
        <radialGradient id="bm-sphere" cx="38%" cy="35%" r="55%">
          <stop offset="0%" stopColor="#FCE878" />
          <stop offset="50%" stopColor="#E8B931" />
          <stop offset="100%" stopColor="#D4A020" />
        </radialGradient>
      </defs>
      {thinking && (
        <style>
          {`
            @keyframes brettSignalPulse {
              0% {
                stroke-dashoffset: ${lineLen};
                opacity: 0.4;
              }
              40% {
                stroke-dashoffset: 0;
                opacity: 1;
              }
              70% {
                stroke-dashoffset: 0;
                opacity: 1;
              }
              100% {
                stroke-dashoffset: ${lineLen};
                opacity: 0.4;
              }
            }
          `}
        </style>
      )}
      <circle cx="10" cy="14" r="6.5" fill="url(#bm-sphere)" />
      {thinking && (
        <circle cx="10" cy="14" r="9.5" fill="none" stroke="#E8B931" strokeWidth="1.5" opacity="0.25" />
      )}
      <line
        x1="22"
        y1="14"
        x2="46"
        y2="14"
        stroke="#4682C3"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        style={thinking ? {
          strokeDasharray: `${lineLen}`,
          strokeDashoffset: `${lineLen}`,
          animation: "brettSignalPulse 1.4s ease-in-out infinite",
        } : undefined}
      />
    </svg>
  );
}

/**
 * Product mark: gold stacked brief (3 dot+line rows, cascade fade).
 * Bright gradient range for legibility at small sizes on any background.
 */
export function ProductMark({ size = 24, className = "" }: BrettMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
    >
      <defs>
        <linearGradient id="pm-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F5D96B" />
          <stop offset="50%" stopColor="#E8B931" />
          <stop offset="100%" stopColor="#D4A020" />
        </linearGradient>
        <radialGradient id="pm-sphere" cx="38%" cy="35%" r="55%">
          <stop offset="0%" stopColor="#FCE878" />
          <stop offset="50%" stopColor="#E8B931" />
          <stop offset="100%" stopColor="#D4A020" />
        </radialGradient>
      </defs>

      {/* Row 1: full strength */}
      <circle cx="8" cy="10" r="4" fill="url(#pm-sphere)" />
      <rect x="16" y="7.5" width="20" height="5" rx="2.5" fill="url(#pm-gold)" />

      {/* Row 2: 75% */}
      <g opacity="0.75">
        <circle cx="8" cy="20" r="4" fill="url(#pm-sphere)" />
        <rect x="16" y="17.5" width="15" height="5" rx="2.5" fill="url(#pm-gold)" />
      </g>

      {/* Row 3: 45% */}
      <g opacity="0.45">
        <circle cx="8" cy="30" r="4" fill="url(#pm-sphere)" />
        <rect x="16" y="27.5" width="10" height="5" rx="2.5" fill="url(#pm-gold)" />
      </g>
    </svg>
  );
}
