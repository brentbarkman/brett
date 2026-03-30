import React from "react";

/**
 * Lightweight inline markdown renderer for Brett's AI responses.
 * Supports: **bold**, *italic*, `code`, [links](url), and line breaks.
 * No external dependencies — just regex-based parsing into React elements.
 */

interface SimpleMarkdownProps {
  content: string;
  className?: string;
  /** Callback when an item ID is clicked (for inline item references) */
  onItemClick?: (id: string) => void;
  /** Callback when a calendar event is clicked */
  onEventClick?: (eventId: string) => void;
  /** Callback when a navigation link is clicked (for list/view references) */
  onNavigate?: (path: string) => void;
}

export function SimpleMarkdown({ content, className, onItemClick, onEventClick, onNavigate }: SimpleMarkdownProps) {
  if (!content) return null;

  // Split into lines, render each line with inline formatting
  const lines = content.split("\n");

  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      {lines.map((line, lineIdx) => {
        const trimmed = line.trim();

        // Empty line = paragraph break
        if (!trimmed) {
          return <div key={lineIdx} className="h-2" />;
        }

        // Headers (### h3, ## h2, # h1)
        if (trimmed.startsWith("### ")) {
          return (
            <div key={lineIdx} className="text-white/80 font-semibold text-[13px] mt-2 first:mt-0">
              {renderInline(trimmed.slice(4), onItemClick, onEventClick, onNavigate)}
            </div>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <div key={lineIdx} className="text-white/80 font-semibold text-sm mt-2 first:mt-0">
              {renderInline(trimmed.slice(3), onItemClick, onEventClick, onNavigate)}
            </div>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <div key={lineIdx} className="text-white font-semibold text-[15px] mt-2 first:mt-0">
              {renderInline(trimmed.slice(2), onItemClick, onEventClick, onNavigate)}
            </div>
          );
        }

        // Bullet point
        if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
          return (
            <div key={lineIdx} className="flex gap-2 pl-1">
              <span className="text-white/40 select-none">•</span>
              <span>{renderInline(trimmed.slice(2), onItemClick, onEventClick, onNavigate)}</span>
            </div>
          );
        }

        // Numbered list
        const numMatch = trimmed.match(/^(\d+)\.\s/);
        if (numMatch) {
          return (
            <div key={lineIdx} className="flex gap-2 pl-1">
              <span className="text-white/40 select-none min-w-[1rem] text-right">{numMatch[1]}.</span>
              <span>{renderInline(trimmed.slice(numMatch[0].length), onItemClick, onEventClick, onNavigate)}</span>
            </div>
          );
        }

        // Regular line
        return <div key={lineIdx}>{renderInline(trimmed, onItemClick, onEventClick, onNavigate)}</div>;
      })}
    </div>
  );
}

// All inline patterns, ordered by specificity (most specific first)
const PATTERNS: { type: string; regex: RegExp }[] = [
  // `code` — must come before bold/italic to avoid conflict
  { type: "code", regex: /`([^`]+)`/ },
  // ~~strikethrough~~
  { type: "strike", regex: /~~(.+?)~~/ },
  // **bold**
  { type: "bold", regex: /\*\*(.+?)\*\*/ },
  // *italic* (but not **)
  { type: "italic", regex: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/ },
  // [text](brett-item:id) — clickable item reference
  { type: "item-ref", regex: /\[([^\]]+)\]\(brett-item:([a-zA-Z0-9_-]+)\)/ },
  // [text](brett-event:id) — clickable calendar event reference
  { type: "event-ref", regex: /\[([^\]]+)\]\(brett-event:([a-zA-Z0-9_-]+)\)/ },
  // [text](brett-nav:/path) — clickable navigation link
  { type: "nav-ref", regex: /\[([^\]]+)\]\(brett-nav:(\/[^)]+)\)/ },
  // [text](any-url) — generic markdown link (catch-all, render as styled text)
  { type: "link", regex: /\[([^\]]+)\]\(([^)]+)\)/ },
];

function renderInline(
  text: string,
  onItemClick?: (id: string) => void,
  onEventClick?: (eventId: string) => void,
  onNavigate?: (path: string) => void,
): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Find the earliest match across all patterns
    let best: { type: string; match: RegExpMatchArray; index: number } | null = null;

    for (const p of PATTERNS) {
      const m = remaining.match(p.regex);
      if (m && m.index !== undefined && (!best || m.index < best.index)) {
        best = { type: p.type, match: m, index: m.index };
      }
    }

    if (!best) {
      parts.push(remaining);
      break;
    }

    // Text before the match
    if (best.index > 0) {
      parts.push(remaining.slice(0, best.index));
    }

    const content = best.match[1];
    const extra = best.match[2];

    switch (best.type) {
      case "bold":
        parts.push(<strong key={key++} className="font-semibold text-white">{renderInline(content, onItemClick, onEventClick, onNavigate)}</strong>);
        break;
      case "italic":
        parts.push(<em key={key++} className="italic text-white/80">{renderInline(content, onItemClick, onEventClick, onNavigate)}</em>);
        break;
      case "strike":
        parts.push(<span key={key++} className="line-through text-white/40">{renderInline(content, onItemClick, onEventClick, onNavigate)}</span>);
        break;
      case "code":
        parts.push(
          <code key={key++} className="px-1 py-0.5 rounded bg-white/10 text-white/90 text-xs font-mono">
            {content}
          </code>
        );
        break;
      case "item-ref":
        parts.push(
          onItemClick ? (
            <button
              key={key++}
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
              onClick={() => onItemClick(extra!)}
            >
              {content}
            </button>
          ) : (
            <span key={key++} className="text-blue-400">{content}</span>
          )
        );
        break;
      case "event-ref":
        parts.push(
          onEventClick ? (
            <button
              key={key++}
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
              onClick={() => onEventClick(extra!)}
            >
              {content}
            </button>
          ) : (
            <span key={key++} className="text-blue-400">{content}</span>
          )
        );
        break;
      case "nav-ref":
        parts.push(
          onNavigate ? (
            <button
              key={key++}
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
              onClick={() => onNavigate(extra!)}
            >
              {content}
            </button>
          ) : (
            <span key={key++} className="text-blue-400">{content}</span>
          )
        );
        break;
      case "link":
        // Generic link — strip markdown syntax, render text as styled span
        // Don't make arbitrary URLs clickable (security)
        parts.push(<span key={key++} className="text-blue-400">{content}</span>);
        break;
    }

    remaining = remaining.slice(best.index + best.match[0].length);
  }

  return <>{parts}</>;
}
