import React, { useEffect, useState, useCallback } from "react";
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
  onDismiss: () => void;
  onRegenerate?: () => void;
  onItemClick?: (id: string) => void;
}

/**
 * Parse inline markdown and linkify item references.
 * Handles: **bold**, "quoted text" matched against known items.
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "to", "for", "of", "in", "on", "at", "and", "or",
  "my", "your", "this", "that", "it", "is", "was", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "with", "from", "into", "then",
  "than", "before", "after", "about", "between", "through", "during",
]);

/** Extract significant words from text (no stop words, >2 chars) */
function sigWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((w) => !STOP_WORDS.has(w) && w.length > 2);
}

/** Fuzzy match: find an item whose title shares enough significant words with the text */
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

/**
 * Scan plain text for n-gram spans that fuzzy-match known items.
 * Returns the text split into segments with matched spans replaced by link elements.
 */
function linkifyPlainText(
  text: string,
  items: BriefingItem[],
  onItemClick: (id: string) => void,
  keyOffset: number,
): React.ReactNode[] {
  if (items.length === 0) return [<span key={keyOffset}>{text}</span>];

  // Build keyword → item index for fast scanning
  const itemKeywords: Array<{ item: BriefingItem; words: string[] }> = [];
  for (const item of items) {
    const words = sigWords(item.title);
    if (words.length > 0) itemKeywords.push({ item, words });
  }

  // Try n-grams from longest (4) to shortest (2) to find the best match span
  const words = text.split(/(\s+)/); // preserve whitespace as separate tokens
  const textOnly = words.filter((_, i) => i % 2 === 0); // odd indices are whitespace
  const result: React.ReactNode[] = [];
  let consumed = 0; // index into `text`

  for (let start = 0; start < textOnly.length; start++) {
    // Try 4, 3, 2-word windows
    for (let len = Math.min(4, textOnly.length - start); len >= 2; len--) {
      const phrase = textOnly.slice(start, start + len).join(" ");
      const matched = fuzzyMatchItem(phrase, items);
      if (matched) {
        // Find the actual position of this phrase in the original text
        const phraseStart = findPhrasePosition(text, textOnly, start, consumed);
        if (phraseStart > consumed) {
          result.push(<span key={keyOffset + result.length}>{text.slice(consumed, phraseStart)}</span>);
        }
        const phraseEnd = findPhraseEnd(text, textOnly, start, len, phraseStart);
        const matchedText = text.slice(phraseStart, phraseEnd);
        result.push(
          <button
            key={keyOffset + result.length}
            onClick={() => onItemClick(matched.id)}
            className="text-blue-400/90 hover:text-blue-300 transition-colors cursor-pointer"
          >
            {matchedText}
          </button>
        );
        consumed = phraseEnd;
        start = start + len - 1; // -1 because loop increments
        break;
      }
    }
  }

  if (consumed < text.length) {
    result.push(<span key={keyOffset + result.length}>{text.slice(consumed)}</span>);
  }

  return result.length > 0 ? result : [<span key={keyOffset}>{text}</span>];
}

/** Find where a word at index `wordIdx` starts in the original text, searching from `searchFrom` */
function findPhrasePosition(text: string, textWords: string[], wordIdx: number, searchFrom: number): number {
  let pos = searchFrom;
  for (let i = 0; i < wordIdx; i++) {
    const idx = text.indexOf(textWords[i], pos);
    if (idx === -1) return pos;
    pos = idx + textWords[i].length;
  }
  // Find the start of the target word
  const idx = text.indexOf(textWords[wordIdx], pos);
  return idx === -1 ? pos : idx;
}

/** Find the end position of the phrase spanning wordIdx to wordIdx+len-1 */
function findPhraseEnd(text: string, textWords: string[], wordIdx: number, len: number, phraseStart: number): number {
  let pos = phraseStart;
  for (let i = 0; i < len; i++) {
    const idx = text.indexOf(textWords[wordIdx + i], pos);
    if (idx === -1) return pos;
    pos = idx + textWords[wordIdx + i].length;
  }
  return pos;
}

function renderBriefingLine(
  text: string,
  items: BriefingItem[],
  onItemClick?: (id: string) => void,
): React.ReactNode {
  // Build a lookup of lowercase title → item for exact matching
  const titleMap = new Map<string, BriefingItem>();
  for (const item of items) {
    titleMap.set(item.title.toLowerCase(), item);
  }

  function matchItem(text: string): BriefingItem | undefined {
    return titleMap.get(text.toLowerCase()) ?? fuzzyMatchItem(text, items);
  }

  // Split on **bold** and "quoted" patterns, preserving delimiters
  const parts = text.split(/(\*\*[^*]+\*\*|"[^"]+")/g);
  let keyIdx = 0;

  return parts.flatMap((part) => {
    const baseKey = keyIdx;

    // Bold: **text**
    if (part.startsWith("**") && part.endsWith("**")) {
      const inner = part.slice(2, -2);
      const matched = matchItem(inner);
      keyIdx++;
      if (matched && onItemClick) {
        return (
          <button
            key={baseKey}
            onClick={() => onItemClick(matched.id)}
            className="font-semibold text-blue-400/90 hover:text-blue-300 transition-colors cursor-pointer"
          >
            {inner}
          </button>
        );
      }
      return <strong key={baseKey} className="font-semibold text-white/90">{inner}</strong>;
    }

    // Quoted: "text"
    if (part.startsWith('"') && part.endsWith('"')) {
      const inner = part.slice(1, -1);
      const matched = matchItem(inner);
      keyIdx++;
      if (matched && onItemClick) {
        return (
          <button
            key={baseKey}
            onClick={() => onItemClick(matched.id)}
            className="text-blue-400/90 hover:text-blue-300 transition-colors cursor-pointer"
          >
            {inner}
          </button>
        );
      }
      return <span key={baseKey}>&ldquo;{inner}&rdquo;</span>;
    }

    // Plain text — scan for unbolded task references
    if (onItemClick && items.length > 0) {
      const nodes = linkifyPlainText(part, items, onItemClick, keyIdx);
      keyIdx += nodes.length;
      return nodes;
    }

    keyIdx++;
    return <span key={baseKey}>{part}</span>;
  });
}

export function DailyBriefing({
  content,
  isGenerating,
  isError,
  summary,
  hasAI,
  generatedAt,
  items: knownItems = [],
  onDismiss,
  onRegenerate,
  onItemClick,
}: DailyBriefingProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const renderLine = useCallback(
    (text: string) => renderBriefingLine(text, knownItems, onItemClick),
    [knownItems, onItemClick],
  );

  // Parse AI content into bullet points
  const bulletItems = content
    ? content
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s*/, "").trim())
        .filter((line) => line.length > 0)
    : [];

  const showAIBriefing = hasAI;
  const showStaticFallback = !hasAI;

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
          {isError ? (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2.5">
              <p className="text-sm text-red-400/90">
                Failed to generate briefing.
              </p>
              <p className="text-xs text-white/40 mt-1">
                Try again — if this keeps happening, check your AI provider in Settings.
              </p>
            </div>
          ) : bulletItems.length > 0 ? (
            <ul className="space-y-2">
              {bulletItems.map((line, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 text-sm text-white/80 leading-relaxed"
                >
                  <span className="text-blue-500/50 mt-1">•</span>
                  <span>{renderLine(line)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-white/5 animate-pulse mt-2 flex-shrink-0" />
                <div className="bg-white/5 animate-pulse rounded-lg h-3.5 w-full" />
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-white/5 animate-pulse mt-2 flex-shrink-0" />
                <div className="bg-white/5 animate-pulse rounded-lg h-3.5 w-5/6" />
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-white/5 animate-pulse mt-2 flex-shrink-0" />
                <div className="bg-white/5 animate-pulse rounded-lg h-3.5 w-2/3" />
              </div>
            </div>
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
          {!summary ? (
            <div className="space-y-2.5">
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-white/5 animate-pulse mt-2 flex-shrink-0" />
                <div className="bg-white/5 animate-pulse rounded-lg h-3.5 w-3/4" />
              </div>
              <div className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-white/5 animate-pulse mt-2 flex-shrink-0" />
                <div className="bg-white/5 animate-pulse rounded-lg h-3.5 w-1/2" />
              </div>
            </div>
          ) : isDayEmpty ? (
            <p className="text-sm text-white/60">
              Nothing on the books today. A rare opening — use it well.
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
            Add an AI provider in Settings for a personalized daily briefing
          </p>
        </div>
      )}
    </div>
  );
}
