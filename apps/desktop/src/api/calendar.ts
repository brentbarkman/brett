import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiFetch } from "./client";
import type {
  CalendarEventsResponse,
  CalendarEventDetailResponse,
  RsvpInput,
  BrettMessageRecord,
} from "@brett/types";

interface CalendarEventParams {
  date?: string;
  startDate?: string;
  endDate?: string;
}

function buildCalendarQuery(params: CalendarEventParams): string {
  const p = new URLSearchParams();
  if (params.date) p.set("date", params.date);
  if (params.startDate) p.set("startDate", params.startDate);
  if (params.endDate) p.set("endDate", params.endDate);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

interface CalendarEventNotesResponse {
  content: string | null;
}

interface CalendarBrettMessagesResponse {
  messages: BrettMessageRecord[];
  hasMore: boolean;
  cursor: string | null;
  totalCount: number;
}

interface CalendarBrettSendResponse {
  userMessage: BrettMessageRecord;
  brettMessage: BrettMessageRecord;
}

export function useCalendarEvents(params: CalendarEventParams) {
  return useQuery({
    queryKey: ["calendar-events", params],
    queryFn: () =>
      apiFetch<CalendarEventsResponse>(`/calendar/events${buildCalendarQuery(params)}`),
    enabled: !!(params.date || (params.startDate && params.endDate)),
  });
}

export function useCalendarEventDetail(id: string | null) {
  return useQuery({
    queryKey: ["calendar-event-detail", id],
    queryFn: () => apiFetch<CalendarEventDetailResponse>(`/calendar/events/${id}`),
    enabled: !!id,
  });
}

export function useUpdateRsvp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, ...input }: RsvpInput & { eventId: string }) =>
      apiFetch<CalendarEventDetailResponse>(`/calendar/events/${eventId}/rsvp`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: ["calendar-event-detail", eventId] });
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

export function useCalendarEventNotes(eventId: string | null) {
  return useQuery({
    queryKey: ["calendar-event-notes", eventId],
    queryFn: () =>
      apiFetch<CalendarEventNotesResponse>(`/calendar/events/${eventId}/notes`),
    enabled: !!eventId,
  });
}

export function useUpdateCalendarEventNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, content }: { eventId: string; content: string }) =>
      apiFetch<CalendarEventNotesResponse>(`/calendar/events/${eventId}/notes`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: ["calendar-event-notes", eventId] });
      qc.invalidateQueries({ queryKey: ["calendar-event-detail", eventId] });
    },
  });
}

export function useCalendarEventBrettMessages(eventId: string | null) {
  const query = useInfiniteQuery({
    queryKey: ["calendar-brett-messages", eventId],
    queryFn: ({ pageParam }) => {
      const url = pageParam
        ? `/calendar/events/${eventId}/brett?cursor=${encodeURIComponent(pageParam)}`
        : `/calendar/events/${eventId}/brett`;
      return apiFetch<CalendarBrettMessagesResponse>(url);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.cursor,
    enabled: !!eventId,
  });

  const messages = useMemo(
    () => query.data?.pages.flatMap((p) => p.messages) ?? [],
    [query.data],
  );

  const totalCount = query.data?.pages[0]?.totalCount ?? 0;

  return {
    messages,
    totalCount,
    hasMore: query.hasNextPage ?? false,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: query.fetchNextPage,
    isLoading: query.isLoading,
  };
}

export function useSendCalendarBrettMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, content }: { eventId: string; content: string }) =>
      apiFetch<CalendarBrettSendResponse>(`/calendar/events/${eventId}/brett`, {
        method: "POST",
        body: JSON.stringify({ content }),
      }),
    onSuccess: (_, { eventId }) => {
      qc.invalidateQueries({ queryKey: ["calendar-brett-messages", eventId] });
      qc.invalidateQueries({ queryKey: ["calendar-event-detail", eventId] });
    },
  });
}

export function useFetchCalendarRange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { startDate: string; endDate: string }) =>
      apiFetch<{ synced: number }>("/calendar/events/fetch-range", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}
