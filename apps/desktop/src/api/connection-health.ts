import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "./client";
import type { GranolaAccountStatus } from "@brett/types";

interface BrokenConnections {
  count: number;
  types: string[];
}

export function useBrokenConnections() {
  return useQuery({
    queryKey: ["broken-connections"],
    queryFn: () => apiFetch<BrokenConnections>("/things/broken-connections"),
    refetchInterval: 60_000,
  });
}

type ConnectionType = "google-calendar" | "granola" | "ai";

function parseConnectionType(sourceId: string): ConnectionType | null {
  const type = sourceId.split(":")[1];
  if (type === "google-calendar" || type === "granola" || type === "ai") return type;
  return null;
}

export function useReconnect() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: async (sourceId: string) => {
      const type = parseConnectionType(sourceId);
      if (type === "granola") {
        const { url } = await apiFetch<{ url: string }>("/granola/auth/connect", {
          method: "POST",
        });
        window.open(url, "_blank");
        return type;
      } else if (type === "google-calendar") {
        const { url } = await apiFetch<{ url: string }>("/calendar/accounts/connect", {
          method: "POST",
        });
        const parsed = new URL(url);
        if (parsed.hostname !== "accounts.google.com") {
          throw new Error("Unexpected OAuth redirect URL");
        }
        window.open(url, "_blank");
        return type;
      } else if (type === "ai") {
        navigate("/settings#ai-providers");
        return type;
      }
      return null;
    },
    onSuccess: (type) => {
      if (type === "granola") {
        const interval = setInterval(async () => {
          try {
            const status = await apiFetch<GranolaAccountStatus>("/granola/auth");
            if (status.connected) {
              clearInterval(interval);
              qc.invalidateQueries({ queryKey: ["granola"] });
              qc.invalidateQueries({ queryKey: ["things"] });
              qc.invalidateQueries({ queryKey: ["broken-connections"] });
            }
          } catch {
            // Ignore polling errors
          }
        }, 2000);
        setTimeout(() => clearInterval(interval), 120_000);
      } else if (type === "google-calendar") {
        const poll = setInterval(() => {
          qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
          qc.invalidateQueries({ queryKey: ["calendar-events"] });
          qc.invalidateQueries({ queryKey: ["things"] });
          qc.invalidateQueries({ queryKey: ["broken-connections"] });
        }, 3000);
        const onFocus = () => {
          qc.invalidateQueries({ queryKey: ["calendar-accounts"] });
          qc.invalidateQueries({ queryKey: ["calendar-events"] });
          qc.invalidateQueries({ queryKey: ["things"] });
          qc.invalidateQueries({ queryKey: ["broken-connections"] });
        };
        window.addEventListener("focus", onFocus);
        setTimeout(() => {
          clearInterval(poll);
          window.removeEventListener("focus", onFocus);
        }, 120_000);
      }
    },
  });

  return {
    reconnect: mutation.mutate,
    isPending: mutation.isPending,
    pendingSourceId: mutation.isPending ? (mutation.variables as string | undefined) : undefined,
  };
}
