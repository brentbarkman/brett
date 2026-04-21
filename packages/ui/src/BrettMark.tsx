import React from "react";

/**
 * Brett's Mark — gold-dot + cerulean-line brief.
 * Single component used as the AI avatar across all surfaces.
 * Product icon uses the same geometry at larger sizes.
 */

interface BrettMarkProps {
  size?: number;
  className?: string;
  thinking?: boolean;
}

/**
 * Brett's AI mark. Three gold dots + three cerulean lines, cascading in
 * length + opacity (the "brief" metaphor). When `thinking` is true, the
 * cerulean lines draw left-to-right in staggered succession — a summary
 * being composed in real time.
 */
export function BrettMark({ size = 16, className = "", thinking = false }: BrettMarkProps) {
  const uid = React.useId();
  const gradId = `bm-${uid}-gold`;

  const rows = [
    { y: 5, end: 21 }, // full
    { y: 12, end: 18 }, // medium
    { y: 19, end: 14 }, // short
  ] as const;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Brett"
    >
      <defs>
        <radialGradient id={gradId} cx="35%" cy="32%" r="60%">
          <stop offset="0%" stopColor="#FCE878" />
          <stop offset="55%" stopColor="#E8B931" />
          <stop offset="100%" stopColor="#D4A020" />
        </radialGradient>
      </defs>

      {thinking && (
        <style>{`
          @keyframes brett-brief-draw-0 {
            0%, 8%   { stroke-dashoffset: var(--L0); opacity: 0.3; }
            38%, 68% { stroke-dashoffset: 0;        opacity: 1; }
            100%     { stroke-dashoffset: calc(-1 * var(--L0)); opacity: 0.3; }
          }
          @keyframes brett-brief-draw-1 {
            0%, 8%   { stroke-dashoffset: var(--L1); opacity: 0.3; }
            38%, 68% { stroke-dashoffset: 0;        opacity: 1; }
            100%     { stroke-dashoffset: calc(-1 * var(--L1)); opacity: 0.3; }
          }
          @keyframes brett-brief-draw-2 {
            0%, 8%   { stroke-dashoffset: var(--L2); opacity: 0.3; }
            38%, 68% { stroke-dashoffset: 0;        opacity: 1; }
            100%     { stroke-dashoffset: calc(-1 * var(--L2)); opacity: 0.3; }
          }
        `}</style>
      )}

      {rows.map((row, i) => {
        const len = row.end - 8;
        const baseOpacity = [1, 0.7, 0.45][i];
        return (
          <g key={i}>
            <circle cx={4} cy={row.y} r={2.4} fill={`url(#${gradId})`} opacity={baseOpacity} />
            <line
              x1={8}
              y1={row.y}
              x2={row.end}
              y2={row.y}
              stroke="#4682C3"
              strokeWidth={2.2}
              strokeLinecap="round"
              opacity={thinking ? 0.18 : baseOpacity * 0.85}
            />
            {thinking && (
              <line
                x1={8}
                y1={row.y}
                x2={row.end}
                y2={row.y}
                stroke="#4682C3"
                strokeWidth={2.2}
                strokeLinecap="round"
                style={{
                  ["--L" + i]: len,
                  strokeDasharray: len,
                  strokeDashoffset: len,
                  animation: `brett-brief-draw-${i} 1.8s cubic-bezier(0.16, 1, 0.3, 1) ${i * 0.15}s infinite`,
                } as React.CSSProperties}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Product mark — same geometry, used as dock/splash/app icon.
 * Kept as a separate export so future divergence stays cheap.
 */
export function ProductMark({ size = 24, className = "" }: BrettMarkProps) {
  return <BrettMark size={size} className={className} />;
}

interface WordmarkProps {
  name: string;
  isWorking?: boolean;
  size?: number;
}

/** Wordmark — gold gradient text + cerulean underline. */
export function Wordmark({ name, isWorking = false, size = 19 }: WordmarkProps) {
  return (
    <div className="flex flex-col">
      <span
        className="font-extrabold truncate"
        style={{
          fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
          fontSize: `${size}px`,
          letterSpacing: "0.03em",
          lineHeight: 1,
          background: "linear-gradient(180deg, #F5D96B, #D4A020)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          maxWidth: "140px",
        }}
      >
        {name}
      </span>
      <div
        className="rounded-full mt-[3px]"
        style={{
          height: "2.5px",
          width: "65%",
          background: "linear-gradient(90deg, #4682C3, #5A9AD6 70%, transparent 100%)",
          opacity: isWorking ? undefined : 0.55,
          animation: isWorking ? "wordmarkBreathe 1.4s ease-in-out infinite" : "none",
        }}
      />
    </div>
  );
}
