import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getToken } from "../auth/auth-client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

type EventHandler = (data: any) => void;
const handlers = new Map<string, Set<EventHandler>>();

export function useSSEHandler(eventType: string, handler: EventHandler): void {
  useEffect(() => {
    const set = handlers.get(eventType) ?? new Set();
    set.add(handler);
    handlers.set(eventType, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) handlers.delete(eventType);
    };
  }, [eventType, handler]);
}

export function useEventStream(): void {
  const qc = useQueryClient();
  const retryDelay = useRef(1000);
  const eventSourceRef = useRef<EventSource | null>(null);
  const cancelledRef = useRef(false);

  const connect = useCallback(async () => {
    if (cancelledRef.current) return;

    const token = await getToken();
    if (!token) { console.warn("[SSE] No token, skipping connection"); return; }
    console.log("[SSE] Connecting...");

    // Fetch a short-lived ticket — never pass the raw token in the URL
    let ticketParam: string;
    try {
      console.log("[SSE] Fetching ticket from", `${API_URL}/events/ticket`);
      const res = await fetch(`${API_URL}/events/ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log("[SSE] Ticket response status:", res.status);
      if (!res.ok) throw new Error(`ticket fetch failed: ${res.status}`);
      const { ticket } = await res.json();
      ticketParam = `ticket=${encodeURIComponent(ticket)}`;
      console.log("[SSE] Got ticket, connecting to stream...");
    } catch (err) {
      console.warn("[SSE] Failed to obtain ticket, will retry:", err);
      const delay = retryDelay.current;
      retryDelay.current = Math.min(delay * 2, 30000);
      setTimeout(connect, delay);
      return;
    }

    if (cancelledRef.current) return;

    const url = `${API_URL}/events/stream?${ticketParam}`;
    console.log("[SSE] Opening EventSource:", url);
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      console.log("[SSE] Connection established");
      retryDelay.current = 1000;
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
    };

    es.onerror = (err) => {
      console.warn("[SSE] Connection error, reconnecting...", err);
      es.close();
      eventSourceRef.current = null;
      if (cancelledRef.current) return;
      const delay = retryDelay.current;
      retryDelay.current = Math.min(delay * 2, 30000);
      setTimeout(connect, delay);
    };

    const calendarHandler = (e: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(e.data);
      } catch {
        console.warn("[SSE] Failed to parse event data:", e.data);
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

    // Content extraction events — use both invalidate AND refetch to ensure
    // the data refreshes regardless of staleTime
    es.addEventListener("content.extracted", (e: MessageEvent) => {
      let data: { itemId?: string; contentStatus?: string } | undefined;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      console.log("[SSE] content.extracted received:", data);
      if (data?.itemId) {
        qc.invalidateQueries({ queryKey: ["thing-detail", data.itemId] });
        qc.refetchQueries({ queryKey: ["thing-detail", data.itemId] });
      }
      // Invalidate marks as stale, refetch forces immediate re-fetch
      qc.invalidateQueries({ queryKey: ["things"] });
      qc.refetchQueries({ queryKey: ["things"] });
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.refetchQueries({ queryKey: ["inbox"] });
    });
  }, [qc]);

  useEffect(() => {
    connect();
    return () => {
      cancelledRef.current = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [connect]);
}
