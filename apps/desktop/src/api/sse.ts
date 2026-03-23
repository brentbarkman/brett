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
    if (!token) return;

    // Fetch a short-lived ticket — never pass the raw token in the URL
    let ticketParam: string;
    try {
      const res = await fetch(`${API_URL}/events/ticket`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("ticket fetch failed");
      const { ticket } = await res.json();
      ticketParam = `ticket=${encodeURIComponent(ticket)}`;
    } catch {
      console.warn("[SSE] Failed to obtain ticket, will retry");
      const delay = retryDelay.current;
      retryDelay.current = Math.min(delay * 2, 30000);
      setTimeout(connect, delay);
      return;
    }

    if (cancelledRef.current) return;

    const url = `${API_URL}/events/stream?${ticketParam}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      retryDelay.current = 1000;
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
      qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
    };

    es.onerror = () => {
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

    // Content extraction events — use refetchQueries (not invalidateQueries)
    // because the 30s staleTime would prevent invalidated queries from refetching
    // if they were just fetched when the content item was created
    es.addEventListener("content.extracted", (e: MessageEvent) => {
      let data: { itemId?: string; contentStatus?: string } | undefined;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }
      if (data?.itemId) {
        qc.refetchQueries({ queryKey: ["thing-detail", data.itemId] });
      }
      qc.refetchQueries({ queryKey: ["things"] });
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
