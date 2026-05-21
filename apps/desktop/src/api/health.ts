// apps/desktop/src/api/health.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiUrl } from "./client";

/**
 * Heartbeat against `GET /health` so the desktop app can surface an
 * "API unreachable" status banner during platform outages (Railway
 * incidents, container restart loops, transient gateway issues).
 *
 * Why a heartbeat instead of watching feature queries:
 *
 *  - Predictable cadence. Feature queries fire on user navigation,
 *    so banner visibility would jitter based on what page the user
 *    happens to be on.
 *  - Decoupled from feature paths. A bug in `useThings()` retry
 *    config can't accidentally light up the outage banner.
 *  - `/health` is cheap. Anthropic's health probe pattern: 200 OK
 *    with no body work, no DB hit. We poll it on the order of
 *    minutes-per-day per open client.
 *
 * Cadence:
 *
 *  - 30s when healthy, ±20% jitter so app restarts don't all hit at
 *    the same second.
 *  - 5s when degraded, ±20% jitter, so recovery is fast.
 *
 * Failure threshold: 1. The first failure shows the banner; the
 * banner clears on the first success. Brief network blips can cause
 * a quick flicker (banner appears for ~5s then disappears) — that's
 * the cost of fast feedback during real outages.
 *
 * Timeout: 5s per ping. A successful 200 that took 30s is not
 * healthy from the user's perspective; if `/health` can't answer in
 * 5s the gateway is degraded and the banner should show.
 *
 * Backgrounded tabs: `document.visibilityState` gates the timer so we
 * don't burn cycles polling a tab the user isn't looking at. The
 * heartbeat resumes immediately on `visibilitychange` → 'visible'.
 *
 * Auth gating: callers pass `enabled` — typically the boolean
 * derived from `useAuth().user`. When false, the heartbeat doesn't
 * run at all; the banner only matters once a user is signed in.
 */
export type ApiHealthStatus = "ok" | "unreachable";

export interface UseApiHealthResult {
  status: ApiHealthStatus;
  /** Force an immediate ping. Honoured at most once per 2 seconds so a
   *  user mashing the Retry button doesn't hammer the API. */
  retry: () => void;
  /** Timestamp of the most recent successful ping (ms since epoch),
   *  or null if we've never seen one this session. Surfaced for tests
   *  and not currently rendered in the banner copy. */
  lastOkAt: number | null;
}

export interface UseApiHealthOptions {
  /** When false, no heartbeat runs. Defaults to true. */
  enabled?: boolean;
  /** Override the healthy-state interval (ms). Tests use a small value. */
  healthyIntervalMs?: number;
  /** Override the degraded-state interval (ms). Tests use a small value. */
  degradedIntervalMs?: number;
  /** Override the per-ping timeout (ms). */
  timeoutMs?: number;
  /** Override `fetch` for tests. */
  fetchImpl?: typeof fetch;
}

/** Defaults exported for tests + clarity. Tunable per call via options. */
export const HEALTHY_INTERVAL_MS = 30_000;
export const DEGRADED_INTERVAL_MS = 5_000;
export const HEALTH_TIMEOUT_MS = 5_000;
const RETRY_DEBOUNCE_MS = 2_000;

/**
 * Decide the next-tick delay given a status and a jitter factor.
 *
 * Pulled out as a pure function so tests can pin the math without
 * needing to mock timers.
 *
 *  - `status === 'ok'` → `healthyIntervalMs * jitter`
 *  - `status === 'unreachable'` → `degradedIntervalMs * jitter`
 *
 * Jitter is typically `Math.random() * 0.4 + 0.8` (i.e. 0.8..1.2).
 * `1.0` is the canonical "no-jitter" case for tests.
 */
export function nextHeartbeatDelay(
  status: ApiHealthStatus,
  healthyIntervalMs: number,
  degradedIntervalMs: number,
  jitter: number,
): number {
  const base = status === "ok" ? healthyIntervalMs : degradedIntervalMs;
  return Math.max(0, base * jitter);
}

/**
 * Classify a fetch/ping outcome into the `ApiHealthStatus` it implies.
 *
 *  - 200..299 → ok (the typical health-endpoint success path)
 *  - 401 → ok (auth state issue, NOT a transport problem; the user
 *    will see the LoginPage. The status banner is for the platform
 *    being unreachable, not for the session having expired.)
 *  - Anything else (5xx, network failure, timeout) → unreachable
 *
 * Pure function — pulled out so tests don't need a server stub.
 */
export function classifyHealthOutcome(
  result:
    | { kind: "response"; status: number }
    | { kind: "error" },
): ApiHealthStatus {
  if (result.kind === "error") return "unreachable";
  if (result.status >= 200 && result.status < 300) return "ok";
  if (result.status === 401) return "ok"; // auth, not transport
  return "unreachable";
}

/**
 * Probe `/health` with a 5s timeout. Returns the classified outcome
 * so the caller can update state. No throws — transport errors and
 * timeouts come back as `{ kind: 'error' }`.
 *
 * Note: doesn't go through `apiFetch` because `apiFetch` calls
 * `handleUnauthorized()` on 401 (which nukes the session). The
 * heartbeat must be passive — a 401 on `/health` is not actionable
 * by the heartbeat code.
 */
async function probeHealth(
  baseUrl: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ kind: "response"; status: number } | { kind: "error" }> {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return { kind: "response", status: res.status };
  } catch {
    return { kind: "error" };
  } finally {
    clearTimeout(handle);
  }
}

/**
 * Hook that drives the desktop's API-outage banner. See the file
 * doc-comment for the design rationale.
 */
export function useApiHealth(options: UseApiHealthOptions = {}): UseApiHealthResult {
  const {
    enabled = true,
    healthyIntervalMs = HEALTHY_INTERVAL_MS,
    degradedIntervalMs = DEGRADED_INTERVAL_MS,
    timeoutMs = HEALTH_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;

  const [status, setStatus] = useState<ApiHealthStatus>("ok");
  const [lastOkAt, setLastOkAt] = useState<number | null>(null);

  // Refs that don't trigger renders. The loop reads `statusRef` to
  // pick the next interval without making `status` a dep of the
  // effect (which would tear down + rebuild the loop every transition).
  const statusRef = useRef<ApiHealthStatus>(status);
  statusRef.current = status;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Throttle for the user-initiated retry button.
  const lastRetryAt = useRef<number>(0);

  // Single mutable "wake the loop now" signal. The loop sleeps on a
  // promise that resolves either when the timer fires or when the
  // signal is pulsed (retry button, visibility → visible, etc.). The
  // alternative — recreating the entire effect on every wake — is
  // worse because it loses the current sleep timer and races.
  const wakeResolverRef = useRef<(() => void) | null>(null);
  const wake = useCallback(() => {
    wakeResolverRef.current?.();
    wakeResolverRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        const handle = setTimeout(resolve, ms);
        // Allow `wake()` to short-circuit the sleep.
        wakeResolverRef.current = () => {
          clearTimeout(handle);
          resolve();
        };
      });

    const loop = async () => {
      // Probe immediately on mount so we don't sit "ok" for 30s
      // before the first heartbeat lands.
      while (!cancelled) {
        // Skip the ping while the tab is hidden — no point burning
        // network on a tab the user isn't looking at. We wake up
        // immediately on visibility change so the banner is fresh
        // when the user returns.
        if (typeof document !== "undefined" && document.hidden) {
          await sleep(60_000);
          continue;
        }

        const outcome = await probeHealth(getApiUrl(), timeoutMs, fetchImpl);
        if (cancelled) return;

        const next = classifyHealthOutcome(outcome);
        setStatus((prev) => (prev === next ? prev : next));
        if (next === "ok") {
          setLastOkAt(Date.now());
        }

        const jitter = 0.8 + Math.random() * 0.4; // 0.8..1.2
        const delay = nextHeartbeatDelay(
          statusRef.current,
          healthyIntervalMs,
          degradedIntervalMs,
          jitter,
        );
        await sleep(delay);
      }
    };

    loop();

    // Wake on visibility change so we re-probe immediately when the
    // user comes back to the app — both for the case "I was away, is
    // it still up?" and for the case "I was away while it was down,
    // is it back?"
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        wake();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      cancelled = true;
      wake(); // unblock any pending sleep so the loop exits promptly
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
    // healthyIntervalMs / degradedIntervalMs / timeoutMs / fetchImpl
    // can change in tests but shouldn't churn the effect in
    // production — `enabled` is the only meaningful prod dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const retry = useCallback(() => {
    const now = Date.now();
    if (now - lastRetryAt.current < RETRY_DEBOUNCE_MS) return;
    lastRetryAt.current = now;
    wake();
  }, [wake]);

  return { status, retry, lastOkAt };
}
