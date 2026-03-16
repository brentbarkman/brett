import React, { useState, useRef, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Archive } from "lucide-react";
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
  "bg-blue-500",
  "bg-red-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-amber-500",
  "bg-pink-500",
  "bg-cyan-500",
  "bg-orange-500",
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

  // Inline add
  const [isAdding, setIsAdding] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }
  }, [isEditingName]);

  useEffect(() => {
    if (isAdding) {
      addInputRef.current?.focus();
    }
  }, [isAdding]);

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

  const handleInlineAdd = () => {
    const title = addTitle.trim();
    if (title) {
      createThing.mutate(
        { type: "task", title, listId: list.id },
        { onError: (err) => console.error("Failed to create thing:", err) }
      );
    }
    setAddTitle("");
    setIsAdding(false);
  };

  const handleAddKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleInlineAdd();
    } else if (e.key === "Escape") {
      setAddTitle("");
      setIsAdding(false);
    }
  };

  const handleArchiveClick = () => {
    // Use fresh things data for accurate incomplete count
    const incompleteCount = things.filter((t) => !t.isCompleted).length;
    onArchiveList?.(list.id, incompleteCount);
  };

  const activeThings = things.filter((t) => !t.isCompleted);
  const doneThings = things.filter((t) => t.isCompleted);

  return (
    <>
      {/* Header */}
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
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
              className="bg-transparent border-none outline-none text-white text-lg font-semibold flex-1"
            />
          ) : (
            <h1
              onClick={() => {
                if (!isArchived) {
                  setEditName(list.name);
                  setIsEditingName(true);
                }
              }}
              className={`text-lg font-semibold text-white flex-1 ${!isArchived ? "cursor-pointer hover:text-white/80" : ""}`}
            >
              {list.name}
            </h1>
          )}

          {/* Item count */}
          <span className="text-sm text-white/40">{things.length} item{things.length !== 1 ? "s" : ""}</span>

          {/* Archive button */}
          {!isArchived && onArchiveList && (
            <button
              onClick={handleArchiveClick}
              className="text-white/30 hover:text-white/70 transition-colors p-1 rounded hover:bg-white/10"
            >
              <Archive size={16} />
            </button>
          )}
        </div>
      </div>

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

      {/* Inline add row */}
      {!isArchived && (
        isAdding ? (
          <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
            <input
              ref={addInputRef}
              value={addTitle}
              onChange={(e) => setAddTitle(e.target.value)}
              onKeyDown={handleAddKeyDown}
              onBlur={handleInlineAdd}
              placeholder="What needs to be done?"
              className="bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm w-full"
            />
          </div>
        ) : (
          <button
            onClick={() => setIsAdding(true)}
            className="w-full border border-dashed border-white/20 rounded-xl px-4 py-3 text-sm text-white/40 hover:text-white/60 hover:border-white/30 transition-colors text-left"
          >
            + Add a thing...
          </button>
        )
      )}

      {/* Content */}
      {isLoading ? (
        <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8">
          <div className="text-center text-white/40 text-sm">Loading...</div>
        </div>
      ) : things.length === 0 ? (
        <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-8">
          <div className="text-center text-white/40 text-sm">No items in this list yet</div>
        </div>
      ) : (
        <>
          {activeThings.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold px-1">
                Active
              </h2>
              <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
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
            </div>
          )}

          {doneThings.length > 0 && (
            <div className="space-y-2">
              <h2 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold px-1">
                Done
              </h2>
              <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-4">
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
            </div>
          )}
        </>
      )}
    </>
  );
}
