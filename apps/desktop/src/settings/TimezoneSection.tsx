import React, { useState, useEffect, useMemo } from "react";
import { SettingsCard, SettingsHeader, SettingsToggle } from "./SettingsComponents";
import { Check } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const commonTimezones = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

export function TimezoneSection() {
  const qc = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ["user-me"],
    queryFn: () =>
      apiFetch<{
        timezone: string;
        timezoneAuto: boolean;
      }>("/users/me"),
  });

  const [isAuto, setIsAuto] = useState(true);
  const [selectedTz, setSelectedTz] = useState("America/Los_Angeles");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setIsAuto(user.timezoneAuto);
      setSelectedTz(user.timezone);
    }
  }, [user]);

  const allTimezones = useMemo(
    () => [...new Set([detectedTz, selectedTz, ...commonTimezones])].sort(),
    [selectedTz],
  );

  async function handleSave(tz: string, auto: boolean) {
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch("/users/timezone", {
        method: "PATCH",
        body: JSON.stringify({ timezone: tz, auto }),
      });
      setError(null);
      qc.invalidateQueries({ queryKey: ["user-me"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to update timezone:", err);
      setError("Failed to save. Try again.");
      setTimeout(() => setError(null), 4000);
    } finally {
      setSaving(false);
    }
  }

  function handleToggleAuto() {
    const newAuto = !isAuto;
    setIsAuto(newAuto);
    const tz = newAuto ? detectedTz : selectedTz;
    handleSave(tz, newAuto);
  }

  function handleTimezoneChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const tz = e.target.value;
    setSelectedTz(tz);
    handleSave(tz, false);
  }

  return (
    <SettingsCard>
      <div className="flex items-center gap-2 mb-4">
        <SettingsHeader className="mb-0">Timezone</SettingsHeader>
        {saved && (
          <Check size={14} className="text-emerald-400 ml-auto" />
        )}
      </div>
      {error && (
        <p className="text-xs text-red-400/80 mb-3">{error}</p>
      )}

      <div className="space-y-3">
        <div className="text-sm text-white/60">
          Current: <span className="text-white/80">{user?.timezone ?? (
            <span className="inline-block bg-white/5 animate-pulse rounded h-3.5 w-32 align-middle" />
          )}</span>
        </div>

        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-white/70">Use device timezone</span>
          <SettingsToggle
            checked={isAuto}
            onChange={handleToggleAuto}
            disabled={saving}
          />
        </label>

        {isAuto && (
          <p className="text-xs text-white/30">
            Detected: {detectedTz}
          </p>
        )}

        {!isAuto && (
          <select
            value={selectedTz}
            onChange={handleTimezoneChange}
            disabled={saving}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80
              focus:outline-none focus:border-brett-gold/50 disabled:opacity-50"
          >
            {allTimezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        )}
      </div>
    </SettingsCard>
  );
}
