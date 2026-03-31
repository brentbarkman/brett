import React, { useState, useRef, useCallback } from "react";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  /** Delay before showing in ms (default: 200) */
  delay?: number;
  /** Preferred position (default: "top") */
  position?: "top" | "bottom";
}

export function Tooltip({ content, children, delay = 200, position = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  const isTop = position === "top";

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {visible && (
        <div
          className={`absolute ${isTop ? "bottom-full mb-2" : "top-full mt-2"} left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-black/80 backdrop-blur-xl border border-white/10 shadow-xl z-50 whitespace-nowrap transition-opacity duration-150`}
        >
          <span className="text-[11px] text-white/70">{content}</span>
          <div
            className={`absolute ${isTop ? "top-full -mt-1" : "bottom-full -mb-1"} left-1/2 -translate-x-1/2 w-2 h-2 bg-black/80 border-white/10 rotate-45 ${isTop ? "border-r border-b" : "border-l border-t"}`}
          />
        </div>
      )}
    </div>
  );
}
