import React from "react";
import { usePreference } from "../api/preferences";

export function BriefingSection() {
  const [enabled, setEnabled] = usePreference("briefingEnabled");
  const [dismissedDate, setDismissedDate] = usePreference("briefingDismissedDate");

  const today = new Date().toLocaleDateString("en-CA");
  const isDismissedToday = dismissedDate === today;

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-4">
        Daily Briefing
      </h3>

      <div className="space-y-4">
        {/* Enable/disable toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-white/70">Show daily briefing</span>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`
              relative w-9 h-5 rounded-full transition-colors
              ${enabled ? "bg-brett-gold" : "bg-white/10"}
            `}
          >
            <span
              className={`
                absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform
                ${enabled ? "translate-x-4" : "translate-x-0"}
              `}
            />
          </button>
        </label>

        {/* Dismissed status (only relevant when enabled) */}
        {enabled && isDismissedToday && (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/60">Dismissed for today</p>
              <p className="text-xs text-white/30 mt-0.5">
                Reappears tomorrow automatically.
              </p>
            </div>
            <button
              onClick={() => setDismissedDate(null)}
              className="text-xs text-brett-gold/90 hover:text-brett-gold-dark transition-colors px-3 py-1.5 rounded-lg hover:bg-white/5"
            >
              Show now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
