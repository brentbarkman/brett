import React from "react";
import { Newspaper } from "lucide-react";
import { usePreference } from "../api/preferences";

export function BriefingSection() {
  const [dismissedDate, setDismissedDate] = usePreference("briefingDismissedDate");

  const today = new Date().toLocaleDateString("en-CA");
  const isDismissedToday = dismissedDate === today;

  return (
    <section className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
      <div className="flex items-center gap-2 mb-4">
        <Newspaper size={16} className="text-white/50" />
        <h2 className="text-sm font-semibold text-white/90">Daily Briefing</h2>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/70">
            {isDismissedToday ? "Dismissed for today" : "Showing on Today view"}
          </p>
          {isDismissedToday && (
            <p className="text-xs text-white/40 mt-0.5">
              It will reappear tomorrow, or bring it back now.
            </p>
          )}
        </div>
        {isDismissedToday && (
          <button
            onClick={() => setDismissedDate(null)}
            className="text-xs text-blue-400/90 hover:text-blue-300 transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
          >
            Show briefing
          </button>
        )}
      </div>
    </section>
  );
}
