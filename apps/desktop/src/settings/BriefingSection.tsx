import React from "react";
import { usePreference } from "../api/preferences";
import { SettingsCard, SettingsHeader, SettingsToggle } from "./SettingsComponents";

export function BriefingSection() {
  const [enabled, setEnabled] = usePreference("briefingEnabled");
  const [dismissedDate, setDismissedDate] = usePreference("briefingDismissedDate");

  const today = new Date().toLocaleDateString("en-CA");
  const isDismissedToday = dismissedDate === today;

  return (
    <SettingsCard>
      <SettingsHeader>Daily Briefing</SettingsHeader>

      <div className="space-y-4">
        {/* Enable/disable toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-white/70">Show daily briefing</span>
          <SettingsToggle
            checked={enabled}
            onChange={() => setEnabled(!enabled)}
          />
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
    </SettingsCard>
  );
}
