import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalStorageBoolean } from "../lib/useLocalStorageBoolean";
import { setStorageUser } from "../lib/userScopedStorage";

beforeEach(() => {
  localStorage.clear();
  // Default to a known user so the scoped key is stable across tests.
  setStorageUser("test-user");
});

describe("useLocalStorageBoolean", () => {
  it("returns default value when no key in storage", () => {
    const { result } = renderHook(() => useLocalStorageBoolean("test.key", false));
    expect(result.current[0]).toBe(false);
  });

  it("returns the explicit default when fallback=true", () => {
    const { result } = renderHook(() => useLocalStorageBoolean("test.key", true));
    expect(result.current[0]).toBe(true);
  });

  it("persists toggled value to localStorage", () => {
    const { result } = renderHook(() => useLocalStorageBoolean("test.key", false));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    // userScopedStorage appends `.user=<id>` — verify the actual key.
    expect(localStorage.getItem("test.key.user=test-user")).toBe("true");
  });

  it("reads existing value on mount", () => {
    localStorage.setItem("test.key.user=test-user", "true");
    const { result } = renderHook(() => useLocalStorageBoolean("test.key", false));
    expect(result.current[0]).toBe(true);
  });

  it("scopes state per user — two accounts on the same device don't share", () => {
    // Multi-user invariant from CLAUDE.md: UI state must not leak across
    // accounts on the same device.
    act(() => setStorageUser("alice"));
    const { result: aliceHook } = renderHook(() => useLocalStorageBoolean("test.key", false));
    act(() => aliceHook.current[1](true));

    act(() => setStorageUser("bob"));
    const { result: bobHook } = renderHook(() => useLocalStorageBoolean("test.key", false));
    expect(bobHook.current[0]).toBe(false); // bob should see fallback, not alice's true
  });

  it("re-reads from storage when scoped user changes mid-mount", () => {
    // Regression guard: if user A collapses a section and then signs out
    // and user B signs in WITHOUT this hook's host component unmounting,
    // B must see B's preference (fallback), not A's stored value. The hook
    // subscribes to `setStorageUser` for exactly this reason — relying
    // only on `key`-change re-sync would leak A's state into B's session.
    setStorageUser("alice");
    const { result } = renderHook(() => useLocalStorageBoolean("test.key", false));
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    // Same hook instance — pretend the user just switched.
    act(() => setStorageUser("bob"));
    expect(result.current[0]).toBe(false); // bob's fallback, not alice's true

    // And if carol had a pre-existing stored value, the hook should pick it up.
    localStorage.setItem("test.key.user=carol", "true");
    act(() => setStorageUser("carol"));
    expect(result.current[0]).toBe(true);
  });
});
