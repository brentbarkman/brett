import React, { useState, useRef, useCallback, useEffect } from "react";
import { ChevronDown, ChevronUp, User, Bot, Send, Loader2 } from "lucide-react";
import type { BrettMessage } from "@brett/types";

interface BrettThreadProps {
  messages: BrettMessage[];
  totalCount?: number;
  hasMore: boolean;
  onSend: (content: string) => void;
  onLoadMore: () => void;
  isSending?: boolean;
  isLoadingMore?: boolean;
}

function MessageBubble({ message }: { message: BrettMessage }) {
  const isUser = message.role === "user";
  return (
    <div className="flex items-start gap-2 py-2">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser ? "bg-white/10" : "bg-blue-500/20"
        }`}
      >
        {isUser ? (
          <User size={12} className="text-white/60" />
        ) : (
          <Bot size={12} className="text-blue-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </p>
        <span className="text-[10px] text-white/30 mt-0.5 block">
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}

export function BrettThread({
  messages,
  totalCount,
  hasMore,
  onSend,
  onLoadMore,
  isSending,
  isLoadingMore,
}: BrettThreadProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // API returns newest first; reverse for display (oldest at top, newest at bottom)
  const displayMessages = [...messages].reverse();

  // Scroll to bottom when expanded or when new messages arrive
  useEffect(() => {
    if (isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isExpanded, messages.length]);

  // Infinite scroll: load more when sentinel at top becomes visible
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollRef.current;
    if (!sentinel || !container || !isExpanded || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          // Save scroll position so we can restore after load
          const prevHeight = container.scrollHeight;
          const prevTop = container.scrollTop;

          onLoadMore();

          // After DOM updates, restore scroll so content doesn't jump
          requestAnimationFrame(() => {
            const newHeight = container.scrollHeight;
            container.scrollTop = prevTop + (newHeight - prevHeight);
          });
        }
      },
      { root: container, threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isExpanded, hasMore, isLoadingMore, onLoadMore]);

  const handleSend = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isSending) return;
    onSend(trimmed);
    setInputValue("");
    setIsExpanded(true);
  }, [inputValue, isSending, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="border-t border-white/10 flex flex-col">
      {/* Toggle header */}
      <button
        onClick={() => setIsExpanded((prev) => !prev)}
        className="flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-blue-400" />
          <span className="text-xs font-medium text-white/60">
            Brett Thread{(totalCount ?? messages.length) > 0 ? ` (${totalCount ?? messages.length})` : ""}
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown size={14} className="text-white/40" />
        ) : (
          <ChevronUp size={14} className="text-white/40" />
        )}
      </button>

      {/* Expanded message history */}
      {isExpanded && displayMessages.length > 0 && (
        <div ref={scrollRef} className="max-h-64 overflow-y-auto px-4 scrollbar-hide overscroll-contain">
          {/* Sentinel + loading indicator at top */}
          <div ref={sentinelRef} className="h-1" />
          {isLoadingMore && (
            <div className="flex justify-center py-2">
              <Loader2 size={14} className="animate-spin text-white/30" />
            </div>
          )}
          {displayMessages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="relative px-4 pb-3 pt-1">
        <div className="absolute inset-x-0 -top-4 h-4 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Brett&hellip;"
            rows={1}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 resize-none focus:border-blue-500/20 min-h-[36px] max-h-[100px]"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending}
            className="p-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
