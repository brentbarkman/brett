import React, { useState, useRef, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Archive, Plus } from "lucide-react";
import { ThingCard } from "@brett/ui";
import type { Thing, NavList } from "@brett/types";
import { useListThings, useCreateThing, useToggleThing } from "../api/things";
import { useUpdateList, useUnarchiveList } from "../api/lists";

interface ListViewProps {
  lists: NavList[];
  archivedLists?: NavList[];
  onItemClick: (item: Thing) => void;
  onArchiveList?: (id: string, incompleteCount: number) => void;
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

export function ListView({ lists, archivedLists, onItemClick, onArchiveList }: ListViewProps) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const list = lists.find((l) => l.id === id) ?? archivedLists?.find((l) => l.id === id);
  const isArchived = !!list?.archivedAt;

  const { data: things = [], isLoading } = useListThings(id!);
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
  const [addValue, setAddValue] = useState("");
  const [addFocused, setAddFocused] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

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

  const handleAddSubmit = () => {
    if (!addValue.trim()) return;
    createThing.mutate(
      { type: "task", title: addValue.trim(), listId: list.id },
      { onError: (err) => console.error("Failed to create thing:", err) }
    );
    setAddValue("");
    addInputRef.current?.focus();
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSubmit();
    }
    if (e.key === "Escape") {
      setAddValue("");
      addInputRef.current?.blur();
    }
  };

  const handleArchiveClick = () => {
    const incompleteCount = things.filter((t) => !t.isCompleted).length;
    onArchiveList?.(list.id, incompleteCount);
  };

  const activeThings = things.filter((t) => !t.isCompleted);
  const doneThings = things.filter((t) => t.isCompleted);

  return (
    <div className="flex flex-col gap-4 pb-20">
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

      {/* Main card — header + add + items */}
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {/* Color dot */}
            <div className="relative" ref={colorPickerRef}>
              <button
                onClick={() => !isArchived && setShowColorPicker(!showColorPicker)}
                className={`w-4 h-4 rounded-full flex-shrink-0 transition-transform ${!isArchived ? "hover:scale-125 cursor-pointer" : "cursor-default"}`}
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
                className="bg-transparent border-none outline-none text-white text-xl font-bold flex-1"
              />
            ) : (
              <h2
                onClick={() => {
                  if (!isArchived) {
                    setEditName(list.name);
                    setIsEditingName(true);
                  }
                }}
                className={`text-xl font-bold text-white ${!isArchived ? "cursor-pointer hover:text-white/80" : ""}`}
              >
                {list.name}
              </h2>
            )}

            {/* Item count */}
            {things.length > 0 && (
              <span className="text-sm text-white/40">
                {things.length} item{things.length !== 1 ? "s" : ""}
              </span>
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
        </div>

        {/* Quick-add input */}
        {!isArchived && (
          <div
            className={`
              flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all mb-3
              ${addFocused
                ? "bg-white/5 border border-blue-500/20"
                : "border border-transparent hover:bg-white/[0.03]"
              }
            `}
          >
            <Plus
              size={15}
              className={addFocused ? "text-blue-400" : "text-white/20"}
            />
            <input
              ref={addInputRef}
              type="text"
              placeholder="Add a thing..."
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              onKeyDown={handleAddKeyDown}
              onFocus={() => setAddFocused(true)}
              onBlur={() => {
                if (!addValue) setAddFocused(false);
              }}
              className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/20 text-sm"
            />
            {addFocused && addValue.trim() && (
              <span className="text-[10px] text-white/25 font-mono">enter</span>
            )}
          </div>
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
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-white/40">Loading...</p>
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
              {activeThings.map((thing) => (
                <ThingCard
                  key={thing.id}
                  thing={thing}
                  onClick={() => onItemClick(thing)}
                  onToggle={handleToggle}
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
              {doneThings.map((thing) => (
                <ThingCard
                  key={thing.id}
                  thing={thing}
                  onClick={() => onItemClick(thing)}
                  onToggle={handleToggle}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
