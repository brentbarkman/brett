import React, { useEffect, useState } from "react";
import { X, RefreshCw, Loader2, Settings } from "lucide-react";

interface OverdueItem {
  title: string;
  dueDate: string;
}

interface BriefingSummary {
  overdueTasks: number;
  dueTodayTasks: number;
  todayEvents: number;
  overdueItems: OverdueItem[];
}

interface DailyBriefingProps {
  content: string | null;
  isGenerating?: boolean;
  summary?: BriefingSummary | null;
  hasAI: boolean;
  generatedAt?: string | null;
  onDismiss: () => void;
  onRegenerate?: () => void;
}

export function DailyBriefing({
  content,
  isGenerating,
  summary,
  hasAI,
  generatedAt,
  onDismiss,
  onRegenerate,
}: DailyBriefingProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Parse AI content into bullet points
  const items = content
    ? content
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
        .filter((line) => line.length > 0)
    : [];

  const showAIBriefing = hasAI;
  const showStaticFallback = !hasAI && summary;

  // Check if the day is completely empty
  const isDayEmpty =
    summary &&
    summary.overdueTasks === 0 &&
    summary.dueTodayTasks === 0 &&
    summary.todayEvents === 0;

  return (
    <div
      className={`
        relative w-full bg-black/40 backdrop-blur-md border border-blue-500/30 rounded-xl p-4
        transition-all duration-500 ease-out transform
        ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
          <span className="font-mono text-xs uppercase tracking-wider text-blue-400/90 font-semibold">
            Daily Briefing
          </span>
          {isGenerating && (
            <Loader2 size={12} className="animate-spin text-blue-400/60" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasAI && onRegenerate && (
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

      {/* AI briefing content */}
      {showAIBriefing && (
        <>
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
          ) : (
            <p className="text-sm text-white/40">
              Generating your briefing...
            </p>
          )}
          {generatedAt && !isGenerating && (
            <p className="mt-3 text-[10px] text-white/20">
              Generated{" "}
              {new Date(generatedAt).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
        </>
      )}

      {/* Static fallback (no AI) */}
      {showStaticFallback && (
        <div className="space-y-3">
          {isDayEmpty ? (
            <p className="text-sm text-white/60">
              Your day is clear — no tasks or meetings.
            </p>
          ) : (
            <>
              <p className="text-sm text-white/70">
                {[
                  summary.dueTodayTasks > 0 &&
                    `${summary.dueTodayTasks} task${summary.dueTodayTasks !== 1 ? "s" : ""} due today`,
                  summary.overdueTasks > 0 &&
                    `${summary.overdueTasks} overdue`,
                  summary.todayEvents > 0 &&
                    `${summary.todayEvents} meeting${summary.todayEvents !== 1 ? "s" : ""}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {summary.overdueItems.length > 0 && (
                <ul className="space-y-1">
                  {summary.overdueItems.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2 text-sm text-white/60 leading-relaxed"
                    >
                      <span className="text-amber-500/50 mt-1">•</span>
                      <span>
                        {item.title}{" "}
                        <span className="text-white/30">
                          (due {item.dueDate})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p className="text-[11px] text-white/25 flex items-center gap-1">
            <Settings size={10} />
            Configure AI in Settings for a personalized briefing
          </p>
        </div>
      )}
    </div>
  );
}
