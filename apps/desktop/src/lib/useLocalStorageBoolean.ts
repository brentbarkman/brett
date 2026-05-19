import { useCallback, useEffect, useState } from "react";
import { userStorage } from "./userScopedStorage";

/**
 * Per-user persisted boolean state for UI affordances (collapsed sections,
 * dismissed banners, etc.).
 *
 * Uses `userStorage` (apps/desktop/src/lib/userScopedStorage.ts) under the
 * hood, so two accounts on the same machine don't share collapsed-state.
 *
 * `key` is the base key — `userStorage` appends `.user=<id>` automatically.
 * Pick names like `today.section.this-week.open` (feature.subkey.what).
 */
function read(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = userStorage.getItem(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function useLocalStorageBoolean(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => read(key, fallback));

  // Re-sync if the key changes (rare — defensive). Intentionally NOT
  // depending on `fallback`: changing the default after first render should
  // not clobber a user's explicit choice.
  useEffect(() => {
    setValue(read(key, fallback));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: boolean) => {
      setValue(next);
      try {
        userStorage.setItem(key, next ? "true" : "false");
      } catch {
        // localStorage unavailable — in-memory state still works.
      }
    },
    [key],
  );

  return [value, update];
}
