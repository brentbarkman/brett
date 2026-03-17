import React, { useState, useRef, useCallback } from "react";
import { Calendar, Bell, RotateCw } from "lucide-react";
import type { DueDatePrecision, ReminderType, RecurrenceType } from "@brett/types";
import { useClickOutside } from "./useClickOutside";

interface ScheduleRowProps {
  dueDate?: string;
  dueDateLabel?: string;
  dueDatePrecision?: DueDatePrecision;
  reminder?: ReminderType;
  recurrence?: RecurrenceType;
  onUpdateDueDate: (dueDate: string | null, precision: DueDatePrecision) => void;
  onUpdateReminder: (reminder: ReminderType | null) => void;
  onUpdateRecurrence: (recurrence: RecurrenceType | null) => void;
}

interface ScheduleCardProps {
  icon: React.ReactNode;
  label: string;
  value?: string;
  children: (close: () => void) => React.ReactNode;
}

function ScheduleCard({ icon, label, value, children }: ScheduleCardProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  return (
    <div ref={ref} className="relative flex-1">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex flex-col items-center gap-1.5 p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-colors cursor-pointer"
      >
        <span className="text-white/40">{icon}</span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/40 font-semibold">
          {label}
        </span>
        {value && (
          <span className="text-xs text-white/70 truncate max-w-full">
            {value}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-black/80 backdrop-blur-xl rounded-lg border border-white/10 overflow-hidden z-10">
          {children(close)}
        </div>
      )}
    </div>
  );
}

function DropdownOption({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-xs transition-colors ${
        isActive
          ? "text-blue-400 bg-blue-500/10"
          : "text-white/70 hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );
}

function getTodayISO(): string {
  return new Date().toISOString().split("T")[0] + "T00:00:00.000Z";
}

function getTomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0] + "T00:00:00.000Z";
}

function getThisWeekISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 0 : 7 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().split("T")[0] + "T00:00:00.000Z";
}

const reminderLabels: Record<ReminderType, string> = {
  morning_of: "Morning of",
  "1_hour_before": "1 hour before",
  day_before: "Day before",
  custom: "Custom",
};

const recurrenceLabels: Record<RecurrenceType, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  custom: "Custom",
};

export function ScheduleRow({
  dueDate,
  dueDateLabel,
  dueDatePrecision,
  reminder,
  recurrence,
  onUpdateDueDate,
  onUpdateReminder,
  onUpdateRecurrence,
}: ScheduleRowProps) {
  return (
    <div>
      <span className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold mb-2 block">
        Schedule
      </span>
      <div className="flex gap-2">
        <ScheduleCard
          icon={<Calendar size={16} />}
          label="Due Date"
          value={dueDateLabel ?? (dueDate ? "Set" : undefined)}
        >
          {(close) => (
            <>
              <DropdownOption
                label="Today"
                isActive={!!dueDate && dueDatePrecision === "day" && dueDate.startsWith(getTodayISO().split("T")[0])}
                onClick={() => { onUpdateDueDate(getTodayISO(), "day"); close(); }}
              />
              <DropdownOption
                label="Tomorrow"
                isActive={!!dueDate && dueDatePrecision === "day" && dueDate.startsWith(getTomorrowISO().split("T")[0])}
                onClick={() => { onUpdateDueDate(getTomorrowISO(), "day"); close(); }}
              />
              <DropdownOption
                label="This Week"
                isActive={dueDatePrecision === "week"}
                onClick={() => { onUpdateDueDate(getThisWeekISO(), "week"); close(); }}
              />
              <DropdownOption
                label="No date"
                isActive={!dueDate}
                onClick={() => { onUpdateDueDate(null, "day"); close(); }}
              />
            </>
          )}
        </ScheduleCard>

        <ScheduleCard
          icon={<Bell size={16} />}
          label="Reminder"
          value={reminder ? reminderLabels[reminder] : undefined}
        >
          {(close) => (
            <>
              <DropdownOption
                label="Morning of"
                isActive={reminder === "morning_of"}
                onClick={() => { onUpdateReminder("morning_of"); close(); }}
              />
              <DropdownOption
                label="1 hour before"
                isActive={reminder === "1_hour_before"}
                onClick={() => { onUpdateReminder("1_hour_before"); close(); }}
              />
              <DropdownOption
                label="Day before"
                isActive={reminder === "day_before"}
                onClick={() => { onUpdateReminder("day_before"); close(); }}
              />
              <DropdownOption
                label="No reminder"
                isActive={!reminder}
                onClick={() => { onUpdateReminder(null); close(); }}
              />
            </>
          )}
        </ScheduleCard>

        <ScheduleCard
          icon={<RotateCw size={16} />}
          label="Recurrence"
          value={recurrence ? recurrenceLabels[recurrence] : undefined}
        >
          {(close) => (
            <>
              <DropdownOption
                label="Daily"
                isActive={recurrence === "daily"}
                onClick={() => { onUpdateRecurrence("daily"); close(); }}
              />
              <DropdownOption
                label="Weekly"
                isActive={recurrence === "weekly"}
                onClick={() => { onUpdateRecurrence("weekly"); close(); }}
              />
              <DropdownOption
                label="Monthly"
                isActive={recurrence === "monthly"}
                onClick={() => { onUpdateRecurrence("monthly"); close(); }}
              />
              <DropdownOption
                label="No recurrence"
                isActive={!recurrence}
                onClick={() => { onUpdateRecurrence(null); close(); }}
              />
            </>
          )}
        </ScheduleCard>
      </div>
    </div>
  );
}
