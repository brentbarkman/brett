const PREFS_KEY = "brett_preferences";

interface Preferences {
  showTokenUsage: boolean;
}

const DEFAULTS: Preferences = {
  showTokenUsage: false,
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
}
