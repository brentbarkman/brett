import React from "react";
import { usePreference } from "../api/preferences";
import { SettingsCard, SettingsHeader, SettingsToggle } from "./SettingsComponents";

export function BriefingSection() {
  const [enabled, setEnabled] = usePreference("briefingEnabled");

  return (
    <SettingsCard>
      <SettingsHeader>Daily Briefing</SettingsHeader>

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-white/70">Show daily briefing</span>
        <SettingsToggle
          checked={enabled}
          onChange={() => setEnabled(!enabled)}
        />
      </label>
    </SettingsCard>
  );
}
