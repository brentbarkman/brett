import React, { useEffect, useState, useRef, useCallback } from "react";
import { Bot, Send, Search, Plus, Sparkles, X, Square } from "lucide-react";
import { useClickOutside } from "./useClickOutside";
import { SkillResultCard } from "./SkillResultCard";
import type { DisplayHint } from "@brett/types";

export interface OmnibarMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    displayHint?: DisplayHint;
  }>;
}

export interface SearchResultItem {
  id: string;
  title: string;
  status: string;
  type?: string;
  contentType?: string | null;
  listName?: string | null;
}

export interface OmnibarProps {
  isOpen: boolean;
  input: string;
  onInputChange: (value: string) => void;
  messages: OmnibarMessage[];
  isStreaming: boolean;
  hasAI: boolean;
  onSend: (text: string) => void;
  onCreateTask: (title: string) => void;
  onSearch: (query: string) => void;
  onClose: () => void;
  onOpen: () => void;
  onCancel?: () => void;
  onReset?: () => void;
  onNavigateToSettings?: () => void;
  searchResults?: SearchResultItem[] | null;
  isSearching?: boolean;
  onSearchResultClick?: (id: string) => void;
}

type Suggestion = {
  id: string;
  label: string;
  icon: React.ReactNode;
  action: "ask" | "create" | "search";
};

export function Omnibar({
  isOpen,
  input,
  onInputChange,
  messages,
  isStreaming,
  hasAI,
  onSend,
  onCreateTask,
  onSearch,
  onClose,
  onOpen,
  onCancel,
  onReset,
  onNavigateToSettings,
  searchResults,
  isSearching,
  onSearchResultClick,
}: OmnibarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // chatEndRef removed — use chatContainerRef.scrollTop instead to avoid page jumping
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [selectedSearchIdx, setSelectedSearchIdx] = useState(-1);

  useClickOutside(containerRef, () => {
    if (isOpen && !isStreaming) onClose();
  }, isOpen);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Auto-scroll chat container to bottom (not the page)
  const chatContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Reset suggestion selection when input changes
  useEffect(() => {
    setSelectedSuggestion(0);
  }, [input]);

  // Reset search result selection when results change
  useEffect(() => {
    setSelectedSearchIdx(-1);
  }, [searchResults]);

  const hasConversation = messages.length > 0;
  const showSuggestions = isOpen && input.trim().length > 0 && !hasConversation;
  const showSearchResults = isOpen && !hasConversation && !showSuggestions && (isSearching || (searchResults !== null && searchResults !== undefined));
  const visibleResults = searchResults?.slice(0, 8) ?? [];

  // Build suggestions
  const suggestions: Suggestion[] = [];
  if (showSuggestions) {
    if (hasAI) {
      suggestions.push({
        id: "ask",
        label: `Ask Brett: "${input}"`,
        icon: <Sparkles size={14} className="text-blue-400" />,
        action: "ask",
      });
    }
    suggestions.push({
      id: "create",
      label: `Create task: "${input}"`,
      icon: <Plus size={14} className="text-white/60" />,
      action: "create",
    });
    suggestions.push({
      id: "search",
      label: `Search: "${input}"`,
      icon: <Search size={14} className="text-white/60" />,
      action: "search",
    });
  }

  const handleSuggestionSelect = useCallback(
    (suggestion: Suggestion) => {
      if (suggestion.action === "ask") {
        onSend(input);
      } else if (suggestion.action === "create") {
        onCreateTask(input);
      } else if (suggestion.action === "search") {
        onSearch(input);
      }
    },
    [input, onSend, onCreateTask, onSearch]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (showSuggestions) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedSuggestion((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedSuggestion((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
          return;
        }
        if (e.key === "Enter" && suggestions[selectedSuggestion]) {
          e.preventDefault();
          handleSuggestionSelect(suggestions[selectedSuggestion]);
          return;
        }
      }

      // Keyboard nav for search results
      if (showSearchResults && visibleResults.length > 0) {
        if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
          e.preventDefault();
          setSelectedSearchIdx((prev) =>
            prev < visibleResults.length - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
          e.preventDefault();
          setSelectedSearchIdx((prev) =>
            prev > 0 ? prev - 1 : visibleResults.length - 1
          );
          return;
        }
        if (e.key === "Enter" && selectedSearchIdx >= 0 && visibleResults[selectedSearchIdx]) {
          e.preventDefault();
          onSearchResultClick?.(visibleResults[selectedSearchIdx].id);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (input.trim()) {
          if (hasAI) {
            onSend(input);
          } else {
            // No AI: default Enter creates a task
            onCreateTask(input);
          }
        }
      }
    },
    [showSuggestions, showSearchResults, suggestions, selectedSuggestion, handleSuggestionSelect, visibleResults, selectedSearchIdx, onSearchResultClick, input, hasAI, onSend, onCreateTask, onClose]
  );

  return (
    <div ref={containerRef} className="relative w-full" {...(isOpen ? { "data-omnibar-open": true } : {})}>
      {/* Top Pill / Input Area */}
      <div
        className={`
          relative bg-black/40 backdrop-blur-xl border rounded-2xl transition-all duration-300 ease-in-out
          ${isOpen ? "border-blue-500/50 shadow-[0_0_20px_rgba(59,130,246,0.15)]" : "border-white/10 hover:border-white/20"}
          ${hasConversation && isOpen ? "rounded-b-2xl" : ""}
        `}
      >
        {/* Top Bar — shows input when no conversation, just header when conversation active */}
        <div
          className="flex items-center h-12 px-4 cursor-text"
          onClick={() => !isOpen && onOpen()}
        >
          <Bot
            size={18}
            className={`flex-shrink-0 transition-colors ${
              isOpen || isStreaming ? "text-blue-400" : "text-white/40"
            }`}
          />
          {/* Show input in top bar only when there's no conversation yet */}
          {!hasConversation ? (
            <input
              ref={inputRef}
              type="text"
              placeholder={hasAI ? "Ask Brett anything..." : "Create a task or search..."}
              className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 px-3 text-sm"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onFocus={() => !isOpen && onOpen()}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
            />
          ) : (
            <span className="flex-1 text-sm text-white/40 px-3">Chat with Brett</span>
          )}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isStreaming && onCancel ? (
              <button
                onClick={onCancel}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Stop generating"
              >
                <Square size={14} className="text-white/50" />
              </button>
            ) : isOpen && hasConversation ? (
              <button
                onClick={onReset}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/40 hover:text-white/60"
                title="New conversation"
              >
                <X size={14} />
              </button>
            ) : !isOpen ? (
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white/30 font-mono">
                <span>&#8984;</span>K
              </kbd>
            ) : null}
          </div>
        </div>

        {/* AI Upsell — shown when open, no input, no AI configured */}
        {isOpen && !hasAI && !input.trim() && !hasConversation && !showSearchResults && (
          <div className="border-t border-white/10 px-4 py-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
              <Sparkles size={16} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm text-white/70">
                  Add an AI provider to unlock Brett's full capabilities — ask questions, get briefings, and manage everything with natural language.
                </p>
                {onNavigateToSettings && (
                  <button
                    onClick={() => { onNavigateToSettings(); onClose(); }}
                    className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    Configure AI in Settings →
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Conversation Area */}
        {isOpen && hasConversation && (
          <div className="border-t border-white/10">
            <div ref={chatContainerRef} className="max-h-[350px] overflow-y-auto scrollbar-hide p-4 space-y-4">
              {messages.map((msg, i) => (
                <MessageBubble
                  key={i}
                  message={msg}
                  isLast={i === messages.length - 1}
                  isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
                />
              ))}
              {/* scroll anchor handled by chatContainerRef.scrollTop */}
            </div>

            {/* Follow-up Input — this is the only input when conversation is active */}
            {!isStreaming && (
              <div className="border-t border-white/10 px-4 py-3 flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Follow up..."
                  className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
                  value={input}
                  onChange={(e) => onInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus
                />
                <button
                  onClick={() => input.trim() && onSend(input)}
                  disabled={!input.trim()}
                  className="p-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors disabled:opacity-30 disabled:hover:bg-blue-500"
                >
                  <Send size={14} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Suggestions Dropdown */}
      {showSuggestions && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-black/60 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden shadow-xl">
          {suggestions.map((suggestion, i) => (
            <button
              key={suggestion.id}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                i === selectedSuggestion
                  ? "bg-white/10 text-white"
                  : "text-white/70 hover:bg-white/5"
              }`}
              onClick={() => handleSuggestionSelect(suggestion)}
              onMouseEnter={() => setSelectedSuggestion(i)}
            >
              {suggestion.icon}
              <span className="truncate">{suggestion.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search Results Dropdown */}
      {showSearchResults && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-black/60 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden shadow-xl">
          {isSearching ? (
            <div className="px-4 py-3 text-sm text-white/40 flex items-center gap-2">
              <div className="w-3 h-3 border border-white/30 border-t-white/80 rounded-full animate-spin" />
              Searching...
            </div>
          ) : visibleResults.length === 0 ? (
            <div className="px-4 py-3 text-sm text-white/40">
              No results found.
            </div>
          ) : (
            <>
              <div className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-white/30 border-b border-white/5">
                {searchResults!.length} result{searchResults!.length === 1 ? "" : "s"}
              </div>
              {visibleResults.map((item, i) => (
                <button
                  key={item.id}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                    i === selectedSearchIdx
                      ? "bg-white/10 text-white"
                      : "text-white/80 hover:bg-white/5"
                  }`}
                  onClick={() => onSearchResultClick?.(item.id)}
                  onMouseEnter={() => setSelectedSearchIdx(i)}
                >
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    item.status === "done" ? "bg-green-400" : item.status === "active" ? "bg-blue-400" : "bg-white/30"
                  }`} />
                  <span className="text-[10px] text-white/30 uppercase flex-shrink-0">
                    {item.type === "content" ? (item.contentType || "content") : "task"}
                  </span>
                  <span className="truncate">{item.title}</span>
                  <span className="ml-auto text-[10px] text-white/30 flex-shrink-0">
                    {item.listName || "Inbox"}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── MessageBubble sub-component ───

function MessageBubble({
  message,
  isLast,
  isStreaming,
}: {
  message: OmnibarMessage;
  isLast: boolean;
  isStreaming: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="flex gap-3 flex-row-reverse">
        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
          <span className="text-[10px] text-white/70">ME</span>
        </div>
        <div>
          <p className="text-sm text-white/90 bg-white/5 px-3 py-2 rounded-lg rounded-tr-none">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Bot size={12} className="text-blue-400" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {/* Text content */}
        {(message.content || isStreaming) && (
          <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">
            {message.content}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse rounded-sm align-text-bottom" />
            )}
          </p>
        )}

        {/* Skill result cards */}
        {message.toolCalls
          ?.filter((tc) => tc.displayHint)
          .map((tc, i) => (
            <SkillResultCard
              key={i}
              displayHint={tc.displayHint!}
              data={tc.result}
              message={typeof tc.result === "object" && tc.result && "message" in (tc.result as Record<string, unknown>) ? String((tc.result as Record<string, unknown>).message) : undefined}
            />
          ))}
      </div>
    </div>
  );
}
