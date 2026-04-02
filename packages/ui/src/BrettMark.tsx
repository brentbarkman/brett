/**
 * Brett's Mark — the single bullet (gold dot + cerulean line).
 * Used as Brett's AI avatar across all surfaces.
 *
 * Also exports ProductMark (stacked brief) for the app logo.
 */

interface BrettMarkProps {
  size?: number;
  className?: string;
  thinking?: boolean;
}

/**
 * Brett's AI mark: gold dot + solid cerulean line.
 *
 * When `thinking` is true, the cerulean line shoots out from the dot
 * and retracts repeatedly — a visible signal pulse.
 */
export function BrettMark({ size = 16, className = "", thinking = false }: BrettMarkProps) {
  const strokeWidth = size <= 14 ? 4.5 : 4;
  const lineLen = 25; // length of the line in viewBox units

  return (
    <svg
      width={size}
      height={size * 0.55}
      viewBox="0 0 52 28"
      className={className}
    >
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
      <circle cx="10" cy="14" r="6" fill="#E8B931" />
      {thinking && (
        <circle cx="10" cy="14" r="9" fill="none" stroke="#E8B931" strokeWidth="1.5" opacity="0.25" />
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
 * Use this for app logo, favicon context, splash screen.
 */
export function ProductMark({ size = 24, className = "" }: BrettMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={className}
    >
      <circle cx="11" cy="14" r="3" fill="#E8B931" />
      <line
        x1="19"
        y1="14"
        x2="40"
        y2="14"
        stroke="#E8B931"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="11" cy="24" r="3" fill="#E8B931" opacity="0.6" />
      <line
        x1="19"
        y1="24"
        x2="34"
        y2="24"
        stroke="#E8B931"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      <circle cx="11" cy="34" r="3" fill="#E8B931" opacity="0.3" />
      <line
        x1="19"
        y1="34"
        x2="28"
        y2="34"
        stroke="#E8B931"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  );
}
