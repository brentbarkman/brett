import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { MapPin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { useLocationSettings, useCitySearch } from "../api/location";
import { useAssistantName, useUpdateAssistantName } from "../api/assistant-name";
import { Wordmark } from "@brett/ui";

export function LocationSection() {
  const { data: user } = useQuery({
    queryKey: ["user-me"],
    queryFn: () =>
      apiFetch<{
        timezoneAuto: boolean;
        weatherEnabled: boolean;
        city: string | null;
        tempUnit: "auto" | "fahrenheit" | "celsius";
      }>("/users/me"),
  });

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
    }
  }, [user]);

  useEffect(() => {
    const shouldShow = results.length > 0 && query.length >= 2;
    setShowDropdown(shouldShow);
    if (shouldShow) updateDropdownPos();
  }, [results, query, updateDropdownPos]);

  // Close dropdown on outside click
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

  async function handleSave(patch: Parameters<typeof updateLocation>[0]) {
    try {
      await updateLocation(patch);
      setError(null);
    } catch (err) {
      console.error("Failed to save location settings:", err);
      setError("Failed to save. Try again.");
      setTimeout(() => setError(null), 4000);
    }
  }

  async function handleWeatherToggle() {
    const newEnabled = !weatherEnabled;
    setWeatherEnabled(newEnabled);
    await handleSave({ weatherEnabled: newEnabled });
  }

  async function handleTempUnitChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const unit = e.target.value as "auto" | "fahrenheit" | "celsius";
    setTempUnit(unit);
    await handleSave({ tempUnit: unit });
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

    // Only update timezone if user has manual timezone control
    if (user && !user.timezoneAuto) {
      patch.timezone = result.timezone;
    }

    await handleSave(patch as Parameters<typeof updateLocation>[0]);
  }

  const currentAssistantName = useAssistantName();
  const [assistantNameInput, setAssistantNameInput] = useState(currentAssistantName);
  const updateAssistantName = useUpdateAssistantName();

  async function handleAssistantNameSave() {
    const trimmed = assistantNameInput.trim();
    if (!trimmed || trimmed === currentAssistantName) return;
    try {
      await updateAssistantName.mutateAsync(trimmed);
    } catch (err) {
      console.error("Failed to save assistant name:", err);
      setError("Failed to update assistant name.");
      setTimeout(() => setError(null), 4000);
    }
  }

  return (
    <div className="space-y-4">
      {/* Assistant name */}
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-4">
          Assistant
        </h3>
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
          <p className="text-[10px] text-white/30">{assistantNameInput.length}/10</p>
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={handleAssistantNameSave}
            disabled={assistantNameInput.trim() === currentAssistantName || updateAssistantName.isPending}
            className="bg-brett-gold text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brett-gold-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {updateAssistantName.isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Weather & Location */}
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
        <div className="flex items-center gap-2 mb-4">
          <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold">
            Weather &amp; Location
          </h3>
        </div>

      {error && <p className="text-xs text-red-400/80 mb-3">{error}</p>}

      <div className="space-y-4">
        {/* Weather enabled toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <span className="text-sm text-white/70">Show weather</span>
          <button
            onClick={handleWeatherToggle}
            disabled={isSaving}
            className={`
              relative w-9 h-5 rounded-full transition-colors
              ${weatherEnabled ? "bg-brett-gold" : "bg-white/10"}
              ${isSaving ? "opacity-50" : ""}
            `}
          >
            <span
              className={`
                absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform
                ${weatherEnabled ? "translate-x-4" : "translate-x-0"}
              `}
            />
          </button>
        </label>

        {weatherEnabled && (
          <>
            {/* City search */}
            <div className="space-y-1.5">
              <div ref={inputWrapperRef} className="relative">
                <MapPin
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
                />
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
                  className={`w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm
                    focus:outline-none focus:border-brett-gold/50
                    ${query ? "text-white/80 placeholder:text-white/20" : user?.city ? "text-white/80 placeholder:text-white/70" : "text-white/80 placeholder:text-white/20"}`}
                />
                {isSearching && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border border-white/20 border-t-white/60 animate-spin" />
                )}
              </div>

              {/* Search results dropdown — portal to escape scroll container */}
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
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80
                  focus:outline-none focus:border-brett-gold/50 disabled:opacity-50"
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
