import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getToken, handleUnauthorized } from "../auth/auth-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Upper bound on reconnection attempts. 20 tries with exponential backoff
// capped at 30s totals roughly 9 minutes — plenty for transient network
// blips, short enough to stop draining the battery if the server is just
// gone. When we stop, the user can always re-trigger by reloading / signing
// in again; a silent forever-retry loop was worse UX.
const MAX_RETRIES = 20;

type EventHandler = (data: any) => void;
const handlers = new Map<string, Set<EventHandler>>();

export function useSSEHandler(eventType: string, handler: EventHandler): void {
  // Callers typically pass an inline arrow function whose identity changes
  // every render. If we put `handler` in the effect deps, we'd re-register
  // on every parent re-render — and during streaming that means dozens per
  // second — while the closed-over state goes stale. Store the latest
  // callback in a ref and register a stable wrapper once per eventType.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const wrapper: EventHandler = (data) => handlerRef.current(data);
    const set = handlers.get(eventType) ?? new Set();
    set.add(wrapper);
    handlers.set(eventType, set);
    return () => {
      set.delete(wrapper);
      if (set.size === 0) handlers.delete(eventType);
    };
  }, [eventType]);
}

export function useEventStream(): void {
  const qc = useQueryClient();

  useEffect(() => {
    // NOTE: All state below lives inside the effect closure so we never
    // re-subscribe on parent re-renders. The prior version defined `connect`
    // outside `useEffect` with `[connect]` deps, which re-ran the effect on
    // every render — opening a new EventSource + POST /events/ticket each
    // time. Under load (e.g. calendar-sync SSE bursts) this would spiral
    // into a 429 storm and exhaust the browser's socket pool, wedging the
    // app. Keep this effect with empty deps.
    let cancelled = false;
    let retryDelay = 1000;
    let retryCount = 0;
    let eventSource: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let paused = false;
    // True until the very first successful onopen, so we don't fire the
    // catch-up invalidation set on initial mount (the React Query consumers
    // already do their own first fetch).
    let everConnected = false;

    const closeSocket = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };

    const invalidateCatchUp = () => {
      // Anything driven by SSE updates: covers events the server might have
      // emitted while we were hidden. React Query's cache state is stale as
      // far as we know; force refetch on every SSE-backed list.
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["lists"] });
      qc.invalidateQueries({ queryKey: ["scouts"] });
      qc.invalidateQueries({ queryKey: ["scout-findings"] });
      qc.invalidateQueries({ queryKey: ["scout-activity"] });
      qc.invalidateQueries({ queryKey: ["broken-connections"] });
      qc.invalidateQueries({ queryKey: ["granola"] });
    };

    const scheduleRetry = () => {
      if (cancelled || paused) return;
      if (retryCount >= MAX_RETRIES) {
        console.warn("[sse] giving up after", retryCount, "retries");
        return;
      }
      retryCount += 1;
      const delay = retryDelay;
      retryDelay = Math.min(delay * 2, 30000);
      retryTimer = setTimeout(connect, delay);
    };

    const connect = async () => {
      if (cancelled || paused) return;

      const token = await getToken();
      if (!token) return;

      // Fetch a short-lived ticket — never pass the raw token in the URL
      let ticketParam: string;
      try {
        const res = await fetch(`${API_URL}/events/ticket`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        // If the bearer itself is rejected, retrying with the same token
        // just burns cycles. Clear it AND drop better-auth's session cache
        // (via handleUnauthorized) so the AuthGuard flips to LoginPage
        // instead of leaving the shell rendered with dead requests.
        if (res.status === 401 || res.status === 403) {
          await handleUnauthorized();
          return;
        }
        if (!res.ok) throw new Error(`ticket fetch failed: ${res.status}`);
        const { ticket } = await res.json();
        ticketParam = `ticket=${encodeURIComponent(ticket)}`;
      } catch {
        scheduleRetry();
        return;
      }

      if (cancelled) return;

      const url = `${API_URL}/events/stream?${ticketParam}`;
      const es = new EventSource(url);
      eventSource = es;

      es.onopen = () => {
        retryDelay = 1000;
        retryCount = 0;
        if (everConnected) {
          // Reconnect after a drop or visibility-pause: refresh anything
          // SSE would have updated while we were disconnected.
          invalidateCatchUp();
        } else {
          // First connect — keep the legacy minimal invalidation for the
          // queries that fetch lazily on auth (calendar-only).
          qc.invalidateQueries({ queryKey: ["calendar-events"] });
          qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
          everConnected = true;
        }
      };

      es.onerror = () => {
        es.close();
        eventSource = null;
        if (cancelled) return;
        scheduleRetry();
      };

      const calendarHandler = (e: MessageEvent) => {
        let data: unknown;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        qc.invalidateQueries({ queryKey: ["calendar-events"] });
        qc.invalidateQueries({ queryKey: ["calendar-event-detail"] });
        const eventHandlers = handlers.get(e.type);
        if (eventHandlers) for (const h of eventHandlers) h(data);
      };

      es.addEventListener("calendar.event.created", calendarHandler);
      es.addEventListener("calendar.event.updated", calendarHandler);
      es.addEventListener("calendar.event.deleted", calendarHandler);
      es.addEventListener("calendar.sync.complete", () => {
        qc.invalidateQueries({ queryKey: ["calendar-events"] });
        qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
      });

      // Content extraction — invalidate + refetch to bypass staleTime
      es.addEventListener("content.extracted", (e: MessageEvent) => {
        let data: { itemId?: string; contentStatus?: string } | undefined;
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        if (data?.itemId) {
          qc.invalidateQueries({ queryKey: ["thing-detail", data.itemId] });
          qc.refetchQueries({ queryKey: ["thing-detail", data.itemId] });
        }
        qc.invalidateQueries({ queryKey: ["things"] });
        qc.refetchQueries({ queryKey: ["things"] });
        qc.invalidateQueries({ queryKey: ["inbox"] });
        qc.refetchQueries({ queryKey: ["inbox"] });
      });

      // Scout events
      es.addEventListener("scout.finding.created", (e) => {
        qc.invalidateQueries({ queryKey: ["scouts"] });
        qc.invalidateQueries({ queryKey: ["scout-findings"] });
        const data = (() => { try { return JSON.parse((e as MessageEvent).data); } catch { return {}; } })();
        const eventHandlers = handlers.get("scout.finding.created");
        if (eventHandlers) for (const h of eventHandlers) h(data);
      });

      es.addEventListener("scout.run.completed", (e) => {
        qc.invalidateQueries({ queryKey: ["scouts"] });
        qc.invalidateQueries({ queryKey: ["scout-activity"] });
        const data = (() => { try { return JSON.parse((e as MessageEvent).data); } catch { return {}; } })();
        const eventHandlers = handlers.get("scout.run.completed");
        if (eventHandlers) for (const h of eventHandlers) h(data);
      });

      es.addEventListener("scout.status.changed", (e) => {
        qc.invalidateQueries({ queryKey: ["scouts"] });
        const data = (() => { try { return JSON.parse((e as MessageEvent).data); } catch { return {}; } })();
        const eventHandlers = handlers.get("scout.status.changed");
        if (eventHandlers) for (const h of eventHandlers) h(data);
      });

      // Item events (from mobile sync push or other sources)
      const itemHandler = () => {
        qc.invalidateQueries({ queryKey: ["things"] });
        qc.invalidateQueries({ queryKey: ["inbox"] });
        qc.invalidateQueries({ queryKey: ["lists"] });
      };
      es.addEventListener("item.created", itemHandler);
      es.addEventListener("item.updated", itemHandler);
      es.addEventListener("item.deleted", itemHandler);

      // List events
      const listHandler = () => {
        qc.invalidateQueries({ queryKey: ["lists"] });
        qc.invalidateQueries({ queryKey: ["things"] });
      };
      es.addEventListener("list.created", listHandler);
      es.addEventListener("list.updated", listHandler);
      es.addEventListener("list.deleted", listHandler);

      // Connection-state events. Replaces post-OAuth burst polling on the
      // client — the server emits this once an OAuth-initiated initial sync
      // (or any subsequent sync) finishes, so the UI can refetch on a real
      // signal instead of hammering on a 2–3s timer.
      es.addEventListener("connection.synced", () => {
        qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
        qc.invalidateQueries({ queryKey: ["calendar-events"] });
        qc.invalidateQueries({ queryKey: ["granola"] });
        qc.invalidateQueries({ queryKey: ["things"] });
        qc.invalidateQueries({ queryKey: ["broken-connections"] });
      });
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        // Tear down the socket while hidden so we stop heartbeats, server
        // pushes, and reconnect timers from waking the renderer. Catch-up
        // happens on the onopen after we re-connect.
        paused = true;
        closeSocket();
      } else if (paused) {
        paused = false;
        retryCount = 0;
        retryDelay = 1000;
        connect();
      }
    };

    connect();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      closeSocket();
    };
  }, [qc]);
}
