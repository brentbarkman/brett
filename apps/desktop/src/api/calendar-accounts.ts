import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { ConnectedCalendarAccount } from "@brett/types";

export function useCalendarAccounts() {
  return useQuery({
    queryKey: ["calendar-accounts"],
    queryFn: () => apiFetch<ConnectedCalendarAccount[]>("/calendar/accounts"),
  });
}

export function useConnectCalendar() {
  return useMutation({
    mutationFn: async (meetingNotes: boolean) => {
      const qs = meetingNotes ? "" : "?meetingNotes=false";
      const { url } = await apiFetch<{ url: string }>(`/calendar/accounts/connect${qs}`, {
        method: "POST",
      });
      // Validate the OAuth URL points to Google before opening
      const parsed = new URL(url);
      if (parsed.hostname !== "accounts.google.com") {
        throw new Error("Unexpected OAuth redirect URL");
      }
      // The completed connection arrives via the `connection.synced` SSE
      // event after the post-OAuth initial sync — see api/sse.ts.
      window.open(url, "_blank");
    },
  });
}

export function useDisconnectCalendar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      apiFetch(`/calendar/accounts/${accountId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

export function useReauthCalendar() {
  return useMutation({
    mutationFn: async (accountId: string) => {
      const { url } = await apiFetch<{ url: string }>(
        `/calendar/accounts/${accountId}/reauth`,
        { method: "POST" },
      );
      // Validate the OAuth URL points to Google before opening
      const parsed = new URL(url);
      if (parsed.hostname !== "accounts.google.com") {
        throw new Error("Unexpected OAuth redirect URL");
      }
      // Re-auth completion arrives via the `connection.synced` SSE event
      // after the next sync — see api/sse.ts.
      window.open(url, "_blank");
    },
  });
}

export function useToggleMeetingNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, enabled }: { accountId: string; enabled: boolean }) =>
      apiFetch<{ meetingNotesEnabled: boolean }>(
        `/calendar/accounts/${accountId}/meeting-notes`,
        {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        },
      ),
    onMutate: async ({ accountId, enabled }) => {
      await qc.cancelQueries({ queryKey: ["calendar-accounts"] });
      const prev = qc.getQueryData<ConnectedCalendarAccount[]>(["calendar-accounts"]);
      if (prev) {
        qc.setQueryData<ConnectedCalendarAccount[]>(
          ["calendar-accounts"],
          prev.map((a) => (a.id === accountId ? { ...a, meetingNotesEnabled: enabled } : a)),
        );
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData<ConnectedCalendarAccount[]>(["calendar-accounts"], ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
    },
  });
}

export function useToggleCalendarVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      accountId,
      calendarId,
      isVisible,
    }: {
      accountId: string;
      calendarId: string;
      isVisible: boolean;
    }) =>
      apiFetch<ConnectedCalendarAccount>(
        `/calendar/accounts/${accountId}/calendars/${calendarId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ isVisible }),
        },
      ),
    onMutate: async ({ accountId, calendarId, isVisible }) => {
      await qc.cancelQueries({ queryKey: ["calendar-accounts"] });
      const prev = qc.getQueryData<ConnectedCalendarAccount[]>(["calendar-accounts"]);
      if (prev) {
        qc.setQueryData<ConnectedCalendarAccount[]>(
          ["calendar-accounts"],
          prev.map((a) =>
            a.id === accountId
              ? {
                  ...a,
                  calendars: a.calendars.map((c) =>
                    c.id === calendarId ? { ...c, isVisible } : c,
                  ),
                }
              : a,
          ),
        );
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev !== undefined) {
        qc.setQueryData<ConnectedCalendarAccount[]>(["calendar-accounts"], ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}
