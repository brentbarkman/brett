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
    mutationFn: async () => {
      const { url } = await apiFetch<{ url: string }>("/calendar/accounts/connect", {
        method: "POST",
      });
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
      qc.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}
