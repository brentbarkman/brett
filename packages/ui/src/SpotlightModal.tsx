import React, { useEffect, useRef, useCallback, useState } from "react";
import { Send, Square, X, Search, Plus, Check, Radar, MessageSquare } from "lucide-react";
import { BrettMark } from "./BrettMark";
import { SkillResultCard } from "./SkillResultCard";
import { SimpleMarkdown } from "./SimpleMarkdown";
import type { DisplayHint } from "@brett/types";

export interface SpotlightMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: unknown;
    displayHint?: DisplayHint;
  }>;
}

export interface SpotlightSearchResult {
  id: string;
  title: string;
  status: string;
  type?: string;
  contentType?: string | null;
  listName?: string | null;
}

export interface SpotlightModalProps {
  isOpen: boolean;
  input: string;
  onInputChange: (value: string) => void;
  messages: SpotlightMessage[];
  isStreaming: boolean;
  hasAI: boolean;
  onSend: (text: string, intent?: string) => void;
  onCreateTask: (title: string) => void;
  onSearch: (query: string) => void;
  onClose: () => void;
  onCancel?: () => void;
  onReset?: () => void;
  onNavigateToSettings?: () => void;
  searchResults?: SpotlightSearchResult[] | null;
  isSearching?: boolean;
  onSearchResultClick?: (id: string) => void;
  onItemClick?: (id: string) => void;
  onEventClick?: (eventId: string) => void;
  onNavigate?: (path: string) => void;
  sessionId?: string | null;
  showTokenUsage?: boolean;
  sessionUsage?: { totalTokens: number } | null;
  initialForcedAction?: "search" | "create" | null;
  showScoutAction?: boolean;
}

export function SpotlightModal({
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
  onCancel,
  onReset,
  onNavigateToSettings,
  searchResults,
  isSearching,
  onSearchResultClick,
  onItemClick,
  onEventClick,
  onNavigate,
  sessionId,
  showTokenUsage,
  sessionUsage,
  initialForcedAction,
  showScoutAction,
}: SpotlightModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [selectedSearchIdx, setSelectedSearchIdx] = useState(-1);
  const [forcedAction, setForcedAction] = useState<"search" | "create" | null>(null);
  const [confirmedTask, setConfirmedTask] = useState<string | null>(null);

  // Intercept input changes to detect shortcut prefixes
  const handleInputChange = useCallback((value: string) => {
    if (!forcedAction && value === "s ") {
      setForcedAction("search");
      onInputChange("");
      return;
    }
    if (!forcedAction && value === "t ") {
      setForcedAction("create");
      onInputChange("");
      return;
    }
    // Backspace to empty clears the forced mode
    if (forcedAction && value === "") {
      setForcedAction(null);
    }
    onInputChange(value);
  }, [forcedAction, onInputChange]);

  // Apply initial forced action when opening
  useEffect(() => {
    if (isOpen && initialForcedAction) {
      setForcedAction(initialForcedAction);
    }
    if (!isOpen) {
      setForcedAction(null);
    }
  }, [isOpen, initialForcedAction]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Auto-scroll chat
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [messages]);

  // Reset suggestion selection when input changes
  useEffect(() => {
    setSelectedSuggestion(0);
  }, [input]);

  useEffect(() => {
    setSelectedSearchIdx(-1);
  }, [searchResults]);

  // Auto-dismiss task confirmation
  useEffect(() => {
    if (!confirmedTask) return;
    const timer = setTimeout(() => {
      onClose();
    }, 2500);
    return () => clearTimeout(timer);
  }, [confirmedTask, onClose]);

  // Clear confirmedTask when modal closes
  useEffect(() => {
    if (!isOpen) {
      setConfirmedTask(null);
    }
  }, [isOpen]);

  const hasConversation = messages.length > 0;

  const showSuggestions = (input.trim().length > 0 || forcedAction !== null) && !hasConversation && !confirmedTask;
  const showSearchResults = !hasConversation && !showSuggestions && !confirmedTask && (isSearching || (searchResults !== null && searchResults !== undefined));
  const visibleResults = searchResults?.slice(0, 8) ?? [];

  type Suggestion = {
    id: string;
    label: string;
    icon: React.ReactNode;
    action: "ask" | "create" | "search" | "scout";
    shortcut?: string;
  };

  const suggestions: Suggestion[] = [];
  if (showSuggestions) {
    if (forcedAction === "search") {
      suggestions.push({
        id: "search",
        label: input.trim() ? `Search: "${input}"` : "Search...",
        icon: <Search size={14} className="text-white/60" />,
        action: "search",
      });
    } else if (forcedAction === "create") {
      suggestions.push({
        id: "create",
        label: input.trim() ? `Create task: "${input}"` : "Create task...",
        icon: <Plus size={14} className="text-white/60" />,
        action: "create",
      });
    } else {
      if (showScoutAction && hasAI) {
        suggestions.push({
          id: "scout",
          label: `Scout: "${input}"`,
          icon: <Radar size={14} className="text-brett-cerulean" />,
          action: "scout",
        });
      }
      if (hasAI) {
        suggestions.push({
          id: "ask",
          label: `Ask Brett: "${input}"`,
          icon: <MessageSquare size={14} className="text-white/60" />,
          action: "ask",
        });
      }
      suggestions.push({
        id: "create",
        label: `Create task: "${input}"`,
        icon: <Plus size={14} className="text-white/60" />,
        action: "create",
        shortcut: "t",
      });
      suggestions.push({
        id: "search",
        label: `Search: "${input}"`,
        icon: <Search size={14} className="text-white/60" />,
        action: "search",
        shortcut: "s",
      });
    }
  }

  const handleCreateTask = useCallback((title: string) => {
    onCreateTask(title);
    onInputChange("");
    setConfirmedTask(title);
  }, [onCreateTask, onInputChange]);

  const handleSuggestionSelect = useCallback(
    (suggestion: Suggestion) => {
      setForcedAction(null);
      if (suggestion.action === "ask") {
        onSend(input);
      } else if (suggestion.action === "scout") {
        onSend(input, "create_scout");
      } else if (suggestion.action === "create") {
        handleCreateTask(input);
      } else if (suggestion.action === "search") {
        onSearch(input);
      }
    },
    [input, onSend, handleCreateTask, onSearch]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setForcedAction(null);
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
          setSelectedSearchIdx((prev) => prev < visibleResults.length - 1 ? prev + 1 : 0);
          return;
        }
        if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
          e.preventDefault();
          setSelectedSearchIdx((prev) => prev > 0 ? prev - 1 : visibleResults.length - 1);
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
          setForcedAction(null);
          if (forcedAction === "search") {
            onSearch(input);
          } else if (forcedAction === "create") {
            handleCreateTask(input);
          } else if (hasAI) {
            onSend(input);
          } else {
            handleCreateTask(input);
          }
        }
      }
    },
    [showSuggestions, showSearchResults, suggestions, selectedSuggestion, handleSuggestionSelect, visibleResults, selectedSearchIdx, onSearchResultClick, input, forcedAction, hasAI, onSend, handleCreateTask, onSearch, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" data-spotlight-modal>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-2xl"
        onClick={() => !isStreaming && onClose()}
      />

      {/* Modal */}
      <div className="relative w-[640px] max-h-[70vh] bg-black/60 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Input Row */}
        <div className="flex items-center h-14 px-5 border-b border-white/10">
          <BrettMark
            size={20}
            className="flex-shrink-0"
            thinking={isStreaming}
          />
          {!hasConversation ? (
            <input
              ref={inputRef}
              type="text"
              placeholder={forcedAction === "search" ? "Search..." : forcedAction === "create" ? "New task..." : hasAI ? "Ask Brett anything..." : "Create a task or search..."}
              className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 px-3 text-sm"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              data-1p-ignore
              autoComplete="off"
            />
          ) : (
            <span className="flex-1 text-sm text-white/40 px-3">Chat with Brett</span>
          )}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isStreaming && onCancel ? (
              <button
                onClick={onCancel}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Stop generating"
              >
                <Square size={14} className="text-white/50" />
              </button>
            ) : hasConversation && onReset ? (
              <button
                onClick={onReset}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/40 hover:text-white/60"
                title="New conversation"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>

        {/* Suggestions */}
        {showSuggestions && (
          <div className="border-b border-white/10">
            {suggestions.map((suggestion, i) => (
              <button
                key={suggestion.id}
                className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm text-left transition-colors ${
                  i === selectedSuggestion
                    ? "bg-white/10 text-white"
                    : "text-white/70 hover:bg-white/5"
                }`}
                onClick={() => handleSuggestionSelect(suggestion)}
                onMouseEnter={() => setSelectedSuggestion(i)}
              >
                {suggestion.icon}
                <span className="truncate">{suggestion.label}</span>
                {suggestion.shortcut && (
                  <kbd className="ml-auto flex-shrink-0 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white/30">
                    {suggestion.shortcut}
                  </kbd>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Task Created — inline confirmation */}
        {confirmedTask && (
          <div className="border-b border-white/10">
            <div className="flex items-center gap-3 px-5 py-3 border-l-2 border-brett-teal/40 ml-4">
              <Check size={14} className="text-brett-teal flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-sm text-white/85 font-medium truncate">{confirmedTask}</div>
                <div className="text-[11px] text-white/40">Added to Inbox</div>
              </div>
            </div>
          </div>
        )}

        {/* Conversation */}
        {hasConversation && (
          <div ref={chatContainerRef} className="max-h-[45vh] overflow-y-auto scrollbar-hide p-5 space-y-4">
            {messages.map((msg, i) => (
              <SpotlightMessageBubble
                key={i}
                message={msg}
                isStreaming={
                  isStreaming &&
                  i === messages.length - 1 &&
                  msg.role === "assistant"
                }
                onItemClick={onItemClick}
                onEventClick={onEventClick}
                onNavigate={onNavigate}
              />
            ))}
            {/* scroll handled by chatContainerRef.scrollTop */}
          </div>
        )}

        {/* Token counter */}
        {showTokenUsage && sessionId && sessionUsage && hasConversation && (
          <div className="px-5 py-1 text-[10px] text-white/20 text-right">
            {sessionUsage.totalTokens.toLocaleString()} tokens
          </div>
        )}

        {/* Streaming indicator */}
        {hasConversation && isStreaming && (
          <div className="border-t border-white/10 px-5 py-3 flex items-center gap-2">
            <BrettMark size={20} className="flex-shrink-0" thinking />
            <span className="flex-1 text-sm text-white/30">Brett is thinking...</span>
            {onCancel && (
              <button
                onClick={onCancel}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                title="Stop"
              >
                <Square size={14} className="text-white/50" />
              </button>
            )}
          </div>
        )}

        {/* Follow-up input when conversation exists */}
        {hasConversation && !isStreaming && (
          <div className="border-t border-white/10 px-5 py-3 flex items-center gap-2">
            <input
              type="text"
              ref={inputRef}
              placeholder="Follow up..."
              className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              data-1p-ignore
              autoComplete="off"
            />
            <button
              onClick={() => input.trim() && onSend(input)}
              disabled={!input.trim()}
              className="p-2 rounded-lg bg-brett-gold text-white hover:bg-brett-gold-dark transition-colors disabled:opacity-30 disabled:hover:bg-brett-gold"
            >
              <Send size={14} />
            </button>
          </div>
        )}

        {/* Search Results */}
        {showSearchResults && (
          <div className="border-b border-white/10">
            {isSearching ? (
              <div className="px-5 py-3 text-sm text-white/40 flex items-center gap-2">
                <div className="w-3 h-3 border border-white/30 border-t-white/80 rounded-full animate-spin" />
                Searching...
              </div>
            ) : visibleResults.length === 0 ? (
              <div className="px-5 py-3 text-sm text-white/40">No results found.</div>
            ) : (
              <>
                <div className="px-5 py-2 text-[10px] uppercase tracking-[0.15em] font-semibold text-white/30 border-b border-white/5">
                  {searchResults!.length} result{searchResults!.length === 1 ? "" : "s"}
                </div>
                {visibleResults.map((item, i) => (
                  <button
                    key={item.id}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm text-left transition-colors ${
                      i === selectedSearchIdx ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/5"
                    }`}
                    onClick={() => onSearchResultClick?.(item.id)}
                    onMouseEnter={() => setSelectedSearchIdx(i)}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      item.status === "done" ? "bg-brett-teal" : item.status === "active" ? "bg-brett-cerulean" : "bg-white/30"
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

        {/* Empty state */}
        {!hasConversation && !showSuggestions && !showSearchResults && !confirmedTask && (
          <div className="px-5 py-6">
            {!hasAI ? (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-brett-cerulean/5 border border-brett-cerulean/10">
                <BrettMark size={16} className="flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm text-white/70">
                    Add an AI provider to unlock Brett's full capabilities — ask questions, get briefings, and manage everything with natural language.
                  </p>
                  {onNavigateToSettings && (
                    <button
                      onClick={() => { onNavigateToSettings(); onClose(); }}
                      className="mt-2 text-xs text-brett-cerulean hover:text-brett-cerulean/80 transition-colors"
                    >
                      Configure AI in Settings →
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-white/30 text-center">
                Ask a question, add a task, search your stuff, or start scouting something new.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Message bubble for Spotlight ───

function SpotlightMessageBubble({
  message,
  isStreaming,
  onItemClick,
  onEventClick,
  onNavigate,
}: {
  message: SpotlightMessage;
  isStreaming: boolean;
  onItemClick?: (id: string) => void;
  onEventClick?: (eventId: string) => void;
  onNavigate?: (path: string) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="text-sm text-white/90 bg-white/5 px-3 py-2 rounded-lg max-w-[85%]">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 space-y-2 bg-white/5 rounded-lg px-3.5 py-3 border border-white/10">
      {/* Text content — suppressed when a confirmation card exists (the card IS the response) */}
      {(() => {
        const hasConfirmation = message.toolCalls?.some((tc) => tc.displayHint?.type === "confirmation" || tc.displayHint?.type === "task_created");
        if (!hasConfirmation && (message.content || isStreaming)) {
          return (
            <div className="text-sm text-white/90 leading-relaxed">
              <SimpleMarkdown content={message.content} onItemClick={onItemClick} onEventClick={onEventClick} onNavigate={onNavigate} />
              {isStreaming && (
                <span className="inline-block w-1.5 h-4 bg-amber-400 ml-0.5 animate-pulse rounded-sm align-text-bottom" />
              )}
            </div>
          );
        }
        if (isStreaming && !message.toolCalls?.length) {
          return (
            <div className="text-sm text-white/90 leading-relaxed">
              <SimpleMarkdown content={message.content} onItemClick={onItemClick} onEventClick={onEventClick} onNavigate={onNavigate} />
              <span className="inline-block w-1.5 h-4 bg-amber-400 ml-0.5 animate-pulse rounded-sm align-text-bottom" />
            </div>
          );
        }
        return null;
      })()}

      {/* Skill result cards */}
      {message.toolCalls
        ?.filter((tc) => tc.displayHint)
        .map((tc, i) => (
          <SkillResultCard
            key={i}
            displayHint={tc.displayHint!}
            data={tc.result}
            message={
              typeof tc.result === "object" &&
              tc.result &&
              "message" in (tc.result as Record<string, unknown>)
                ? String(
                    (tc.result as Record<string, unknown>).message
                  )
                : undefined
            }
            onItemClick={onItemClick}
            onEventClick={onEventClick}
            onNavigate={onNavigate}
          />
        ))}
    </div>
  );
}
