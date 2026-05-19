/**
 * Thin `localStorage` wrapper that scopes keys to the current user ID so
 * preferences/UI state from one account don't leak into another when both
 * sign in on the same device. Falls back to an `anon` suffix for callers
 * that run before auth (e.g., the login page itself).
 *
 * Call `setStorageUser(userId)` once after sign-in resolves (and `null` on
 * sign-out). All get/set calls below use that ID.
 */

let currentUserId: string | null = null;
const subscribers = new Set<(userId: string | null) => void>();

export function setStorageUser(userId: string | null): void {
  if (currentUserId === userId) return;
  currentUserId = userId;
  // Fire-and-forget notify — subscribers are React hooks re-syncing local
  // state, so they must be cheap. Snapshot before iterating in case a
  // subscriber unsubscribes synchronously.
  for (const fn of Array.from(subscribers)) {
    fn(userId);
  }
}

export function getStorageUser(): string | null {
  return currentUserId;
}

/**
 * Subscribe to user-switch events. Returns an unsubscribe function.
 *
 * Used by `useLocalStorageBoolean` (and any future user-scoped hook) to
 * re-read storage after `setStorageUser` flips. Without this, a hook that
 * mounted under user A and stayed mounted across a sign-out + sign-in
 * to user B would keep showing A's value.
 */
export function subscribeToStorageUser(
  fn: (userId: string | null) => void,
): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

function scopedKey(base: string): string {
  return `${base}.user=${currentUserId ?? "anon"}`;
}

export const userStorage = {
  getItem(base: string): string | null {
    return localStorage.getItem(scopedKey(base));
  },
  setItem(base: string, value: string): void {
    localStorage.setItem(scopedKey(base), value);
  },
  removeItem(base: string): void {
    localStorage.removeItem(scopedKey(base));
  },
};
