import React, { useState, useRef, useCallback, useEffect } from "react";
import { ChevronDown, ChevronUp, Bot, Send, Loader2 } from "lucide-react";
import type { DisplayHint } from "@brett/types";
import { SkillResultCard } from "./SkillResultCard";
import { SimpleMarkdown } from "./SimpleMarkdown";

export interface BrettThreadMessage {
  id: string;
  role: "user" | "assistant" | "brett";
  content: string;
  createdAt: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    displayHint?: DisplayHint;
  }>;
}

interface BrettThreadProps {
  messages: BrettThreadMessage[];
  totalCount?: number;
  hasMore: boolean;
  onSend: (content: string) => void;
  onLoadMore: () => void;
  isSending?: boolean;
  isStreaming?: boolean;
  isLoadingMore?: boolean;
  onItemClick?: (id: string) => void;
  onEventClick?: (eventId: string) => void;
  onNavigate?: (path: string) => void;
  aiConfigured?: boolean;
  onOpenSettings?: () => void;
}

function MessageBubble({
  message,
  isStreamingMsg,
  onItemClick,
  onEventClick,
  onNavigate,
}: {
  message: BrettThreadMessage;
  isStreamingMsg?: boolean;
  onItemClick?: (id: string) => void;
  onEventClick?: (eventId: string) => void;
  onNavigate?: (path: string) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end py-1.5">
        <p className="text-sm text-white/90 bg-white/5 px-3 py-2 rounded-lg max-w-[85%]">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className="py-1.5 space-y-1.5">
      {/* Tool result cards */}
      {message.toolCalls?.map((tc, i) =>
        tc.result != null && tc.displayHint ? (
          <SkillResultCard
            key={`tc-${i}`}
            displayHint={tc.displayHint}
            data={tc.result}
            message={tc.name}
          />
        ) : tc.result == null && !isStreamingMsg ? null : tc.result == null ? (
          <div
            key={`tc-pending-${i}`}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10"
          >
            <Loader2 size={12} className="animate-spin text-white/30" />
            <span className="text-xs text-white/40">{tc.name}...</span>
          </div>
        ) : null,
      )}

      {/* Text content */}
      {message.content && (
        <div className="text-sm leading-relaxed break-words bg-white/5 rounded-lg px-3.5 py-3 border border-white/10 text-white/90">
          <SimpleMarkdown
            content={message.content}
            onItemClick={onItemClick}
            onEventClick={onEventClick}
            onNavigate={onNavigate}
          />
          {isStreamingMsg && (
            <span className="inline-block w-1.5 h-4 bg-amber-400 ml-0.5 animate-pulse rounded-sm align-text-bottom" />
          )}
        </div>
      )}

      {/* Streaming cursor when no content yet */}
      {!message.content && isStreamingMsg && !message.toolCalls?.length && (
        <div className="flex items-center gap-1 py-1">
          <Loader2 size={12} className="animate-spin text-blue-400/60" />
          <span className="text-xs text-white/30">Brett is thinking...</span>
        </div>
      )}
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
  isStreaming,
  isLoadingMore,
  onItemClick,
  onEventClick,
  onNavigate,
  aiConfigured,
  onOpenSettings,
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

  // Also scroll to bottom during streaming as content grows
  useEffect(() => {
    if (isStreaming && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

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
    if (!trimmed || isSending || isStreaming) return;
    onSend(trimmed);
    setInputValue("");
    setIsExpanded(true);
  }, [inputValue, isSending, isStreaming, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Determine if the last assistant message is actively streaming
  const lastMsg = displayMessages[displayMessages.length - 1];
  const lastIsStreaming =
    isStreaming && lastMsg && lastMsg.role !== "user";

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
            Brett
            {(totalCount ?? messages.length) > 0
              ? ` (${totalCount ?? messages.length})`
              : ""}
          </span>
          {isStreaming && (
            <Loader2 size={10} className="animate-spin text-blue-400/60" />
          )}
        </div>
        {isExpanded ? (
          <ChevronDown size={14} className="text-white/40" />
        ) : (
          <ChevronUp size={14} className="text-white/40" />
        )}
      </button>

      {/* Expanded message history */}
      {isExpanded && displayMessages.length > 0 && (
        <div
          ref={scrollRef}
          className="max-h-96 overflow-y-auto px-4 scrollbar-hide overscroll-contain"
        >
          {/* Sentinel + loading indicator at top */}
          <div ref={sentinelRef} className="h-1" />
          {isLoadingMore && (
            <div className="flex justify-center py-2">
              <Loader2 size={14} className="animate-spin text-white/30" />
            </div>
          )}
          {displayMessages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreamingMsg={
                lastIsStreaming && idx === displayMessages.length - 1
              }
              onItemClick={onItemClick}
              onEventClick={onEventClick}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}

      {/* AI not configured message */}
      {aiConfigured === false && (
        <div className="px-4 pb-2">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
            <p className="text-xs text-amber-300/80">
              Brett needs an AI provider to work his magic. Set one up in{" "}
              <button
                onClick={onOpenSettings}
                className="text-amber-300 underline underline-offset-2 hover:text-amber-200 transition-colors"
              >
                Settings
              </button>
              .
            </p>
          </div>
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
            placeholder={aiConfigured === false ? "Brett needs an AI provider..." : "Ask Brett anything..."}
            rows={1}
            disabled={aiConfigured === false}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 resize-none focus:border-blue-500/20 min-h-[36px] max-h-[100px] disabled:opacity-40 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending || isStreaming || aiConfigured === false}
            className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
