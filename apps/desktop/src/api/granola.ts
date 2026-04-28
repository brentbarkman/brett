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
  return useMutation({
    mutationFn: async () => {
      const { url } = await apiFetch<{ url: string }>("/granola/auth/connect", {
        method: "POST",
      });
      // Open in system browser (same pattern as Google Calendar OAuth).
      // The completed connection arrives via the `connection.synced` SSE
      // event after the server's initial Granola sync — see api/sse.ts.
      window.open(url, "_blank");
      return url;
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
    onMutate: async (prefs) => {
      await queryClient.cancelQueries({ queryKey: ["granola", "account"] });
      const prev = queryClient.getQueryData<GranolaAccountStatus>(["granola", "account"]);
      if (prev?.account) {
        queryClient.setQueryData<GranolaAccountStatus>(["granola", "account"], {
          ...prev,
          account: { ...prev.account, ...prefs },
        });
      }
      return { prev };
    },
    onError: (_err, _prefs, ctx) => {
      if (ctx?.prev !== undefined) {
        queryClient.setQueryData(["granola", "account"], ctx.prev);
      }
    },
    onSettled: () => {
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
