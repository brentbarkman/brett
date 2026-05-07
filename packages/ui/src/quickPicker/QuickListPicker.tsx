import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import type { NavList } from "@brett/types";
import { useAnchoredPosition } from "./useAnchoredPosition";

export interface QuickListPickerProps {
  anchorEl: HTMLElement | null;
  initialListId: string | null;
  lists: NavList[];
  suggestedListIds: string[];
  suggestionMode: "suggested" | "recent" | "empty";
  onCommit: (listId: string | null) => void;
  onCancel: () => void;
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start";
  visible?: boolean;
}

export function QuickListPicker({
  anchorEl,
  initialListId,
  lists,
  suggestedListIds,
  suggestionMode,
  onCommit,
  onCancel,
  placement = "bottom-end",
  visible = true,
}: QuickListPickerProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  // See QuickDatePicker for the rationale: `version` flips when the picker
  // becomes visible so useAnchoredPosition re-measures against the now-mounted
  // popover element (the morph in TriageQuickPicker depends on this).
  const pos = useAnchoredPosition(anchorEl, popoverRef, {
    preferred: placement,
    version: visible ? 1 : 0,
  });

  const chips = useMemo(() => {
    const byId = new Map(lists.map((l) => [l.id, l]));
    return suggestedListIds
      .map((id) => byId.get(id))
      .filter((l): l is NavList => !!l)
      .slice(0, 4);
  }, [lists, suggestedListIds]);

  const sortedAll = useMemo(
    () => [...lists].sort((a, b) => a.name.localeCompare(b.name)),
    [lists],
  );

  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    if (!search) return sortedAll;
    const q = search.toLowerCase();
    return sortedAll.filter((l) => l.name.toLowerCase().includes(q));
  }, [sortedAll, search]);

  const [highlightIdx, setHighlightIdx] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) searchRef.current?.focus();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      // Number 1-4 chip — only when search is empty (otherwise it's a digit input)
      if (search === "" && /^[1-4]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (chips[idx]) {
          e.preventDefault();
          onCommit(chips[idx].id);
          return;
        }
      }
      if (e.key === "Backspace" && search === "") {
        e.preventDefault();
        onCommit(null);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(-1, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (highlightIdx >= 0 && filtered[highlightIdx]) {
          onCommit(filtered[highlightIdx].id);
          return;
        }
        if (filtered.length === 1) {
          onCommit(filtered[0].id);
          return;
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, search, chips, filtered, highlightIdx, onCommit, onCancel]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      data-quickpicker="root"
      style={{ position: "fixed", top: pos.top, left: pos.left, width: 330 }}
      className="z-50 flex gap-2 rounded-xl border border-white/8 bg-[rgba(20,20,22,0.96)] p-2 shadow-2xl backdrop-blur-2xl"
    >
      {/* Chip column */}
      <div className="flex w-[128px] flex-col gap-1">
        <div className="flex items-center gap-1 px-2 pb-1 text-[8px] uppercase tracking-wider text-white/45">
          {suggestionMode === "suggested" && (
            <>
              <Sparkles size={8} className="text-brett-gold/60" /> Suggested
            </>
          )}
          {suggestionMode === "recent" && <>Recent</>}
        </div>
        {chips.map((list, i) => {
          const isCurrent = list.id === initialListId;
          return (
            <button
              key={list.id}
              type="button"
              data-testid={`chip-list-${list.id}`}
              data-current={isCurrent ? "true" : "false"}
              onClick={() => onCommit(list.id)}
              className={[
                "relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left",
                isCurrent
                  ? "bg-brett-gold/25 ring-1 ring-brett-gold/60 ring-inset"
                  : "border border-transparent bg-white/[0.025] hover:bg-white/5",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-3.5 w-3.5 items-center justify-center rounded text-[8px] font-semibold",
                  isCurrent
                    ? "bg-brett-gold text-black/80"
                    : "bg-white/10 text-white/70",
                ].join(" ")}
              >
                {i + 1}
              </span>
              <span className={`h-1.5 w-1.5 rounded-full ${list.colorClass}`} />
              <span className={[
                "flex-1 truncate text-[10px]",
                isCurrent ? "text-white font-medium" : "text-white/85",
              ].join(" ")}>
                {list.name}
              </span>
              {isCurrent && (
                <span
                  aria-label="currently set"
                  className="ml-1 h-1.5 w-1.5 rounded-full bg-brett-gold"
                />
              )}
            </button>
          );
        })}
        <div className="mt-1 border-t border-white/5 pt-1">
          <button
            type="button"
            data-testid="chip-list-clear"
            onClick={() => onCommit(null)}
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-white/5"
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-white/5 text-[8px] text-white/50">
              ⌫
            </span>
            <span className="text-[10px] text-white/55">No list</span>
          </button>
        </div>
      </div>

      {/* Search + scroll column */}
      <div className="flex w-[185px] flex-col border-l border-white/5 pl-2">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search lists…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setHighlightIdx(-1);
          }}
          className="rounded-md border border-white/8 bg-black/40 px-2 py-1 text-[10px] text-white placeholder:text-white/40 outline-none mb-1"
        />
        <div className="sticky top-0 z-10 bg-[rgba(20,20,22,0.96)] py-1 text-[10px] font-semibold text-white tracking-wide">
          All lists
        </div>
        <div
          className="relative max-h-[200px] overflow-y-auto"
          style={{ scrollbarWidth: "thin" }}
        >
          {filtered.map((list, i) => {
            const isHighlighted = i === highlightIdx;
            const isSelected = list.id === initialListId;
            return (
              <button
                key={list.id}
                type="button"
                data-testid={`row-list-${list.id}`}
                onMouseEnter={() => setHighlightIdx(i)}
                onClick={() => onCommit(list.id)}
                className={[
                  "flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left",
                  isSelected
                    ? "bg-brett-gold/15"
                    : isHighlighted
                      ? "bg-white/5"
                      : "hover:bg-white/[0.03]",
                ].join(" ")}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${list.colorClass}`} />
                <span className="flex-1 truncate text-[10px] text-white/85">
                  {list.name}
                </span>
              </button>
            );
          })}
          <div className="pointer-events-none sticky bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[rgba(20,20,22,0.95)] to-transparent" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
