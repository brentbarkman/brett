import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

interface UserMeResponse {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  timezone: string;
  timezoneAuto: boolean;
}

/**
 * Syncs the user's browser timezone to the server on app startup.
 * Only sends an update if timezoneAuto is true and the detected timezone
 * differs from the stored one.
 */
export function useTimezoneSync() {
  const hasSyncedRef = useRef(false);
  const qc = useQueryClient();

  const { data: user } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => apiFetch<UserMeResponse>("/users/me"),
  });

  useEffect(() => {
    if (!user || hasSyncedRef.current) return;
    hasSyncedRef.current = true;

    if (!user.timezoneAuto) return;

    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected === user.timezone) return;

    // Fire-and-forget timezone update (apiFetch sets Content-Type automatically)
    apiFetch("/users/timezone", {
      method: "PATCH",
      body: JSON.stringify({ timezone: detected, auto: true }),
    })
      .then(() => {
        qc.invalidateQueries({ queryKey: ["user-me"] });
      })
      .catch((err) => {
        console.warn("Failed to sync timezone:", err);
      });
  }, [user, qc]);
}
