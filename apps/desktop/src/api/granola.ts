import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { invalidateAllThings } from "./invalidate";
import type { GranolaAccountStatus, MeetingNoteDetail } from "@brett/types";

export function useGranolaAccount() {
  return useQuery({
    queryKey: ["granola", "account"],
    queryFn: () => apiFetch<GranolaAccountStatus>("/granola/auth"),
  });
}

export function useConnectGranola() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { url } = await apiFetch<{ url: string }>("/granola/auth/connect", {
        method: "POST",
      });
      // Open in system browser (same pattern as Google Calendar OAuth)
      window.open(url, "_blank");
      return url;
    },
    onSuccess: () => {
      // Poll for connection status after OAuth flow
      const interval = setInterval(async () => {
        try {
          const status = await apiFetch<GranolaAccountStatus>("/granola/auth");
          if (status.connected) {
            clearInterval(interval);
            queryClient.invalidateQueries({ queryKey: ["granola"] });
          }
        } catch {
          // Ignore polling errors
        }
      }, 2000);
      // Stop polling after 2 minutes
      setTimeout(() => clearInterval(interval), 120_000);
    },
  });
}

export function useDisconnectGranola() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch("/granola/auth", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["granola"] });
    },
  });
}

export function useUpdateGranolaPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prefs: { autoCreateMyTasks?: boolean; autoCreateFollowUps?: boolean }) =>
      apiFetch("/granola/auth/preferences", {
        method: "PATCH",
        body: JSON.stringify(prefs),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["granola", "account"] });
    },
  });
}

export function useGranolaMeetingForEvent(calendarEventId: string | null) {
  return useQuery({
    queryKey: ["granola", "meeting", calendarEventId],
    queryFn: () =>
      apiFetch<MeetingNoteDetail | null>(
        `/granola/auth/meetings/by-event/${calendarEventId}`,
      ),
    enabled: !!calendarEventId,
  });
}

export function useReprocessMeetingActions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (meetingId: string) =>
      apiFetch<{ ok: boolean; created: number }>(
        `/granola/auth/meetings/${meetingId}/reprocess`,
        { method: "POST" },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["granola", "meeting"] });
      invalidateAllThings(queryClient);
    },
  });
}
