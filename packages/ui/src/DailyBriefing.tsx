import React from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { useDemoMode } from "./lib/demoMode";

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

interface BriefingItem {
  id: string;
  title: string;
}

interface DailyBriefingProps {
  content: string | null;
  isGenerating?: boolean;
  isError?: boolean;
  summary?: BriefingSummary | null;
  hasAI: boolean;
  generatedAt?: string | null;
  items?: BriefingItem[];
  onRegenerate?: () => void;
  onItemClick?: (id: string) => void;
  assistantName?: string;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "to", "for", "of", "in", "on", "at", "and", "or",
  "my", "your", "this", "that", "it", "is", "was", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "with", "from", "into", "then",
  "than", "before", "after", "about", "between", "through", "during",
]);

function sigWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((w) => !STOP_WORDS.has(w) && w.length > 2);
}

function fuzzyMatchItem(text: string, items: BriefingItem[]): BriefingItem | undefined {
  const textWords = sigWords(text);
  if (textWords.length === 0) return undefined;

  let bestMatch: BriefingItem | undefined;
  let bestScore = 0;

  for (const item of items) {
    const titleWords = sigWords(item.title);
    const overlap = textWords.filter((w) => titleWords.some((tw) => tw.includes(w) || w.includes(tw)));
    const threshold = textWords.length <= 2 ? 1 : 2;
    if (overlap.length >= threshold && overlap.length > bestScore) {
      bestScore = overlap.length;
      bestMatch = item;
    }
  }

  return bestMatch;
}

/** Collapse a bulleted briefing into one editorial paragraph, preserving inline
 * markdown markers so item references still link. Mirrors iOS stripMarkdownToPlain. */
function collapseToProse(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith(">") && !line.startsWith("```"))
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ");
}

function renderEditorial(
  text: string,
  titleMap: Map<string, BriefingItem>,
  items: BriefingItem[],
  onItemClick?: (id: string) => void,
): React.ReactNode {
  function matchItem(text: string): BriefingItem | undefined {
    return titleMap.get(text.toLowerCase()) ?? fuzzyMatchItem(text, items);
  }

  const parts = text.split(/(\*\*[^*]+\*\*|"[^"]+")/g);

  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const inner = part.slice(2, -2);
      const matched = matchItem(inner);
      if (matched && onItemClick) {
        return (
          <button
            key={i}
            onClick={() => onItemClick(matched.id)}
            className="font-medium text-brett-gold hover:text-brett-gold/80 transition-colors cursor-pointer"
          >
            {inner}
          </button>
        );
      }
      return <strong key={i} className="font-medium text-white">{inner}</strong>;
    }

    if (part.startsWith('"') && part.endsWith('"')) {
      const inner = part.slice(1, -1);
      const matched = matchItem(inner);
      if (matched && onItemClick) {
        return (
          <button
            key={i}
            onClick={() => onItemClick(matched.id)}
            className="text-brett-gold hover:text-brett-gold/80 transition-colors cursor-pointer"
          >
            {inner}
          </button>
        );
      }
      return <span key={i}>&ldquo;{inner}&rdquo;</span>;
    }

    return <span key={i}>{part}</span>;
  });
}

// Single hero-zone shadow — tight outline + medium halo. Reads at every type size
// so the greeting, date, and brief all carry the same legibility treatment over
// any wallpaper.
const HERO_SHADOW = "[text-shadow:0_1px_2px_rgba(0,0,0,0.7),0_0_8px_rgba(0,0,0,0.55)]";

function BriefingProseSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 bg-white/8 rounded w-full animate-pulse" />
      <div className="h-4 bg-white/8 rounded w-11/12 animate-pulse" />
      <div className="h-4 bg-white/8 rounded w-3/4 animate-pulse" />
    </div>
  );
}

export function DailyBriefing({
  content,
  isGenerating,
  isError,
  summary,
  hasAI,
  items: knownItems = [],
  onRegenerate,
  onItemClick,
  assistantName = "Brett",
}: DailyBriefingProps) {
  useDemoMode();

  const titleMap = new Map(knownItems.map((item) => [item.title.toLowerCase(), item]));

  const now = new Date();
  const greeting = now.toLocaleDateString("en-US", { weekday: "long" }) + ".";
  const dateLine = now
    .toLocaleDateString("en-US", { month: "long", day: "numeric" })
    .toUpperCase();

  const prose = content ? collapseToProse(content) : "";

  const isDayEmpty =
    summary &&
    summary.overdueTasks === 0 &&
    summary.dueTodayTasks === 0 &&
    summary.todayEvents === 0;

  return (
    <div className="group relative px-1 pt-2 pb-4">
      {/* Hover-only regenerate. The briefing is permanent — no dismiss. */}
      {hasAI && onRegenerate && (
        <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onRegenerate}
            disabled={isGenerating}
            className="text-white/40 hover:text-white/80 transition-colors rounded-full p-1 hover:bg-white/10 disabled:opacity-30"
            aria-label="Regenerate briefing"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      )}

      {/* Greeting — editorial 38px serif */}
      <h1
        className={`font-serif text-[38px] leading-[1.05] font-medium tracking-[-0.02em] text-white ${HERO_SHADOW}`}
      >
        {greeting}
      </h1>

      {/* Date sub-line */}
      <div
        className={`mt-1 text-[12px] uppercase tracking-[0.04em] font-medium text-white/85 ${HERO_SHADOW}`}
      >
        {dateLine}
      </div>

      {/* Brief paragraph */}
      <div className="mt-4">
        {hasAI ? (
          isError ? (
            <p className={`text-base text-brett-red/90 leading-relaxed ${HERO_SHADOW}`}>
              Failed to generate briefing.{" "}
              <span className="text-white/60">
                Try again — if this keeps happening, check your AI provider in Settings.
              </span>
              {isGenerating && <Loader2 size={12} className="ml-2 inline animate-spin text-white/40" />}
            </p>
          ) : prose.length > 0 ? (
            <p
              className={`text-[18px] leading-relaxed text-white font-normal ${HERO_SHADOW}`}
            >
              {renderEditorial(prose, titleMap, knownItems, onItemClick)}
              {isGenerating && (
                <Loader2 size={12} className="ml-2 inline align-middle animate-spin text-white/40" />
              )}
            </p>
          ) : (
            <BriefingProseSkeleton />
          )
        ) : !summary ? (
          <BriefingProseSkeleton />
        ) : isDayEmpty ? (
          <p className={`text-[18px] leading-relaxed text-white font-normal ${HERO_SHADOW}`}>
            Nothing on the books today. A rare opening — use it well.
          </p>
        ) : (
          <p className={`text-[18px] leading-relaxed text-white font-normal ${HERO_SHADOW}`}>
            {[
              summary.dueTodayTasks > 0 &&
                `${summary.dueTodayTasks} task${summary.dueTodayTasks !== 1 ? "s" : ""} due today`,
              summary.overdueTasks > 0 && `${summary.overdueTasks} overdue`,
              summary.todayEvents > 0 &&
                `${summary.todayEvents} meeting${summary.todayEvents !== 1 ? "s" : ""}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            .
          </p>
        )}
      </div>
    </div>
  );
}
