import React, { useState, useRef } from "react";
import { CheckCircle, Plus, Zap, BookOpen, Link } from "lucide-react";
import { ProductMark } from "./BrettMark";
import type { NavList } from "@brett/types";

interface ThingsEmptyStateProps {
  /** "all" | "task" | "content" — which filter is active */
  activeFilter: string;
  /** True if the user has created things (they just don't match the current view) */
  hasThingsElsewhere: boolean;
  /** True if there are things but they're all completed */
  allCompleted: boolean;
  /** When true, renders without the outer card wrapper (for embedding inside another card) */
  inline?: boolean;
  lists: NavList[];
  onAddTask: (title: string, listId: string | null) => void;
  onAddContent: (url: string, title: string, listId: string | null) => void;
}

export function ThingsEmptyState({
  activeFilter,
  hasThingsElsewhere,
  allCompleted,
  inline,
  lists,
  onAddTask,
  onAddContent,
}: ThingsEmptyStateProps) {
  // All things completed — congrats + what's next
  if (allCompleted) {
    const content = (
      <div className="flex flex-col items-center text-center gap-4">
        <div className="w-12 h-12 rounded-full bg-brett-teal/10 border border-brett-teal/20 flex items-center justify-center">
          <CheckCircle size={22} className="text-brett-teal" />
        </div>
        <div>
          <h3 className="text-white font-semibold text-base mb-1">
            Cleared.
          </h3>
          <p className="text-white/40 text-sm leading-relaxed max-w-sm">
            Nothing left. Go build something or enjoy the quiet.
          </p>
        </div>
        <InlineTaskAdd lists={lists} onAdd={onAddTask} placeholder="What's next?" />
      </div>
    );
    if (inline) return content;
    return (
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8">
        {content}
      </div>
    );
  }

  // Has things but none match the current filter
  if (hasThingsElsewhere) {
    const isContentFilter = activeFilter === "Content";
    return (
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8">
        <div className="flex flex-col items-center text-center gap-4">
          <div className="w-10 h-10 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
            {isContentFilter
              ? <BookOpen size={18} className="text-amber-400" />
              : <Zap size={18} className="text-brett-gold" />
            }
          </div>
          <div>
            <h3 className="text-white font-semibold text-base mb-1">
              {isContentFilter ? "No content saved" : "No tasks yet"}
            </h3>
            <p className="text-white/40 text-sm leading-relaxed max-w-sm">
              {isContentFilter
                ? "Paste a link to save something worth reading later."
                : "Add one, or switch to All to see everything."
              }
            </p>
          </div>
          {isContentFilter
            ? <InlineContentAdd lists={lists} onAdd={onAddContent} />
            : <InlineTaskAdd lists={lists} onAdd={onAddTask} placeholder="Add a task..." />
          }
        </div>
      </div>
    );
  }

  // Brand new user — no things ever created
  return (
    <div className="flex flex-col items-center text-center gap-5 py-6">
      <ProductMark size={36} className="drop-shadow-[0_0_12px_rgba(232,185,49,0.3)]" />
      <div>
        <h3 className="text-white/90 font-semibold text-base mb-1.5">
          Your inbox
        </h3>
        <p className="text-white/40 text-sm leading-relaxed max-w-xs">
          Everything worth doing starts here.
        </p>
      </div>
      <InlineTaskAdd lists={lists} onAdd={onAddTask} placeholder="Add a task or paste a link..." />
    </div>
  );
}

function InlineTaskAdd({
  lists,
  onAdd,
  placeholder,
}: {
  lists: NavList[];
  onAdd: (title: string, listId: string | null) => void;
  placeholder: string;
}) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    if (!title.trim()) return;
    onAdd(title.trim(), lists[0]?.id ?? null);
    setTitle("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2 mt-1">
      <Plus size={14} className="text-white/30 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        placeholder={placeholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
      />
      <button
        onClick={handleSubmit}
        disabled={!title.trim()}
        className="px-2.5 py-0.5 rounded-md bg-brett-gold text-white text-xs font-medium hover:bg-brett-gold-dark disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
      >
        Add
      </button>
    </div>
  );
}

function isValidUrl(str: string): boolean {
  // Accept URLs with or without protocol
  const withProtocol = str.match(/^https?:\/\//) ? str : `https://${str}`;
  try {
    const url = new URL(withProtocol);
    // Must have a dot in the hostname (no bare "localhost" etc)
    return url.hostname.includes(".");
  } catch {
    return false;
  }
}

function extractDomain(url: string): string {
  const withProtocol = url.match(/^https?:\/\//) ? url : `https://${url}`;
  try {
    return new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function InlineContentAdd({
  lists,
  onAdd,
}: {
  lists: NavList[];
  onAdd: (url: string, title: string, listId: string | null) => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!isValidUrl(trimmed)) {
      setError("Enter a valid URL");
      return;
    }
    setError("");
    const fullUrl = trimmed.match(/^https?:\/\//) ? trimmed : `https://${trimmed}`;
    const title = extractDomain(trimmed);
    onAdd(fullUrl, title, lists[0]?.id ?? null);
    setUrl("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="w-full max-w-md mt-1">
      <div className={`flex items-center gap-2 bg-white/5 border rounded-lg px-3 py-2 ${error ? "border-red-500/40" : "border-white/10"}`}>
        <Link size={14} className="text-white/30 flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Paste a link..."
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(""); }}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
        />
        <button
          onClick={handleSubmit}
          disabled={!url.trim()}
          className="px-2.5 py-0.5 rounded-md bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          Save
        </button>
      </div>
      {error && (
        <p className="text-red-400 text-xs mt-1.5 ml-1">{error}</p>
      )}
    </div>
  );
}
