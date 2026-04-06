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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { url } = await apiFetch<{ url: string }>("/calendar/accounts/connect", {
        method: "POST",
      });
      // Validate the OAuth URL points to Google before opening
      const parsed = new URL(url);
      if (parsed.hostname !== "accounts.google.com") {
        throw new Error("Unexpected OAuth redirect URL");
      }
      window.open(url, "_blank");

      // Poll for the new account — the OAuth callback happens in the browser,
      // so we don't know exactly when it completes. Refetch accounts when the
      // window regains focus (user returns from browser) and periodically.
      const poll = setInterval(() => {
        qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
        qc.invalidateQueries({ queryKey: ["calendar-events"] });
      }, 3000);
      const onFocus = () => {
        qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
        qc.invalidateQueries({ queryKey: ["calendar-events"] });
      };
      window.addEventListener("focus", onFocus);
      // Stop polling after 2 minutes
      setTimeout(() => {
        clearInterval(poll);
        window.removeEventListener("focus", onFocus);
      }, 120_000);
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
  const qc = useQueryClient();
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
      window.open(url, "_blank");

      const poll = setInterval(() => {
        qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
      }, 2000);
      setTimeout(() => clearInterval(poll), 120_000);
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
