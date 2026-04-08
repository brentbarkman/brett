// apps/desktop/src/lib/diagnostics.ts

// --- Token scrubbing ---

const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /token=[A-Za-z0-9._\-]+/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

const AUTH_ROUTE_PATTERNS = [/\/auth/, /\/calendar-accounts/, /\/granola/];

function scrub(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

/** Check if the current route or text content relates to auth flows */
function isAuthRelated(text: string): boolean {
  return AUTH_ROUTE_PATTERNS.some((p) => p.test(text));
}

// --- Ring buffer ---

class RingBuffer<T> {
  private items: T[] = [];
  constructor(private maxSize: number) {}

  push(item: T) {
    this.items.push(item);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  snapshot(): T[] {
    return [...this.items];
  }

  clear() {
    this.items = [];
  }
}

// --- Buffers ---

const consoleErrors = new RingBuffer<string>(50);
const consoleLogs = new RingBuffer<string>(100);
const failedApiCalls = new RingBuffer<{
  path: string;
  method: string;
  status: number;
  timestamp: string;
}>(20);
const breadcrumbs = new RingBuffer<{
  selector: string;
  action?: string;
  label?: string;
  route?: string;
  timestamp: string;
}>(20);

// --- Console interception ---

let initialized = false;

function shouldCaptureLog(text: string): boolean {
  // Skip logs related to auth routes (may contain tokens/session data)
  if (isAuthRelated(text)) return false;
  // Skip the diagnostics module's own logs to avoid noise
  if (text.startsWith("[feedback]")) return false;
  return true;
}

function initConsoleCapture() {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;
  const originalInfo = console.info;

  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (shouldCaptureLog(text)) {
      consoleErrors.push(scrub(text));
    }
    originalError.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (shouldCaptureLog(text)) {
      consoleLogs.push(`[warn] ${scrub(text)}`);
    }
    originalWarn.apply(console, args);
  };

  console.log = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (shouldCaptureLog(text)) {
      consoleLogs.push(scrub(text));
    }
    originalLog.apply(console, args);
  };

  console.info = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (shouldCaptureLog(text)) {
      consoleLogs.push(`[info] ${scrub(text)}`);
    }
    originalInfo.apply(console, args);
  };
}

// --- Breadcrumb tracking ---

function initBreadcrumbs() {
  // Click breadcrumbs only — route changes tracked via recordRouteChange()
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      const className =
        target.className && typeof target.className === "string"
          ? `.${target.className.split(" ").slice(0, 2).join(".")}`
          : "";
      breadcrumbs.push({
        selector: `${tag}${className}`,
        action: target.dataset.action,
        label: target.getAttribute("aria-label") || undefined,
        timestamp: new Date().toISOString(),
      });
    },
    { capture: true },
  );
}

// --- Route change recording (called from App.tsx via React Router location) ---

let lastRoute = "";

export function recordRouteChange(route: string) {
  if (route === lastRoute) return;
  lastRoute = route;
  breadcrumbs.push({
    selector: "navigation",
    route,
    timestamp: new Date().toISOString(),
  });
}

// --- Failed API call recording ---

export function recordFailedApiCall(url: string, method: string, status: number) {
  try {
    const parsed = new URL(url);
    if (AUTH_ROUTE_PATTERNS.some((p) => p.test(parsed.pathname))) return;
    failedApiCalls.push({
      path: parsed.pathname,
      method: method.toUpperCase(),
      status,
      timestamp: new Date().toISOString(),
    });
  } catch {
    failedApiCalls.push({
      path: url.split("?")[0],
      method: method.toUpperCase(),
      status,
      timestamp: new Date().toISOString(),
    });
  }
}

// --- Public API ---

export interface DiagnosticSnapshot {
  consoleErrors: string[];
  consoleLogs: string[];
  failedApiCalls: { path: string; method: string; status: number; timestamp: string }[];
  breadcrumbs: {
    selector: string;
    action?: string;
    label?: string;
    route?: string;
    timestamp: string;
  }[];
  appVersion: string;
  electronVersion: string;
  os: string;
  currentRoute: string;
}

export function collectDiagnostics(electronVersion?: string): DiagnosticSnapshot {
  return {
    consoleErrors: consoleErrors.snapshot(),
    consoleLogs: consoleLogs.snapshot(),
    failedApiCalls: failedApiCalls.snapshot(),
    breadcrumbs: breadcrumbs.snapshot(),
    appVersion: import.meta.env.VITE_APP_VERSION || "unknown",
    electronVersion: electronVersion || "unknown",
    os: navigator.userAgent,
    currentRoute: window.location.pathname + window.location.hash,
  };
}

export function initDiagnostics() {
  if (initialized) return;
  initialized = true;
  initConsoleCapture();
  initBreadcrumbs();
}
