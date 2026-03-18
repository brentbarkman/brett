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

  const connect = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    const url = `${API_URL}/events/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      retryDelay.current = 1000;
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      const delay = retryDelay.current;
      retryDelay.current = Math.min(delay * 2, 30000);
      setTimeout(connect, delay);
    };

    const calendarHandler = (e: MessageEvent) => {
      const data = JSON.parse(e.data);
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
  }, [qc]);

  useEffect(() => {
    connect();
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [connect]);
}
