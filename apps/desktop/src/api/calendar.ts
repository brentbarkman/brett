import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type {
  CalendarEventsResponse,
  CalendarEventDetailResponse,
  RsvpInput,
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
    onMutate: async ({ eventId, status, comment }) => {
      await qc.cancelQueries({ queryKey: ["calendar-event-detail", eventId] });
      const prev = qc.getQueryData<CalendarEventDetailResponse>(["calendar-event-detail", eventId]);
      if (prev) {
        // Update both myResponseStatus and the self-attendee in the attendees array
        const updatedAttendees = prev.attendees?.map((a: any) =>
          a.self ? { ...a, responseStatus: status, comment: comment ?? a.comment } : a,
        );
        qc.setQueryData(["calendar-event-detail", eventId], {
          ...prev,
          myResponseStatus: status,
          attendees: updatedAttendees,
        });
      }
      return { prev };
    },
    onError: (_err, { eventId }, context) => {
      if (context?.prev) {
        qc.setQueryData(["calendar-event-detail", eventId], context.prev);
      }
    },
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
    // Prevents the same edit-flash as the task-title case: write the new
    // content into cache before the server round-trip so the notes field
    // stays rendered with what the user just typed.
    onMutate: async ({ eventId, content }) => {
      await qc.cancelQueries({ queryKey: ["calendar-event-notes", eventId] });
      const prev = qc.getQueryData<CalendarEventNotesResponse>(["calendar-event-notes", eventId]);
      qc.setQueryData<CalendarEventNotesResponse>(["calendar-event-notes", eventId], { content });
      return { prev };
    },
    onError: (_err, { eventId }, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData<CalendarEventNotesResponse>(["calendar-event-notes", eventId], ctx.prev);
      }
    },
    onSettled: (_data, _err, { eventId }) => {
      qc.invalidateQueries({ queryKey: ["calendar-event-notes", eventId] });
      qc.invalidateQueries({ queryKey: ["calendar-event-detail", eventId] });
    },
  });
}

export interface RelatedItem {
  entityId: string;
  title: string;
  type: string;
  status: string;
  similarity: number;
}

export interface MeetingHistoryOccurrence {
  eventId: string;
  date: string;
  meetingNote?: { title: string; summary: string };
  actionItems: Array<{ id: string; title: string; status: string }>;
}

export interface MeetingHistoryResponse {
  recurringEventId: string;
  pastOccurrences: MeetingHistoryOccurrence[];
  relatedItems: Array<{ entityId: string; title: string; similarity: number }>;
}

export function useRelatedItems(eventId: string | null) {
  return useQuery({
    queryKey: ["event-related-items", eventId],
    queryFn: () =>
      apiFetch<{ relatedItems: RelatedItem[] }>(`/api/events/${eventId}/related-items`),
    enabled: !!eventId,
  });
}

export function useMeetingHistory(eventId: string | null) {
  return useQuery({
    queryKey: ["event-meeting-history", eventId],
    queryFn: () =>
      apiFetch<MeetingHistoryResponse>(`/api/events/${eventId}/meeting-history`),
    enabled: !!eventId,
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
