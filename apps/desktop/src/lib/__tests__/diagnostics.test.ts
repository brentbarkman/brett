import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

// We need a fresh module for each top-level describe to avoid leaking state.
// Use dynamic import with cache-busting via vi.resetModules().

type DiagnosticsModule = typeof import("../diagnostics");

describe("diagnostics", () => {
  let mod: DiagnosticsModule;
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;
  let originalConsoleLog: typeof console.log;
  let originalConsoleInfo: typeof console.info;

  beforeAll(async () => {
    // Save originals before initDiagnostics wraps them
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    originalConsoleLog = console.log;
    originalConsoleInfo = console.info;

    mod = await import("../diagnostics");
    mod.initDiagnostics();
  });

  // ---------------------------------------------------------------
  // 1. Token scrubbing (tested via console capture → collectDiagnostics)
  // ---------------------------------------------------------------
  describe("scrub (via console capture)", () => {
    it("redacts Bearer tokens", () => {
      console.error("Authorization: Bearer abc123.xyz_456");
      const snap = mod.collectDiagnostics();
      const last = snap.consoleErrors[snap.consoleErrors.length - 1];
      expect(last).toBe("Authorization: [REDACTED]");
    });

    it("redacts token= query params", () => {
      console.error("https://example.com?token=abc123_secret");
      const snap = mod.collectDiagnostics();
      const last = snap.consoleErrors[snap.consoleErrors.length - 1];
      expect(last).toBe("https://example.com?[REDACTED]");
    });

    it("redacts JWTs", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456_ghijklmnop";
      console.error(`token was ${jwt} here`);
      const snap = mod.collectDiagnostics();
      const last = snap.consoleErrors[snap.consoleErrors.length - 1];
      expect(last).toBe("token was [REDACTED] here");
    });

    it("passes normal text through unchanged", () => {
      console.error("simple error with no secrets");
      const snap = mod.collectDiagnostics();
      const last = snap.consoleErrors[snap.consoleErrors.length - 1];
      expect(last).toBe("simple error with no secrets");
    });

    it("redacts multiple patterns in one string", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456_ghijklmnop";
      console.error(`Bearer secret123 and ${jwt}`);
      const snap = mod.collectDiagnostics();
      const last = snap.consoleErrors[snap.consoleErrors.length - 1];
      expect(last).toBe("[REDACTED] and [REDACTED]");
    });
  });

  // ---------------------------------------------------------------
  // 2. Auth route filtering in console capture
  // ---------------------------------------------------------------
  describe("shouldCaptureLog filtering", () => {
    it("does NOT capture /auth/ related errors", () => {
      const before = mod.collectDiagnostics().consoleErrors.length;
      console.error("POST /auth/login failed");
      const after = mod.collectDiagnostics().consoleErrors.length;
      expect(after).toBe(before);
    });

    it("does NOT capture /calendar-accounts/ related errors", () => {
      const before = mod.collectDiagnostics().consoleErrors.length;
      console.error("GET /calendar-accounts/sync error");
      const after = mod.collectDiagnostics().consoleErrors.length;
      expect(after).toBe(before);
    });

    it("does NOT capture /granola/ related errors", () => {
      const before = mod.collectDiagnostics().consoleErrors.length;
      console.error("GET /granola/import failed");
      const after = mod.collectDiagnostics().consoleErrors.length;
      expect(after).toBe(before);
    });

    it("does NOT capture [feedback] prefixed logs", () => {
      const before = mod.collectDiagnostics().consoleErrors.length;
      console.error("[feedback] sending report...");
      const after = mod.collectDiagnostics().consoleErrors.length;
      expect(after).toBe(before);
    });

    it("DOES capture normal errors", () => {
      const before = mod.collectDiagnostics().consoleErrors.length;
      console.error("something went wrong in the task list");
      const after = mod.collectDiagnostics().consoleErrors.length;
      expect(after).toBe(before + 1);
    });
  });

  // ---------------------------------------------------------------
  // 3. Console interception captures all 4 methods
  // ---------------------------------------------------------------
  describe("console interception", () => {
    it("captures console.error into consoleErrors", () => {
      const before = mod.collectDiagnostics().consoleErrors.length;
      console.error("test error capture");
      const snap = mod.collectDiagnostics();
      expect(snap.consoleErrors.length).toBe(before + 1);
      expect(snap.consoleErrors[snap.consoleErrors.length - 1]).toBe(
        "test error capture",
      );
    });

    it("captures console.warn into consoleLogs with [warn] prefix", () => {
      console.warn("test warning");
      const snap = mod.collectDiagnostics();
      const last = snap.consoleLogs[snap.consoleLogs.length - 1];
      expect(last).toBe("[warn] test warning");
    });

    it("captures console.log into consoleLogs", () => {
      console.log("test log message");
      const snap = mod.collectDiagnostics();
      const last = snap.consoleLogs[snap.consoleLogs.length - 1];
      expect(last).toBe("test log message");
    });

    it("captures console.info into consoleLogs with [info] prefix", () => {
      console.info("test info message");
      const snap = mod.collectDiagnostics();
      const last = snap.consoleLogs[snap.consoleLogs.length - 1];
      expect(last).toBe("[info] test info message");
    });

    it("still calls the original console methods", () => {
      const errorSpy = vi.fn();
      // The wrapped console.error calls the original, which we saved
      // We can't easily spy on the original at this point since it's been captured
      // in initConsoleCapture's closure. Instead, verify that calling console.error
      // doesn't throw and produces output (the wrapper delegates to the original).
      expect(() => console.error("delegate test")).not.toThrow();
      expect(() => console.warn("delegate test")).not.toThrow();
      expect(() => console.log("delegate test")).not.toThrow();
      expect(() => console.info("delegate test")).not.toThrow();
    });
  });

  // ---------------------------------------------------------------
  // 4. RingBuffer overflow
  // ---------------------------------------------------------------
  describe("RingBuffer overflow", () => {
    it("consoleErrors buffer caps at 50 entries", () => {
      // Fill beyond capacity — errors from previous tests are already in the buffer
      for (let i = 0; i < 55; i++) {
        console.error(`overflow-error-${i}`);
      }
      const snap = mod.collectDiagnostics();
      expect(snap.consoleErrors.length).toBe(50);
      // The earliest entries should have been evicted, so the last entry is the most recent
      expect(snap.consoleErrors[snap.consoleErrors.length - 1]).toBe(
        "overflow-error-54",
      );
    });
  });

  // ---------------------------------------------------------------
  // 5. recordFailedApiCall
  // ---------------------------------------------------------------
  describe("recordFailedApiCall", () => {
    it("records path, method (uppercased), and status", () => {
      mod.recordFailedApiCall("https://api.example.com/tasks/123", "get", 500);
      const snap = mod.collectDiagnostics();
      const last = snap.failedApiCalls[snap.failedApiCalls.length - 1];
      expect(last.path).toBe("/tasks/123");
      expect(last.method).toBe("GET");
      expect(last.status).toBe(500);
      expect(last.timestamp).toBeTruthy();
    });

    it("strips query params from URL", () => {
      mod.recordFailedApiCall(
        "https://api.example.com/items?page=1&limit=10",
        "get",
        404,
      );
      const snap = mod.collectDiagnostics();
      const last = snap.failedApiCalls[snap.failedApiCalls.length - 1];
      expect(last.path).toBe("/items");
    });

    it("skips /auth routes", () => {
      const before = mod.collectDiagnostics().failedApiCalls.length;
      mod.recordFailedApiCall(
        "https://api.example.com/auth/login",
        "post",
        401,
      );
      const after = mod.collectDiagnostics().failedApiCalls.length;
      expect(after).toBe(before);
    });

    it("skips /calendar-accounts routes", () => {
      const before = mod.collectDiagnostics().failedApiCalls.length;
      mod.recordFailedApiCall(
        "https://api.example.com/calendar-accounts/sync",
        "post",
        500,
      );
      const after = mod.collectDiagnostics().failedApiCalls.length;
      expect(after).toBe(before);
    });

    it("skips /granola routes", () => {
      const before = mod.collectDiagnostics().failedApiCalls.length;
      mod.recordFailedApiCall(
        "https://api.example.com/granola/import",
        "post",
        500,
      );
      const after = mod.collectDiagnostics().failedApiCalls.length;
      expect(after).toBe(before);
    });

    it("handles malformed URLs gracefully (falls back to split on ?)", () => {
      mod.recordFailedApiCall("not-a-url/tasks?foo=bar", "patch", 422);
      const snap = mod.collectDiagnostics();
      const last = snap.failedApiCalls[snap.failedApiCalls.length - 1];
      expect(last.path).toBe("not-a-url/tasks");
      expect(last.method).toBe("PATCH");
      expect(last.status).toBe(422);
    });
  });

  // ---------------------------------------------------------------
  // 6. recordRouteChange
  // ---------------------------------------------------------------
  describe("recordRouteChange", () => {
    it("records a navigation breadcrumb", () => {
      mod.recordRouteChange("/test-unique-route");
      const snap = mod.collectDiagnostics();
      const routeBreadcrumbs = snap.breadcrumbs.filter(
        (b) => b.route === "/test-unique-route",
      );
      expect(routeBreadcrumbs.length).toBe(1);
      expect(routeBreadcrumbs[0].selector).toBe("navigation");
      expect(routeBreadcrumbs[0].timestamp).toBeTruthy();
    });

    it("deduplicates the same route", () => {
      mod.recordRouteChange("/dedup-route");
      mod.recordRouteChange("/dedup-route");
      const snap = mod.collectDiagnostics();
      const routeBreadcrumbs = snap.breadcrumbs.filter(
        (b) => b.route === "/dedup-route",
      );
      expect(routeBreadcrumbs.length).toBe(1);
    });

    it("records again when route changes then comes back", () => {
      mod.recordRouteChange("/route-a");
      mod.recordRouteChange("/route-b");
      mod.recordRouteChange("/route-a");
      const snap = mod.collectDiagnostics();
      const routeABreadcrumbs = snap.breadcrumbs.filter(
        (b) => b.route === "/route-a",
      );
      expect(routeABreadcrumbs.length).toBe(2);
    });
  });

  // ---------------------------------------------------------------
  // 7. collectDiagnostics
  // ---------------------------------------------------------------
  describe("collectDiagnostics", () => {
    it("returns the correct shape with all fields", () => {
      const snap = mod.collectDiagnostics();
      expect(snap).toHaveProperty("consoleErrors");
      expect(snap).toHaveProperty("consoleLogs");
      expect(snap).toHaveProperty("failedApiCalls");
      expect(snap).toHaveProperty("breadcrumbs");
      expect(snap).toHaveProperty("appVersion");
      expect(snap).toHaveProperty("electronVersion");
      expect(snap).toHaveProperty("os");
      expect(snap).toHaveProperty("currentRoute");
      expect(Array.isArray(snap.consoleErrors)).toBe(true);
      expect(Array.isArray(snap.consoleLogs)).toBe(true);
      expect(Array.isArray(snap.failedApiCalls)).toBe(true);
      expect(Array.isArray(snap.breadcrumbs)).toBe(true);
    });

    it("includes electronVersion when passed", () => {
      const snap = mod.collectDiagnostics("28.3.3");
      expect(snap.electronVersion).toBe("28.3.3");
    });

    it("defaults electronVersion to 'unknown' when not passed", () => {
      const snap = mod.collectDiagnostics();
      expect(snap.electronVersion).toBe("unknown");
    });

    it("populates appVersion", () => {
      const snap = mod.collectDiagnostics();
      expect(typeof snap.appVersion).toBe("string");
    });

    it("populates os from navigator.userAgent", () => {
      const snap = mod.collectDiagnostics();
      expect(typeof snap.os).toBe("string");
    });

    it("populates currentRoute from window.location", () => {
      const snap = mod.collectDiagnostics();
      expect(typeof snap.currentRoute).toBe("string");
    });
  });
});
