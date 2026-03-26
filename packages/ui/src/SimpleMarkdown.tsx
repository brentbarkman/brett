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
}

// Pattern for inline item references: [title](brett-item:id)
const ITEM_REF_PATTERN = /\[([^\]]+)\]\(brett-item:([a-z0-9]+)\)/g;

export function SimpleMarkdown({ content, className, onItemClick }: SimpleMarkdownProps) {
  if (!content) return null;

  // Split into lines, render each line with inline formatting
  const lines = content.split("\n");

  return (
    <div className={className}>
      {lines.map((line, lineIdx) => {
        const trimmed = line.trim();

        // Empty line = paragraph break
        if (!trimmed) {
          return <div key={lineIdx} className="h-2" />;
        }

        // Bullet point
        if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
          return (
            <div key={lineIdx} className="flex gap-2 pl-1">
              <span className="text-white/40 select-none">•</span>
              <span>{renderInline(trimmed.slice(2), onItemClick)}</span>
            </div>
          );
        }

        // Numbered list
        const numMatch = trimmed.match(/^(\d+)\.\s/);
        if (numMatch) {
          return (
            <div key={lineIdx} className="flex gap-2 pl-1">
              <span className="text-white/40 select-none min-w-[1rem] text-right">{numMatch[1]}.</span>
              <span>{renderInline(trimmed.slice(numMatch[0].length), onItemClick)}</span>
            </div>
          );
        }

        // Regular line
        return <div key={lineIdx}>{renderInline(trimmed, onItemClick)}</div>;
      })}
    </div>
  );
}

function renderInline(
  text: string,
  onItemClick?: (id: string) => void,
): React.ReactNode {
  // Process inline patterns: **bold**, *italic*, `code`, [text](brett-item:id), [text](url)
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Find the earliest match among all patterns
    let earliestIdx = remaining.length;
    let match: { type: string; fullMatch: string; content: string; extra?: string; index: number } | null = null;

    // **bold**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    if (boldMatch && boldMatch.index !== undefined && boldMatch.index < earliestIdx) {
      earliestIdx = boldMatch.index;
      match = { type: "bold", fullMatch: boldMatch[0], content: boldMatch[1], index: boldMatch.index };
    }

    // *italic* (but not **)
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    if (italicMatch && italicMatch.index !== undefined && italicMatch.index < earliestIdx) {
      earliestIdx = italicMatch.index;
      match = { type: "italic", fullMatch: italicMatch[0], content: italicMatch[1], index: italicMatch.index };
    }

    // `code`
    const codeMatch = remaining.match(/`([^`]+)`/);
    if (codeMatch && codeMatch.index !== undefined && codeMatch.index < earliestIdx) {
      earliestIdx = codeMatch.index;
      match = { type: "code", fullMatch: codeMatch[0], content: codeMatch[1], index: codeMatch.index };
    }

    // [text](brett-item:id) — clickable item reference
    const itemMatch = remaining.match(/\[([^\]]+)\]\(brett-item:([a-z0-9]+)\)/);
    if (itemMatch && itemMatch.index !== undefined && itemMatch.index < earliestIdx) {
      earliestIdx = itemMatch.index;
      match = { type: "item-ref", fullMatch: itemMatch[0], content: itemMatch[1], extra: itemMatch[2], index: itemMatch.index };
    }

    if (!match) {
      // No more patterns — push the rest as plain text
      parts.push(remaining);
      break;
    }

    // Push text before the match
    if (match.index > 0) {
      parts.push(remaining.slice(0, match.index));
    }

    // Push the formatted element
    switch (match.type) {
      case "bold":
        parts.push(<strong key={key++} className="font-semibold text-white">{match.content}</strong>);
        break;
      case "italic":
        parts.push(<em key={key++} className="italic text-white/80">{match.content}</em>);
        break;
      case "code":
        parts.push(
          <code key={key++} className="px-1 py-0.5 rounded bg-white/10 text-white/90 text-xs font-mono">
            {match.content}
          </code>
        );
        break;
      case "item-ref":
        parts.push(
          onItemClick ? (
            <button
              key={key++}
              className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
              onClick={() => onItemClick(match!.extra!)}
            >
              {match.content}
            </button>
          ) : (
            <span key={key++} className="text-blue-400">{match.content}</span>
          )
        );
        break;
    }

    remaining = remaining.slice(match.index + match.fullMatch.length);
  }

  return <>{parts}</>;
}
