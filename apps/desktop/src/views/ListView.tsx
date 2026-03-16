import React, { useState, useRef, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Archive } from "lucide-react";
import { ThingCard, QuickAddInput, ItemListShell, useListKeyboardNav, SkeletonListView } from "@brett/ui";
import type { QuickAddInputHandle } from "@brett/ui";
import type { Thing, NavList } from "@brett/types";
import { slugify } from "@brett/utils";
import { useListThings, useCreateThing, useToggleThing } from "../api/things";
import { useUpdateList, useUnarchiveList } from "../api/lists";

interface ListViewProps {
  lists: NavList[];
  archivedLists?: NavList[];
  listsFetching?: boolean;
  onItemClick: (item: Thing) => void;
  onArchiveList?: (id: string, incompleteCount: number) => void;
  onTriageOpen?: (mode: "list-first" | "date-first", ids: string[], thing?: { listId?: string | null; dueDate?: string; dueDatePrecision?: "day" | "week" | null }) => void;
}

const colorMap: Record<string, string> = {
  "bg-blue-400": "#60a5fa",
  "bg-emerald-400": "#34d399",
  "bg-violet-400": "#a78bfa",
  "bg-amber-400": "#fbbf24",
  "bg-rose-400": "#fb7185",
  "bg-sky-400": "#38bdf8",
  "bg-orange-400": "#fb923c",
  "bg-slate-400": "#94a3b8",
  // Legacy values from before palette update
  "bg-blue-500": "#3b82f6",
  "bg-green-500": "#22c55e",
  "bg-purple-500": "#a855f7",
  "bg-amber-500": "#f59e0b",
  "bg-red-500": "#ef4444",
  "bg-pink-500": "#ec4899",
  "bg-cyan-500": "#06b6d4",
  "bg-orange-500": "#f97316",
  "bg-gray-500": "rgba(255,255,255,0.4)",
};

const colorSwatches = [
  "bg-blue-400",
  "bg-emerald-400",
  "bg-violet-400",
  "bg-amber-400",
  "bg-rose-400",
  "bg-sky-400",
  "bg-orange-400",
  "bg-slate-400",
];

export function ListView({ lists, archivedLists, listsFetching, onItemClick, onArchiveList, onTriageOpen }: ListViewProps) {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const list = [...lists, ...(archivedLists ?? [])].find((l) => slugify(l.name) === slug);
  const isArchived = !!list?.archivedAt;

  const { data: things = [], isLoading } = useListThings(list?.id ?? "");
  const updateList = useUpdateList();
  const createThing = useCreateThing();
  const toggleThing = useToggleThing();
  const unarchiveList = useUnarchiveList();

  // Inline name editing
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Color picker
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  // Quick add
  const quickAddRef = useRef<QuickAddInputHandle>(null);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  // Close color picker on click outside or Escape
  useEffect(() => {
    if (!showColorPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowColorPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showColorPicker]);

  // Still loading lists (e.g., after creating a new list)
  if (!list && listsFetching) {
    return <SkeletonListView />;
  }

  // Not found
  if (!list) {
    return (
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8 text-center">
        <p className="text-white/60 text-sm mb-3">List not found</p>
        <Link to="/today" className="text-blue-400 hover:text-blue-300 text-sm font-medium">
          Back to Today
        </Link>
      </div>
    );
  }

  const dotColor = colorMap[list.colorClass] ?? "rgba(255,255,255,0.4)";

  const handleNameSubmit = () => {
    const name = editName.trim();
    if (name && name !== list.name) {
      updateList.mutate({ id: list.id, name });
      // Update URL to reflect new name
      navigate(`/lists/${slugify(name)}`, { replace: true });
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleNameSubmit();
    } else if (e.key === "Escape") {
      setEditName(list.name);
      setIsEditingName(false);
    }
  };

  const handleColorSelect = (colorClass: string) => {
    updateList.mutate({ id: list.id, colorClass });
    setShowColorPicker(false);
  };

  const handleToggle = (thingId: string) => {
    toggleThing.mutate(thingId);
  };

  const handleAdd = (title: string) => {
    createThing.mutate(
      { type: "task", title, listId: list.id },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
  };

  const handleArchiveClick = () => {
    const incompleteCount = things.filter((t) => !t.isCompleted).length;
    onArchiveList?.(list.id, incompleteCount);
  };

  const activeThings = things.filter((t) => !t.isCompleted);
  const doneThings = things.filter((t) => t.isCompleted);
  const allItems = [...activeThings, ...doneThings];

  const { focusedIndex, setFocusedIndex, setAddInputFocused } = useListKeyboardNav({
    items: allItems,
    onItemClick,
    onToggle: handleToggle,
    onFocusAdd: () => quickAddRef.current?.focus(),
    onExtraKey: (e, focusedThing) => {
      if (!focusedThing || !onTriageOpen) return false;
      if (e.key === "l") {
        e.preventDefault();
        onTriageOpen("list-first", [focusedThing.id], focusedThing);
        return true;
      }
      if (e.key === "d") {
        e.preventDefault();
        onTriageOpen("date-first", [focusedThing.id], focusedThing);
        return true;
      }
      return false;
    },
  });

  const listHeader = (
    <>
      <div className="flex items-center gap-3">
        {/* Color dot */}
        <div className="relative" ref={colorPickerRef}>
          <button
            onClick={() => !isArchived && setShowColorPicker(!showColorPicker)}
            className={`w-3.5 h-3.5 rounded-full flex-shrink-0 transition-transform mt-[1px] ${!isArchived ? "hover:scale-125 cursor-pointer" : "cursor-default"}`}
            style={{ backgroundColor: dotColor }}
          />
          {showColorPicker && (
            <div className="absolute top-full left-0 mt-2 z-50 bg-black/60 backdrop-blur-2xl rounded-lg border border-white/10 p-2.5 shadow-xl">
              <div className="flex gap-2">
                {colorSwatches.map((swatch) => (
                  <button
                    key={swatch}
                    onClick={() => handleColorSelect(swatch)}
                    className={`w-7 h-7 rounded-full transition-transform hover:scale-110 flex-shrink-0 ${swatch === list.colorClass ? "ring-2 ring-white/60 ring-offset-2 ring-offset-black/60" : ""}`}
                    style={{ backgroundColor: colorMap[swatch] }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* List name */}
        {isEditingName ? (
          <input
            ref={nameInputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleNameKeyDown}
            onBlur={handleNameSubmit}
            className="bg-transparent border-none outline-none text-white text-xl font-bold leading-none"
          />
        ) : (
          <h2
            onClick={() => {
              if (!isArchived) {
                setEditName(list.name);
                setIsEditingName(true);
              }
            }}
            className={`text-xl font-bold text-white leading-none ${!isArchived ? "cursor-pointer hover:text-white/80" : ""}`}
          >
            {list.name}
          </h2>
        )}
      </div>

      {/* Archive button */}
      {!isArchived && onArchiveList && (
        <button
          onClick={handleArchiveClick}
          className="text-white/30 hover:text-white/70 transition-colors p-1 rounded hover:bg-white/10"
          title="Archive list"
        >
          <Archive size={16} />
        </button>
      )}
    </>
  );

  const listHints = allItems.length > 0
    ? ["j/k navigate", "e done", "n add"]
    : [];

  return (
    <>
      {/* Archived banner */}
      {isArchived && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-amber-400/80">This list is archived</span>
          <button
            onClick={() => unarchiveList.mutate(list.id)}
            className="text-sm text-amber-400 hover:text-amber-300 font-medium"
          >
            Unarchive
          </button>
        </div>
      )}

      <ItemListShell header={listHeader} hints={listHints}>
        {/* Quick-add input */}
        {!isArchived && (
          <QuickAddInput ref={quickAddRef} placeholder="Add a thing..." onAdd={handleAdd} onFocusChange={setAddInputFocused} />
        )}

        {/* Empty state */}
        {!isLoading && things.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <p className="text-sm text-white/40">Nothing here yet</p>
            {!isArchived && (
              <p className="text-xs text-white/20 font-mono">
                press <kbd className="px-1 py-0.5 rounded bg-white/5 text-white/30">n</kbd> to add
              </p>
            )}
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-white/5 bg-white/5">
                <div className="w-8 h-8 rounded-full bg-white/5 animate-pulse flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="bg-white/5 animate-pulse rounded-lg h-3.5 w-3/4" />
                  <div className="bg-white/5 animate-pulse rounded-lg h-2.5 w-1/2" />
                </div>
                <div className="bg-white/5 animate-pulse rounded-lg h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        )}

        {/* Active items */}
        {activeThings.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold flex-shrink-0">
                Active
              </h3>
              <div className="h-px bg-white/10 flex-1" />
            </div>
            <div className="flex flex-col gap-2">
              {activeThings.map((thing, i) => (
                <ThingCard
                  key={thing.id}
                  thing={thing}
                  onClick={() => onItemClick(thing)}
                  onToggle={handleToggle}
                  onFocus={() => setFocusedIndex(i)}
                  isFocused={focusedIndex === i}
                />
              ))}
            </div>
          </div>
        )}

        {/* Done items */}
        {doneThings.length > 0 && (
          <div className={activeThings.length > 0 ? "mt-4" : ""}>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold flex-shrink-0">
                Done
              </h3>
              <div className="h-px bg-white/10 flex-1" />
            </div>
            <div className="flex flex-col gap-2">
              {doneThings.map((thing, i) => (
                <ThingCard
                  key={thing.id}
                  thing={thing}
                  onClick={() => onItemClick(thing)}
                  onToggle={handleToggle}
                  onFocus={() => setFocusedIndex(activeThings.length + i)}
                  isFocused={focusedIndex === activeThings.length + i}
                />
              ))}
            </div>
          </div>
        )}
      </ItemListShell>
    </>
  );
}
