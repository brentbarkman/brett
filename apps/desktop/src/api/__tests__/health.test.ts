import { describe, it, expect } from "vitest";
import {
  classifyHealthOutcome,
  nextHeartbeatDelay,
  HEALTHY_INTERVAL_MS,
  DEGRADED_INTERVAL_MS,
} from "../health";

/// Pure-function tests for the API health heartbeat. The hook itself
/// involves timers, AbortController, document.visibilityState — all
/// testable with @testing-library/react + fake timers, but the
/// meaningful decisions live in these two pure helpers, so we test
/// them directly and trust the React glue to do its job.
describe("classifyHealthOutcome", () => {
  it("treats 200 as healthy", () => {
    expect(classifyHealthOutcome({ kind: "response", status: 200 })).toBe("ok");
  });

  it("treats 204 (no content) as healthy", () => {
    expect(classifyHealthOutcome({ kind: "response", status: 204 })).toBe("ok");
  });

  it("treats 401 as healthy (auth issue, not transport)", () => {
    // Critical: a 401 means the user's session expired, not that the
    // platform is down. AuthGuard handles re-auth; the status banner
    // is for platform outages only.
    expect(classifyHealthOutcome({ kind: "response", status: 401 })).toBe("ok");
  });

  it("treats 502 (Railway gateway fallback) as unreachable", () => {
    expect(classifyHealthOutcome({ kind: "response", status: 502 })).toBe("unreachable");
  });

  it("treats 500 as unreachable", () => {
    expect(classifyHealthOutcome({ kind: "response", status: 500 })).toBe("unreachable");
  });

  it("treats 503 as unreachable", () => {
    expect(classifyHealthOutcome({ kind: "response", status: 503 })).toBe("unreachable");
  });

  it("treats 504 (gateway timeout) as unreachable", () => {
    expect(classifyHealthOutcome({ kind: "response", status: 504 })).toBe("unreachable");
  });

  it("treats network error (fetch reject / timeout) as unreachable", () => {
    expect(classifyHealthOutcome({ kind: "error" })).toBe("unreachable");
  });

  it("treats 404 as unreachable", () => {
    // /health should always exist; if it 404s, something's catastrophically
    // wrong with the deployed API.
    expect(classifyHealthOutcome({ kind: "response", status: 404 })).toBe("unreachable");
  });
});

describe("nextHeartbeatDelay", () => {
  // No-jitter case: jitter === 1.0 makes the math deterministic.
  it("uses the healthy interval when status is ok", () => {
    expect(nextHeartbeatDelay("ok", 30_000, 5_000, 1.0)).toBe(30_000);
  });

  it("uses the degraded interval when status is unreachable", () => {
    expect(nextHeartbeatDelay("unreachable", 30_000, 5_000, 1.0)).toBe(5_000);
  });

  it("applies jitter symmetrically around the baseline", () => {
    expect(nextHeartbeatDelay("ok", 1000, 200, 0.8)).toBe(800);
    expect(nextHeartbeatDelay("ok", 1000, 200, 1.2)).toBe(1200);
    expect(nextHeartbeatDelay("unreachable", 1000, 200, 0.8)).toBeCloseTo(160);
    expect(nextHeartbeatDelay("unreachable", 1000, 200, 1.2)).toBeCloseTo(240);
  });

  it("never returns a negative delay", () => {
    // Defensive: a buggy jitter value (negative, NaN) shouldn't put us
    // into a tight busy loop. Math.max(0, ...) protects against that.
    expect(nextHeartbeatDelay("ok", 1000, 200, -5)).toBe(0);
    expect(nextHeartbeatDelay("unreachable", 1000, 200, -1)).toBe(0);
  });

  it("uses module defaults that match the design", () => {
    // Regression guard: if someone bumps the constants without
    // realizing the design called for these specific values, this
    // test will surface the change.
    expect(HEALTHY_INTERVAL_MS).toBe(30_000);
    expect(DEGRADED_INTERVAL_MS).toBe(5_000);
  });
});
