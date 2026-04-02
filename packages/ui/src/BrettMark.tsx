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
 * Use this wherever Brett the AI character appears:
 * chat avatar, Brett's Take indicator, omnibar AI dot, thinking state.
 *
 * When `thinking` is true, the gold dot pulses with an organic rhythm.
 */
export function BrettMark({ size = 16, className = "", thinking = false }: BrettMarkProps) {
  return (
    <svg
      width={size}
      height={size * 0.5}
      viewBox="0 0 52 28"
      className={className}
    >
      <style>
        {`
          @keyframes brettDotBreathe {
            0%, 100% { transform: scale(1); opacity: 1; }
            40% { transform: scale(1.2); opacity: 0.85; }
            70% { transform: scale(1.05); opacity: 0.95; }
          }
        `}
      </style>
      <circle
        cx="10"
        cy="14"
        r="5"
        fill="#E8B931"
        style={thinking ? {
          transformOrigin: "10px 14px",
          animation: "brettDotBreathe 2.5s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        } : undefined}
      />
      {thinking && (
        <circle
          cx="10"
          cy="14"
          r="8"
          fill="none"
          stroke="#E8B931"
          strokeWidth="1"
          opacity="0.2"
          style={{
            transformOrigin: "10px 14px",
            animation: "brettDotBreathe 2.5s cubic-bezier(0.4, 0, 0.2, 1) infinite",
            animationDelay: "0.3s",
          }}
        />
      )}
      <line
        x1="19"
        y1="14"
        x2="42"
        y2="14"
        stroke="#4682C3"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.7"
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
