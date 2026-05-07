import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computeTriageResult, type TriageDatePreset } from "@brett/business";
import { ScrollableCalendar } from "./ScrollableCalendar";
import { useAnchoredPosition } from "./useAnchoredPosition";
import {
  DATE_LETTER_TO_PRESET,
  DATE_PRESET_ORDER,
  DATE_PRESET_LABELS,
  DATE_PRESET_TO_LETTER,
} from "./letters";

export interface QuickDatePickerProps {
  anchorEl: HTMLElement | null;
  initialDate: Date | null;
  onCommit: (date: Date | null) => void;
  onCancel: () => void;
  placement?: "bottom-end" | "bottom-start" | "top-end" | "top-start";
  now?: Date;
  visible?: boolean;
}

const WEEKDAY_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});
const MONTHDAY_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function presetSublabel(preset: TriageDatePreset, now: Date): string {
  const result = computeTriageResult(preset, now);
  const date = new Date(result.dueDate);
  if (preset === "this_week") {
    const fri = new Date(date);
    fri.setUTCDate(fri.getUTCDate() - 2);
    return `by ${WEEKDAY_FMT.format(fri)} ${MONTHDAY_FMT.format(fri)}`;
  }
  return `${WEEKDAY_FMT.format(date)} · ${MONTHDAY_FMT.format(date)}`;
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + n);
  return copy;
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function QuickDatePicker({
  anchorEl,
  initialDate,
  onCommit,
  onCancel,
  placement = "bottom-end",
  now,
  visible = true,
}: QuickDatePickerProps) {
  const today = useMemo(() => startOfDayUTC(now ?? new Date()), [now]);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Bumping `version` when `visible` flips forces useAnchoredPosition to
  // re-measure once popoverRef.current has actually been attached to the DOM
  // (otherwise the morph from QuickDatePicker → QuickListPicker would leave
  // the newly-visible picker positioned at -9999, -9999 from its initial
  // null-ref measurement).
  const pos = useAnchoredPosition(anchorEl, popoverRef, {
    preferred: placement,
    version: visible ? 1 : 0,
  });

  const [highlighted, setHighlighted] = useState<Date>(initialDate ?? today);

  const commitPreset = useCallback(
    (preset: TriageDatePreset) => {
      const result = computeTriageResult(preset, now ?? new Date());
      onCommit(new Date(result.dueDate));
    },
    [onCommit, now],
  );

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      const lower = e.key.toLowerCase();
      if (lower === "escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (lower === "backspace" || lower === "delete") {
        e.preventDefault();
        onCommit(null);
        return;
      }
      if (lower in DATE_LETTER_TO_PRESET) {
        e.preventDefault();
        commitPreset(DATE_LETTER_TO_PRESET[lower]);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((d) => addDays(d, 7));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((d) => addDays(d, -7));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setHighlighted((d) => addDays(d, 1));
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setHighlighted((d) => addDays(d, -1));
        return;
      }
      if (e.key === "PageDown") {
        e.preventDefault();
        setHighlighted(
          (d) =>
            new Date(
              Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()),
            ),
        );
        return;
      }
      if (e.key === "PageUp") {
        e.preventDefault();
        setHighlighted(
          (d) =>
            new Date(
              Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, d.getUTCDate()),
            ),
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onCommit(highlighted);
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, highlighted, commitPreset, onCommit, onCancel]);

  if (!visible) return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      data-quickpicker="root"
      style={{ position: "fixed", top: pos.top, left: pos.left, width: 330 }}
      className="z-50 flex gap-2 rounded-xl border border-white/8 bg-[rgba(20,20,22,0.96)] p-2 shadow-2xl backdrop-blur-2xl"
    >
      <ChipColumn
        initialDate={initialDate}
        now={today}
        onCommitPreset={commitPreset}
        onClear={() => onCommit(null)}
      />
      <div className="w-[185px] border-l border-white/5 pl-2">
        <ScrollableCalendar
          anchorDate={initialDate ?? today}
          highlightedDate={highlighted}
          selectedDate={initialDate}
          onHighlight={setHighlighted}
          onCommit={onCommit}
          now={today}
        />
      </div>
    </div>,
    document.body,
  );
}

function ChipColumn({
  initialDate,
  now,
  onCommitPreset,
  onClear,
}: {
  initialDate: Date | null;
  now: Date;
  onCommitPreset: (p: TriageDatePreset) => void;
  onClear: () => void;
}) {
  return (
    <div className="flex w-[128px] flex-col gap-1">
      {DATE_PRESET_ORDER.map((preset) => {
        const isCurrent =
          !!initialDate &&
          computeTriageResult(preset, now).dueDate.slice(0, 10) ===
            initialDate.toISOString().slice(0, 10);
        return (
          <button
            key={preset}
            type="button"
            data-testid={`chip-${preset}`}
            data-current={isCurrent ? "true" : "false"}
            onClick={() => onCommitPreset(preset)}
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
              {DATE_PRESET_TO_LETTER[preset].toUpperCase()}
            </span>
            <span className="flex-1 min-w-0">
              <span
                className={[
                  "block text-[10px] font-medium truncate",
                  isCurrent ? "text-white" : "text-white/85",
                ].join(" ")}
              >
                {DATE_PRESET_LABELS[preset]}
              </span>
              <span
                className={[
                  "block text-[8px] truncate",
                  isCurrent ? "text-brett-gold" : "text-white/40",
                ].join(" ")}
              >
                {presetSublabel(preset, now)}
              </span>
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
          data-testid="chip-clear"
          onClick={onClear}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left hover:bg-white/5"
        >
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-white/5 text-[8px] text-white/50">
            ⌫
          </span>
          <span className="text-[10px] text-white/55">No date</span>
        </button>
      </div>
    </div>
  );
}
