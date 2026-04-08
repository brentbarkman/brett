import React, { useState, useRef, useEffect } from "react";
import { Plus, X, Zap, BookOpen, Link2, Loader2, Sparkles } from "lucide-react";
import type { ItemLink, Thing } from "@brett/types";
import { useClickOutside } from "./useClickOutside";

export interface SuggestionItem {
  entityId: string;
  title: string;
  type: string;
  status: string;
  similarity: number;
}

interface LinkedItemsListProps {
  links: ItemLink[];
  onAddLink: (toItemId: string, toItemType: string) => void;
  onRemoveLink: (linkId: string) => void;
  searchItems: (query: string) => Promise<Thing[]>;
  suggestions?: SuggestionItem[];
  onPromoteSuggestion?: (entityId: string, type: string) => void;
}

function getTypeIcon(type: string) {
  if (type === "task") return <Zap size={14} className="text-brett-gold" />;
  return <BookOpen size={14} className="text-amber-400" />;
}

export function LinkedItemsList({
  links,
  onAddLink,
  onRemoveLink,
  searchItems,
  suggestions,
  onPromoteSuggestion,
}: LinkedItemsListProps) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Thing[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setIsSearchOpen(false);
    setQuery("");
    setResults([]);
  };

  useClickOutside(searchRef, close, isSearchOpen);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const items = await searchItems(query);
        // Filter out already-linked items
        const linkedIds = new Set(links.map((l) => l.toItemId));
        setResults(items.filter((item) => !linkedIds.has(item.id)));
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, searchItems, links]);

  const handleSelect = 
    (item: Thing) => {
      onAddLink(item.id, item.type);
      close();
    };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/40">
          Linked Items
        </span>
        <button
          onClick={() => setIsSearchOpen(true)}
          className="p-1 text-white/40 hover:text-white hover:bg-white/10 rounded-full transition-colors"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Search input */}
      {isSearchOpen && (
        <div ref={searchRef} className="relative mb-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items\u2026"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-brett-gold/20"
          />
          {/* Results dropdown */}
          {(results.length > 0 || isSearching) && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-black/80 backdrop-blur-xl rounded-lg border border-white/10 overflow-hidden z-10 max-h-48 overflow-y-auto">
              {isSearching ? (
                <div className="flex items-center justify-center py-3">
                  <Loader2 size={14} className="text-white/30 animate-spin" />
                </div>
              ) : (
                results.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-white/70 hover:bg-white/10 transition-colors text-left"
                  >
                    {getTypeIcon(item.type)}
                    <span className="truncate">{item.title}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Linked items */}
      {links.length > 0 ? (
        <div className="space-y-1">
          {links.map((link) => (
            <div
              key={link.id}
              className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              {getTypeIcon(link.toItemType)}
              <span className="flex-1 text-sm text-white/70 truncate">
                {link.toItemTitle ?? "Untitled"}
              </span>
              {link.source === "embedding" && (
                <Sparkles size={10} className="text-amber-400/50 shrink-0" />
              )}
              <button
                onClick={() => onRemoveLink(link.id)}
                className={`p-0.5 text-white/30 hover:text-white hover:bg-white/10 rounded-full transition-colors ${
                  link.source === "embedding" ? "opacity-50 group-hover:opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        !isSearchOpen && (
          <div className="flex flex-col items-center py-4 text-white/30">
            <Link2 size={20} className="mb-1" />
            <span className="text-xs">No linked items</span>
          </div>
        )
      )}

      {/* Suggestions */}
      {suggestions && suggestions.length > 0 && onPromoteSuggestion && (
        <div className="mt-3">
          <span className="font-mono text-xs uppercase tracking-wider text-white/30 font-semibold mb-1.5 block">
            Suggested
          </span>
          <div className="space-y-1">
            {suggestions.map((s) => (
              <div
                key={s.entityId}
                className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
              >
                {getTypeIcon(s.type)}
                <span className="flex-1 text-sm text-white/40 truncate">
                  {s.title}
                </span>
                <button
                  onClick={() => onPromoteSuggestion(s.entityId, s.type)}
                  className="p-0.5 text-white/30 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-full transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Plus size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
