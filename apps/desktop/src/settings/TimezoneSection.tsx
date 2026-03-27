import React, { useState, useEffect } from "react";
import { Globe, Check } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

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

  useEffect(() => {
    if (user) {
      setIsAuto(user.timezoneAuto);
      setSelectedTz(user.timezone);
    }
  }, [user]);

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

  const allTimezones = [
    ...new Set([detectedTz, selectedTz, ...commonTimezones]),
  ].sort();

  async function handleSave(tz: string, auto: boolean) {
    setSaving(true);
    setSaved(false);
    try {
      await apiFetch("/users/timezone", {
        method: "PATCH",
        body: JSON.stringify({ timezone: tz, auto }),
      });
      qc.invalidateQueries({ queryKey: ["user-me"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Failed to update timezone:", err);
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
    <section className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
      <div className="flex items-center gap-2 mb-4">
        <Globe size={16} className="text-white/50" />
        <h2 className="text-sm font-semibold text-white/90">Timezone</h2>
        {saved && (
          <Check size={14} className="text-emerald-400 ml-auto" />
        )}
      </div>

      <div className="space-y-3">
        <div className="text-sm text-white/60">
          Current: <span className="text-white/80">{user?.timezone ?? "..."}</span>
        </div>

        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-white/70">Use device timezone</span>
          <button
            onClick={handleToggleAuto}
            disabled={saving}
            className={`
              relative w-9 h-5 rounded-full transition-colors
              ${isAuto ? "bg-blue-500" : "bg-white/10"}
              ${saving ? "opacity-50" : ""}
            `}
          >
            <span
              className={`
                absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform
                ${isAuto ? "translate-x-4" : "translate-x-0"}
              `}
            />
          </button>
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
              focus:outline-none focus:border-blue-500/50 disabled:opacity-50"
          >
            {allTimezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        )}
      </div>
    </section>
  );
}
