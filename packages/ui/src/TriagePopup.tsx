import React, { useState, useRef, useEffect, useCallback } from "react";
import { Calendar, List } from "lucide-react";
import type { NavList } from "@brett/types";
import { computeTriageDate, type TriageDatePreset } from "@brett/business";

interface TriagePopupProps {
  mode: "list-first" | "date-first";
  lists: NavList[];
  onConfirm: (updates: {
    listId?: string | null;
    dueDate?: string | null;
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
  onConfirm,
  onCancel,
}: TriagePopupProps) {
  const primaryStep: Step = mode === "list-first" ? "list" : "date";
  const secondaryStep: Step = mode === "list-first" ? "date" : "list";

  const [currentStep, setCurrentStep] = useState<Step>(primaryStep);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
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

  // Clamp focus index
  useEffect(() => {
    if (currentStep === "list" && focusedIndex >= filteredLists.length) {
      setFocusedIndex(Math.max(0, filteredLists.length - 1));
    }
    if (currentStep === "date" && focusedIndex >= DATE_PRESETS.length) {
      setFocusedIndex(Math.max(0, DATE_PRESETS.length - 1));
    }
  }, [filteredLists.length, focusedIndex, currentStep]);

  const advanceOrConfirm = useCallback(
    (listId: string | null, date: string | null) => {
      // If we're on the primary step, advance to secondary
      if (currentStep === primaryStep) {
        setCurrentStep(secondaryStep);
        setFilterText("");
        setFocusedIndex(0);
      } else {
        // On secondary step, confirm
        onConfirm({ listId, dueDate: date });
      }
    },
    [currentStep, primaryStep, secondaryStep, onConfirm]
  );

  const selectList = useCallback(
    (listId: string) => {
      setSelectedListId(listId);
      advanceOrConfirm(listId, selectedDate);
    },
    [advanceOrConfirm, selectedDate]
  );

  const selectDate = useCallback(
    (preset: TriageDatePreset) => {
      const date = computeTriageDate(preset);
      setSelectedDate(date);
      advanceOrConfirm(selectedListId, date);
    },
    [advanceOrConfirm, selectedListId]
  );

  const clearDate = useCallback(() => {
    setSelectedDate(null);
    advanceOrConfirm(selectedListId, null);
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

      // Enter confirms with current selections and skips secondary step
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (currentStep === "list" && filteredLists[focusedIndex]) {
          const listId = filteredLists[focusedIndex].id;
          setSelectedListId(listId);
          // If primary step, advance; if secondary, confirm
          if (currentStep === primaryStep) {
            setCurrentStep(secondaryStep);
            setFilterText("");
            setFocusedIndex(0);
          } else {
            onConfirm({ listId, dueDate: selectedDate });
          }
        } else if (currentStep === "date") {
          const preset = DATE_PRESETS[focusedIndex];
          if (preset) {
            const date = computeTriageDate(preset.preset);
            if (currentStep === primaryStep) {
              setSelectedDate(date);
              setCurrentStep(secondaryStep);
              setFilterText("");
              setFocusedIndex(0);
            } else {
              onConfirm({ listId: selectedListId, dueDate: date });
            }
          }
        } else {
          // Enter with no selection — confirm what we have so far
          onConfirm({ listId: selectedListId, dueDate: selectedDate });
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
        setFocusedIndex((i) => Math.max(i - 1, 0));
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
              className="w-full bg-transparent border-none outline-none text-sm text-white placeholder:text-white/25"
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
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
                  <span className="text-[10px] text-white/25 font-mono">
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
        enter to{" "}
        {currentStep === primaryStep ? "skip & confirm" : "confirm"}
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
