import React, { useState, useEffect, useRef } from "react";

interface CrossFadeProps {
  /** Change this to trigger a cross-fade transition */
  stateKey: string;
  children: React.ReactNode;
  /** Fade-out duration in ms */
  exitMs?: number;
  /** Fade-in duration in ms */
  enterMs?: number;
}

/**
 * Cross-fades between children when `stateKey` changes.
 * Holds outgoing content visible during the exit phase so
 * React's unmount doesn't cause a hard pop.
 */
export function CrossFade({
  stateKey,
  children,
  exitMs = 180,
  enterMs = 350,
}: CrossFadeProps) {
  const [phase, setPhase] = useState<"idle" | "exiting" | "entering">("idle");
  const [displayed, setDisplayed] = useState<{
    key: string;
    content: React.ReactNode;
  }>({ key: stateKey, content: children });

  const prevKeyRef = useRef(stateKey);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  // Increment to force a fresh animation on each transition
  const genRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (stateKey === prevKeyRef.current) {
      setDisplayed({ key: stateKey, content: children });
      return;
    }

    prevKeyRef.current = stateKey;
    setPhase("exiting");

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => {
      genRef.current += 1;
      setDisplayed({ key: stateKey, content: children });
      setPhase("entering");

      timeoutRef.current = setTimeout(() => {
        setPhase("idle");
      }, enterMs);
    }, exitMs);
  }, [stateKey, children, exitMs, enterMs]);

  const style: React.CSSProperties =
    phase === "exiting"
      ? { animation: `crossFadeOut ${exitMs}ms cubic-bezier(0.4, 0, 1, 1) forwards` }
      : phase === "entering"
        ? { animation: `crossFadeIn ${enterMs}ms cubic-bezier(0.16, 1, 0.3, 1) forwards` }
        : {};

  return (
    <>
      <div key={genRef.current} style={style}>
        {displayed.content}
      </div>
      <style>{`
        @keyframes crossFadeOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to   { opacity: 0; transform: translateY(6px) scale(0.985); }
        }
        @keyframes crossFadeIn {
          from { opacity: 0; transform: translateY(10px) scale(0.985); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}
