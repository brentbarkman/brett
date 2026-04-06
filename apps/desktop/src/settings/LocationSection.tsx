import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Brain, Check, MapPin, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useLocationSettings, useCitySearch } from "../api/location";
import { useAssistantName, useUpdateAssistantName } from "../api/assistant-name";
import { usePreference } from "../api/preferences";
import { useUserFacts, useDeleteUserFact } from "../api/user-facts";
import { useAIConfigs } from "../api/ai-config";
import { Wordmark } from "@brett/ui";

// ── Timezone helpers ──

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

// ── Memory fact row ──

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  preference: { label: "Preference", color: "text-brett-gold" },
  context: { label: "Context", color: "text-brett-teal" },
  relationship: { label: "Relationship", color: "text-purple-400" },
  habit: { label: "Habit", color: "text-amber-400" },
};

function FactRow({
  fact,
  onDelete,
  isDeleting,
}: {
  fact: { id: string; category: string; key: string; value: string };
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const categoryInfo = CATEGORY_LABELS[fact.category] ?? {
    label: fact.category,
    color: "text-white/40",
  };

  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5 bg-white/5 rounded-lg">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${categoryInfo.color}`}>
            {categoryInfo.label}
          </span>
        </div>
        <p className="text-sm text-white/80 leading-relaxed">{fact.value}</p>
      </div>
      <div className="flex items-center flex-shrink-0 mt-0.5">
        {confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40">Remove?</span>
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors disabled:opacity-40"
            >
              {isDeleting ? "Removing..." : "Yes"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="flex items-center gap-1 text-xs text-white/30 hover:text-red-400 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ──

export function LocationSection() {
  const qc = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ["user-me"],
    queryFn: () =>
      apiFetch<{
        timezoneAuto: boolean;
        weatherEnabled: boolean;
        city: string | null;
        tempUnit: "auto" | "fahrenheit" | "celsius";
        timezone: string;
      }>("/users/me"),
  });

  // ── Location & weather state ──
  const { updateLocation, isSaving } = useLocationSettings();
  const { query, setQuery, results, isSearching } = useCitySearch();
  const [weatherEnabled, setWeatherEnabled] = useState(true);
  const [tempUnit, setTempUnit] = useState<"auto" | "fahrenheit" | "celsius">("auto");
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Timezone state ──
  const [isAuto, setIsAuto] = useState(true);
  const [selectedTz, setSelectedTz] = useState("America/Los_Angeles");
  const [tzSaving, setTzSaving] = useState(false);
  const [tzSaved, setTzSaved] = useState(false);

  // ── Assistant name state ──
  const currentAssistantName = useAssistantName();
  const [assistantNameInput, setAssistantNameInput] = useState(currentAssistantName);
  const updateAssistantName = useUpdateAssistantName();

  // ── Briefing state ──
  const [briefingEnabled, setBriefingEnabled] = usePreference("briefingEnabled");
  const [dismissedDate, setDismissedDate] = usePreference("briefingDismissedDate");
  const today = new Date().toLocaleDateString("en-CA");
  const isDismissedToday = dismissedDate === today;

  // ── Memory state ──
  const { data: factsData, isLoading: factsLoading, error: factsError } = useUserFacts();
  const deleteFact = useDeleteUserFact();
  const { data: aiConfigData } = useAIConfigs();
  const hasAI = (aiConfigData?.configs ?? []).some((c) => c.isActive && c.isValid);
  const facts = factsData?.facts ?? [];

  const allTimezones = useMemo(
    () => [...new Set([detectedTz, selectedTz, ...commonTimezones])].sort(),
    [selectedTz],
  );

  // ── Effects ──

  const updateDropdownPos = useCallback(() => {
    const el = inputWrapperRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (user) {
      setWeatherEnabled(user.weatherEnabled);
      setTempUnit(user.tempUnit);
      setIsAuto(user.timezoneAuto);
      setSelectedTz(user.timezone);
    }
  }, [user]);

  useEffect(() => {
    const shouldShow = results.length > 0 && query.length >= 2;
    setShowDropdown(shouldShow);
    if (shouldShow) updateDropdownPos();
  }, [results, query, updateDropdownPos]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── Handlers ──

  async function handleLocationSave(patch: Parameters<typeof updateLocation>[0]) {
    try {
      await updateLocation(patch);
      setError(null);
    } catch (err) {
      console.error("Failed to save location settings:", err);
      setError("Failed to save. Try again.");
      setTimeout(() => setError(null), 3000);
    }
  }

  async function handleWeatherToggle() {
    const newEnabled = !weatherEnabled;
    setWeatherEnabled(newEnabled);
    await handleLocationSave({ weatherEnabled: newEnabled });
  }

  async function handleTempUnitChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const unit = e.target.value as "auto" | "fahrenheit" | "celsius";
    setTempUnit(unit);
    await handleLocationSave({ tempUnit: unit });
  }

  async function handleCitySelect(result: {
    name: string;
    latitude: number;
    longitude: number;
    countryCode: string;
    timezone: string;
    displayName: string;
  }) {
    setQuery("");
    setShowDropdown(false);
    const patch: Parameters<typeof updateLocation>[0] & { countryCode?: string } = {
      city: result.name,
      latitude: result.latitude,
      longitude: result.longitude,
      countryCode: result.countryCode,
    };
    if (user && !user.timezoneAuto) {
      patch.timezone = result.timezone;
    }
    await handleLocationSave(patch as Parameters<typeof updateLocation>[0]);
  }

  async function handleTimezoneSave(tz: string, auto: boolean) {
    setTzSaving(true);
    setTzSaved(false);
    try {
      await apiFetch("/users/timezone", {
        method: "PATCH",
        body: JSON.stringify({ timezone: tz, auto }),
      });
      setError(null);
      qc.invalidateQueries({ queryKey: ["user-me"] });
      setTzSaved(true);
      setTimeout(() => setTzSaved(false), 2000);
    } catch (err) {
      console.error("Failed to update timezone:", err);
      setError("Failed to save. Try again.");
      setTimeout(() => setError(null), 3000);
    } finally {
      setTzSaving(false);
    }
  }

  function handleToggleAuto() {
    const newAuto = !isAuto;
    setIsAuto(newAuto);
    handleTimezoneSave(newAuto ? detectedTz : selectedTz, newAuto);
  }

  function handleTimezoneChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const tz = e.target.value;
    setSelectedTz(tz);
    handleTimezoneSave(tz, false);
  }

  async function handleAssistantNameSave() {
    const trimmed = assistantNameInput.trim();
    if (!trimmed || trimmed === currentAssistantName) return;
    try {
      await updateAssistantName.mutateAsync(trimmed);
    } catch (err) {
      console.error("Failed to save assistant name:", err);
      setError("Failed to update assistant name.");
      setTimeout(() => setError(null), 3000);
    }
  }

  // ── Render ──

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-400/80">{error}</p>}

      {/* ═══ Assistant ═══ */}
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-4">
          Assistant
        </h3>

        <div className="space-y-5">
          {/* Name */}
          <div className="space-y-2">
            <label htmlFor="settings-assistant-name" className="text-sm text-white/70">
              Name your assistant
            </label>
            <div className="flex items-center gap-3">
              <input
                id="settings-assistant-name"
                type="text"
                value={assistantNameInput}
                onChange={(e) => {
                  if (e.target.value.length <= 10) setAssistantNameInput(e.target.value);
                }}
                maxLength={10}
                placeholder="Brett"
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-brett-gold/50 focus:ring-1 focus:ring-brett-gold/50 focus:outline-none"
              />
              <Wordmark name={assistantNameInput.trim() || "Brett"} size={16} />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-white/30">{assistantNameInput.length}/10</p>
              <button
                onClick={handleAssistantNameSave}
                disabled={assistantNameInput.trim() === currentAssistantName || updateAssistantName.isPending}
                className="bg-brett-gold text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-brett-gold-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {updateAssistantName.isPending ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-white/10" />

          {/* Daily briefing */}
          <div className="space-y-3">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-white/70">Daily briefing</span>
              <button
                onClick={() => setBriefingEnabled(!briefingEnabled)}
                className={`relative w-9 h-5 rounded-full transition-colors ${briefingEnabled ? "bg-brett-gold" : "bg-white/10"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${briefingEnabled ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </label>

            {briefingEnabled && isDismissedToday && (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/60">Dismissed for today</p>
                  <p className="text-xs text-white/30 mt-0.5">Reappears tomorrow automatically.</p>
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

          {/* Divider */}
          <div className="h-px bg-white/10" />

          {/* Memory */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-3">
              Memory
            </h4>

            {factsLoading && (
              <div className="space-y-2">
                <div className="bg-white/5 animate-pulse rounded-lg h-10 w-full" />
                <div className="bg-white/5 animate-pulse rounded-lg h-8 w-2/3" />
              </div>
            )}

            {factsError && (
              <div className="text-sm text-red-400 mb-4">Failed to load memory.</div>
            )}

            {!factsLoading && facts.length > 0 && (
              <div className="space-y-2">
                {facts.map((fact) => (
                  <FactRow
                    key={fact.id}
                    fact={fact}
                    onDelete={() => deleteFact.mutate(fact.id)}
                    isDeleting={deleteFact.isPending && deleteFact.variables === fact.id}
                  />
                ))}
              </div>
            )}

            {!factsLoading && !factsError && facts.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <Brain size={24} className="text-white/20" />
                <p className="text-xs text-white/30">
                  {hasAI
                    ? `${currentAssistantName} hasn't learned anything about you yet. It will pick up on your preferences as you chat.`
                    : `Configure an AI provider to enable ${currentAssistantName}'s memory.`}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Location, Timezone & Weather ═══ */}
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-4">
          Location &amp; Weather
        </h3>

        <div className="space-y-4">
          {/* Timezone */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/60">
                Timezone: <span className="text-white/80">{user?.timezone ?? (
                  <span className="inline-block bg-white/5 animate-pulse rounded h-3.5 w-32 align-middle" />
                )}</span>
              </span>
              {tzSaved && <Check size={14} className="text-emerald-400 ml-auto" />}
            </div>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm text-white/70">Use device timezone</span>
              <button
                onClick={handleToggleAuto}
                disabled={tzSaving}
                className={`relative w-9 h-5 rounded-full transition-colors ${isAuto ? "bg-brett-gold" : "bg-white/10"} ${tzSaving ? "opacity-50" : ""}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isAuto ? "translate-x-4" : "translate-x-0"}`} />
              </button>
            </label>

            {isAuto && (
              <p className="text-xs text-white/30">Detected: {detectedTz}</p>
            )}

            {!isAuto && (
              <select
                value={selectedTz}
                onChange={handleTimezoneChange}
                disabled={tzSaving}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-brett-gold/50 disabled:opacity-50"
              >
                {allTimezones.map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                ))}
              </select>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-white/10" />

          {/* Weather */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-sm text-white/70">Show weather</span>
            <button
              onClick={handleWeatherToggle}
              disabled={isSaving}
              className={`relative w-9 h-5 rounded-full transition-colors ${weatherEnabled ? "bg-brett-gold" : "bg-white/10"} ${isSaving ? "opacity-50" : ""}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${weatherEnabled ? "translate-x-4" : "translate-x-0"}`} />
            </button>
          </label>

          {weatherEnabled && (
            <>
              {/* City search */}
              <div className="space-y-1.5">
                <div ref={inputWrapperRef} className="relative">
                  <MapPin size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => {
                      if (results.length > 0) {
                        updateDropdownPos();
                        setShowDropdown(true);
                      }
                    }}
                    placeholder={user?.city ?? "Search city…"}
                    className={`w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-brett-gold/50 ${query ? "text-white/80 placeholder:text-white/20" : user?.city ? "text-white/80 placeholder:text-white/70" : "text-white/80 placeholder:text-white/20"}`}
                  />
                  {isSearching && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border border-white/20 border-t-white/60 animate-spin" />
                  )}
                </div>

                {showDropdown && dropdownPos && createPortal(
                  <div
                    ref={dropdownRef}
                    className="fixed z-[9999] bg-black/80 backdrop-blur-2xl border border-white/10 rounded-xl overflow-hidden shadow-2xl"
                    style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
                  >
                    {results.map((result, i) => (
                      <button
                        key={`${result.latitude}-${result.longitude}-${i}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleCitySelect(result);
                        }}
                        className="flex items-center gap-2.5 w-full px-3 py-2 text-left hover:bg-white/10 transition-colors"
                      >
                        <MapPin size={12} className="text-white/30 flex-shrink-0" />
                        <span className="text-sm text-white/80 truncate">{result.displayName}</span>
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
              </div>

              {/* Temperature unit */}
              <div className="space-y-1.5">
                <label className="text-sm text-white/70">Temperature unit</label>
                <select
                  value={tempUnit}
                  onChange={handleTempUnitChange}
                  disabled={isSaving}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:border-brett-gold/50 disabled:opacity-50"
                >
                  <option value="auto">Auto (from locale)</option>
                  <option value="fahrenheit">Fahrenheit (°F)</option>
                  <option value="celsius">Celsius (°C)</option>
                </select>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
