import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

interface MorningBriefingProps {
  items: string[];
  onDismiss: () => void;
}

export function MorningBriefing({ items, onDismiss }: MorningBriefingProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`
        relative w-full bg-black/40 backdrop-blur-md border border-blue-500/30 rounded-xl p-4
        transition-all duration-500 ease-out transform
        ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}
      `}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
          <span className="font-mono text-xs uppercase tracking-wider text-blue-400/90 font-semibold">
            Morning Briefing
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="text-white/40 hover:text-white/80 transition-colors rounded-full p-1 hover:bg-white/10"
          aria-label="Dismiss briefing"
        >
          <X size={14} />
        </button>
      </div>

      <ul className="space-y-2">
        {items.map((item, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 text-sm text-white/80 leading-relaxed"
          >
            <span className="text-blue-500/50 mt-1">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
