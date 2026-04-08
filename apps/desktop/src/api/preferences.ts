import { useState, useEffect } from "react";

const PREFS_KEY = "brett_preferences";
const PREFS_EVENT = "brett_preferences_changed";

interface Preferences {
  showTokenUsage: boolean;
  /** Whether the daily briefing is enabled (shown on Today view) */
  briefingEnabled: boolean;
  /** ISO date string (YYYY-MM-DD) of when the briefing was last dismissed */
  briefingDismissedDate: string | null;
}

const DEFAULTS: Preferences = {
  showTokenUsage: false,
  briefingEnabled: true,
  briefingDismissedDate: null,
};

export function getPreferences(): Preferences {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  const current = getPreferences();
  current[key] = value;
  localStorage.setItem(PREFS_KEY, JSON.stringify(current));
  // Notify other components that preferences changed
  window.dispatchEvent(new CustomEvent(PREFS_EVENT));
}

/** Reactive hook — re-renders when any preference changes */
export function usePreference<K extends keyof Preferences>(key: K): [Preferences[K], (value: Preferences[K]) => void] {
  const [value, setValue] = useState(() => getPreferences()[key]);

  useEffect(() => {
    const handler = () => setValue(getPreferences()[key]);
    window.addEventListener(PREFS_EVENT, handler);
    return () => window.removeEventListener(PREFS_EVENT, handler);
  }, [key]);

  const update = (newValue: Preferences[K]) => {
    setPreference(key, newValue);
    setValue(newValue);
  };

  return [value, update];
}
