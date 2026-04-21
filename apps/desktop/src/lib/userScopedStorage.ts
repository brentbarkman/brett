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

export function setStorageUser(userId: string | null): void {
  currentUserId = userId;
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
