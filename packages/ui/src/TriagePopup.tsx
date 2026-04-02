import React, { useState, useRef, useEffect, useCallback } from "react";
import { Calendar, List, Sparkles } from "lucide-react";
import type { NavList, DueDatePrecision } from "@brett/types";
import { computeTriageResult, type TriageDatePreset } from "@brett/business";

interface ListSuggestion {
  listId: string;
  listName: string;
  similarity: number;
}

interface TriagePopupProps {
  mode: "list-first" | "date-first";
  lists: NavList[];
  /** Current values from the thing being triaged — used to pre-select on secondary step */
  currentListId?: string | null;
  currentDueDate?: string | null;
  currentDueDatePrecision?: DueDatePrecision | null;
  /** AI-suggested lists based on semantic similarity */
  suggestedLists?: ListSuggestion[];
  onConfirm: (updates: {
    listId?: string | null;
    dueDate?: string | null;
    dueDatePrecision?: DueDatePrecision | null;
  }) => void;
  onCancel: () => void;
}

const DATE_PRESETS: { key: string; label: string; preset: TriageDatePreset }[] =
  [
    { key: "t", label: "Today", preset: "today" },
    { key: "w", label: "Tomorrow", preset: "tomorrow" },
    { key: "r", label: "This Week", preset: "this_week" },
    { key: "n", label: "Next Week", preset: "next_week" },
    { key: "m", label: "Next Month", preset: "next_month" },
  ];

type Step = "list" | "date";

export function TriagePopup({
  mode,
  lists,
  currentListId,
  currentDueDate,
  currentDueDatePrecision,
  suggestedLists,
  onConfirm,
  onCancel,
}: TriagePopupProps) {
  const primaryStep: Step = mode === "list-first" ? "list" : "date";
  const secondaryStep: Step = mode === "list-first" ? "date" : "list";

  const [currentStep, setCurrentStep] = useState<Step>(primaryStep);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedPrecision, setSelectedPrecision] = useState<DueDatePrecision | null>(null);
  const [filterText, setFilterText] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // Auto-focus filter when showing list picker
  useEffect(() => {
    if (currentStep === "list") {
      filterRef.current?.focus();
    } else {
      containerRef.current?.focus();
    }
  }, [currentStep]);

  const filteredLists = lists.filter((l) =>
    l.name.toLowerCase().includes(filterText.toLowerCase())
  );

  // Clamp focus index (allow -1 for "none selected")
  useEffect(() => {
    if (currentStep === "list" && focusedIndex >= filteredLists.length) {
      setFocusedIndex(Math.max(-1, filteredLists.length - 1));
    }
    if (currentStep === "date" && focusedIndex >= DATE_PRESETS.length) {
      setFocusedIndex(Math.max(-1, DATE_PRESETS.length - 1));
    }
  }, [filteredLists.length, focusedIndex, currentStep]);

  const advanceOrConfirm = useCallback(
    (listId: string | null, date: string | null, precision: DueDatePrecision | null) => {
      // If we're on the primary step, advance to secondary
      if (currentStep === primaryStep) {
        setCurrentStep(secondaryStep);
        setFilterText("");

        // Pre-select the current value on the secondary step if it exists
        if (secondaryStep === "list" && currentListId) {
          const idx = lists.findIndex((l) => l.id === currentListId);
          setFocusedIndex(idx >= 0 ? idx : -1);
        } else {
          setFocusedIndex(-1); // No current value — nothing selected, Enter skips
        }
      } else {
        // On secondary step, confirm
        onConfirm({ listId, dueDate: date, dueDatePrecision: precision });
      }
    },
    [currentStep, primaryStep, secondaryStep, onConfirm, currentListId, lists]
  );

  const selectList = useCallback(
    (listId: string) => {
      setSelectedListId(listId);
      advanceOrConfirm(listId, selectedDate, selectedPrecision);
    },
    [advanceOrConfirm, selectedDate, selectedPrecision]
  );

  const selectDate = useCallback(
    (preset: TriageDatePreset) => {
      const result = computeTriageResult(preset);
      setSelectedDate(result.dueDate);
      setSelectedPrecision(result.dueDatePrecision);
      advanceOrConfirm(selectedListId, result.dueDate, result.dueDatePrecision);
    },
    [advanceOrConfirm, selectedListId]
  );

  const clearDate = useCallback(() => {
    setSelectedDate(null);
    setSelectedPrecision(null);
    advanceOrConfirm(selectedListId, null, null);
  }, [advanceOrConfirm, selectedListId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Escape cancels
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }

      // Enter — select focused item, or skip if nothing focused
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();

        // Nothing focused (-1) → skip this step
        if (focusedIndex === -1) {
          if (currentStep === primaryStep) {
            setCurrentStep(secondaryStep);
            setFilterText("");
            setFocusedIndex(0); // Primary step: pre-select first item
          } else {
            // Secondary step: confirm with whatever we have (skip this field)
            onConfirm({ listId: selectedListId, dueDate: selectedDate, dueDatePrecision: selectedPrecision });
          }
          return;
        }

        if (currentStep === "list" && filteredLists[focusedIndex]) {
          selectList(filteredLists[focusedIndex].id);
        } else if (currentStep === "date" && DATE_PRESETS[focusedIndex]) {
          selectDate(DATE_PRESETS[focusedIndex].preset);
        } else {
          onConfirm({ listId: selectedListId, dueDate: selectedDate, dueDatePrecision: selectedPrecision });
        }
        return;
      }

      // Arrow nav
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const max =
          currentStep === "list"
            ? filteredLists.length - 1
            : DATE_PRESETS.length - 1;
        setFocusedIndex((i) => Math.min(i + 1, max));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, -1));
        return;
      }

      // Date shortcuts (only active in date step)
      if (currentStep === "date") {
        const preset = DATE_PRESETS.find((p) => p.key === e.key);
        if (preset) {
          e.preventDefault();
          selectDate(preset.preset);
          return;
        }
        if (e.key === "Backspace") {
          e.preventDefault();
          clearDate();
          return;
        }
      }

      // Number keys for list quick select (only in list step)
      if (currentStep === "list") {
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9 && num <= filteredLists.length) {
          e.preventDefault();
          selectList(filteredLists[num - 1].id);
          return;
        }
      }
    },
    [
      currentStep,
      primaryStep,
      secondaryStep,
      focusedIndex,
      filteredLists,
      selectedListId,
      selectedDate,
      onCancel,
      onConfirm,
      selectList,
      selectDate,
      clearDate,
    ]
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="absolute left-1/2 -translate-x-1/2 mt-2 z-50 w-64 bg-black/80 backdrop-blur-2xl rounded-xl border border-white/15 shadow-2xl overflow-hidden outline-none"
      style={{
        animation:
          "triagePopupEnter 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards",
      }}
    >
      {/* Step indicator */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <div
          className={`flex items-center gap-1.5 text-[11px] font-medium ${
            currentStep === "list" ? "text-blue-400" : "text-white/40"
          }`}
        >
          <List size={12} />
          <span>List</span>
        </div>
        <span className="text-white/20 text-[10px]">+</span>
        <div
          className={`flex items-center gap-1.5 text-[11px] font-medium ${
            currentStep === "date" ? "text-blue-400" : "text-white/40"
          }`}
        >
          <Calendar size={12} />
          <span>Date</span>
        </div>
        <div className="flex-1" />
        <span className="text-[10px] text-white/20 font-mono">
          esc cancel
        </span>
      </div>

      {/* List picker */}
      {currentStep === "list" && (
        <div>
          <div className="px-3 py-2 border-b border-white/5">
            <input
              ref={filterRef}
              type="text"
              placeholder="Filter lists..."
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setFocusedIndex(0);
              }}
              className="w-full bg-transparent border-none outline-none text-sm text-white placeholder:text-white/20"
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {/* Suggested lists */}
            {suggestedLists && suggestedLists.length > 0 && !filterText && (
              <>
                <div className="flex items-center gap-1 px-3 py-1">
                  <Sparkles size={9} className="text-amber-400/60" />
                  <span className="text-[10px] text-white/30 font-medium uppercase tracking-wide">
                    Suggested
                  </span>
                </div>
                {suggestedLists.map((suggestion) => {
                  const list = lists.find((l) => l.id === suggestion.listId);
                  if (!list) return null;
                  return (
                    <button
                      key={`suggested-${list.id}`}
                      onClick={() => selectList(list.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors text-white/70 hover:bg-white/5"
                    >
                      <div className={`w-2 h-2 rounded-full ${list.colorClass}`} />
                      <span className="text-sm flex-1 truncate">{list.name}</span>
                    </button>
                  );
                })}
                <div className="border-t border-white/5 mt-1 mb-1" />
              </>
            )}
            {filteredLists.map((list, i) => (
              <button
                key={list.id}
                onClick={() => selectList(list.id)}
                className={`
                  w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors
                  ${i === focusedIndex ? "bg-blue-500/15 text-white" : "text-white/70 hover:bg-white/5"}
                `}
              >
                <div className={`w-2 h-2 rounded-full ${list.colorClass}`} />
                <span className="text-sm flex-1 truncate">{list.name}</span>
                {i < 9 && (
                  <span className="text-[10px] text-white/20 font-mono">
                    {i + 1}
                  </span>
                )}
              </button>
            ))}
            {filteredLists.length === 0 && (
              <div className="px-3 py-2 text-xs text-white/30">
                No matching lists
              </div>
            )}
          </div>
        </div>
      )}

      {/* Date picker */}
      {currentStep === "date" && (
        <div className="py-1">
          {DATE_PRESETS.map((preset, i) => (
            <button
              key={preset.key}
              onClick={() => selectDate(preset.preset)}
              className={`
                w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors
                ${i === focusedIndex ? "bg-blue-500/15 text-white" : "text-white/70 hover:bg-white/5"}
              `}
            >
              <span className="w-4 text-center text-[11px] font-mono text-blue-400/70">
                {preset.key}
              </span>
              <span className="text-sm">{preset.label}</span>
            </button>
          ))}
          <div className="border-t border-white/5 mt-1 pt-1">
            <div className="px-3 py-1.5">
              <input
                type="date"
                defaultValue={
                  currentDueDate && currentDueDatePrecision === "day"
                    ? new Date(currentDueDate).toISOString().split("T")[0]
                    : undefined
                }
                onChange={(e) => {
                  if (e.target.value) {
                    const d = new Date(e.target.value + "T00:00:00Z");
                    setSelectedDate(d.toISOString());
                    setSelectedPrecision("day");
                    advanceOrConfirm(selectedListId, d.toISOString(), "day");
                  }
                }}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white [color-scheme:dark]"
              />
            </div>
            <button
              onClick={clearDate}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-white/40 hover:bg-white/5 transition-colors"
            >
              <span className="w-4 text-center text-[11px] font-mono">
                ←
              </span>
              <span className="text-sm">Remove date</span>
            </button>
          </div>
        </div>
      )}

      {/* Footer hint */}
      <div className="px-3 py-1.5 border-t border-white/5 text-[10px] text-white/20 font-mono text-center">
        {focusedIndex === -1 ? "enter to skip" : "enter to select"}
      </div>

      <style>{`
        @keyframes triagePopupEnter {
          from {
            opacity: 0;
            transform: translateX(-50%) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
