import { useEffect, useRef } from "react";
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

  const connect = async () => {
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
      if (!res.ok) throw new Error(`ticket fetch failed: ${res.status}`);
      const { ticket } = await res.json();
      ticketParam = `ticket=${encodeURIComponent(ticket)}`;
    } catch {
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
  };

  useEffect(() => {
    cancelledRef.current = false; // Reset on mount (StrictMode double-mount sets this to true)
    connect();
    return () => {
      cancelledRef.current = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [connect]);
}
