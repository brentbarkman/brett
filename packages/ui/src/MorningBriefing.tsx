import React, { useEffect, useState } from "react";
import { X, RefreshCw, Loader2 } from "lucide-react";

interface MorningBriefingProps {
  content: string | null;
  isGenerating?: boolean;
  onDismiss: () => void;
  onRegenerate?: () => void;
}

export function MorningBriefing({
  content,
  isGenerating,
  onDismiss,
  onRegenerate,
}: MorningBriefingProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Parse content into bullet points (split by newlines, filter empty)
  const items = content
    ? content
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
        .filter((line) => line.length > 0)
    : [];

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
          {isGenerating && (
            <Loader2 size={12} className="animate-spin text-blue-400/60" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              disabled={isGenerating}
              className="text-white/40 hover:text-white/80 transition-colors rounded-full p-1 hover:bg-white/10 disabled:opacity-30"
              aria-label="Regenerate briefing"
            >
              <RefreshCw size={12} />
            </button>
          )}
          <button
            onClick={onDismiss}
            className="text-white/40 hover:text-white/80 transition-colors rounded-full p-1 hover:bg-white/10"
            aria-label="Dismiss briefing"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {items.length > 0 ? (
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
      ) : isGenerating ? (
        <p className="text-sm text-white/40">Generating your briefing...</p>
      ) : (
        <p className="text-sm text-white/40">No briefing available yet.</p>
      )}
    </div>
  );
}
