import React, { useEffect, useRef, useCallback } from "react";
import { Bot, Send, Square, X, Sparkles, Search, Plus } from "lucide-react";
import { SkillResultCard } from "./SkillResultCard";
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

export interface SpotlightModalProps {
  isOpen: boolean;
  input: string;
  onInputChange: (value: string) => void;
  messages: SpotlightMessage[];
  isStreaming: boolean;
  hasAI: boolean;
  onSend: (text: string) => void;
  onCreateTask: (title: string) => void;
  onSearch: (query: string) => void;
  onClose: () => void;
  onCancel?: () => void;
  onReset?: () => void;
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
}: SpotlightModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [selectedSuggestion, setSelectedSuggestion] = React.useState(0);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset suggestion selection when input changes
  useEffect(() => {
    setSelectedSuggestion(0);
  }, [input]);

  const hasConversation = messages.length > 0;
  const showSuggestions = input.trim().length > 0 && !hasConversation;

  type Suggestion = {
    id: string;
    label: string;
    icon: React.ReactNode;
    action: "ask" | "create" | "search";
  };

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

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (input.trim()) {
          if (hasAI) {
            onSend(input);
          } else {
            onCreateTask(input);
          }
        }
      }
    },
    [showSuggestions, suggestions, selectedSuggestion, handleSuggestionSelect, input, hasAI, onSend, onCreateTask, onClose]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !isStreaming && onClose()}
      />

      {/* Modal */}
      <div className="relative w-[520px] max-h-[70vh] bg-black/70 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Input Row */}
        <div className="flex items-center h-14 px-5 border-b border-white/10">
          <Bot
            size={20}
            className={`flex-shrink-0 ${
              isStreaming ? "text-blue-400 animate-pulse" : "text-blue-400"
            }`}
          />
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask Brett anything..."
            className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 px-3 text-sm"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
          />
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
            <kbd className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-white/30 font-mono">
              ESC
            </kbd>
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
                {i === 0 && (
                  <span className="ml-auto text-[10px] text-white/30 font-mono flex-shrink-0">
                    ENTER
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Conversation */}
        {hasConversation && (
          <div className="max-h-[45vh] overflow-y-auto scrollbar-hide p-5 space-y-4">
            {messages.map((msg, i) => (
              <SpotlightMessageBubble
                key={i}
                message={msg}
                isStreaming={
                  isStreaming &&
                  i === messages.length - 1 &&
                  msg.role === "assistant"
                }
              />
            ))}
            <div ref={chatEndRef} />
          </div>
        )}

        {/* Follow-up input when conversation exists */}
        {hasConversation && !isStreaming && (
          <div className="border-t border-white/10 px-5 py-3 flex items-center gap-2">
            <input
              type="text"
              placeholder="Follow up..."
              className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
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

        {/* Empty state hint */}
        {!hasConversation && !showSuggestions && (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-white/30">
              {hasAI
                ? "Ask a question, create a task, or search..."
                : "Create a task or search your items..."}
            </p>
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
}: {
  message: SpotlightMessage;
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
        {(message.content || isStreaming) && (
          <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">
            {message.content}
            {isStreaming && (
              <span className="inline-block w-1.5 h-4 bg-blue-400 ml-0.5 animate-pulse rounded-sm align-text-bottom" />
            )}
          </p>
        )}

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
            />
          ))}
      </div>
    </div>
  );
}
