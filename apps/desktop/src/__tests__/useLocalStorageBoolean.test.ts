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
    setStorageUser("alice");
    const { result: aliceHook } = renderHook(() => useLocalStorageBoolean("test.key", false));
    act(() => aliceHook.current[1](true));

    setStorageUser("bob");
    const { result: bobHook } = renderHook(() => useLocalStorageBoolean("test.key", false));
    expect(bobHook.current[0]).toBe(false); // bob should see fallback, not alice's true
  });
});
