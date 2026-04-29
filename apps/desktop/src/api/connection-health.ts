import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "./client";

interface BrokenConnections {
  count: number;
  types: string[];
}

/**
 * Broken-integration count for the Today re-link card.
 *
 * No `refetchInterval` — the server emits a `connection.synced` SSE event
 * whenever a calendar/granola connection completes a sync, and the SSE
 * client at api/sse.ts invalidates this query in response. Polling every
 * 60s on top of that was redundant and woke the renderer when the user
 * had no broken connections at all.
 */
export function useBrokenConnections() {
  return useQuery({
    queryKey: ["broken-connections"],
    queryFn: () => apiFetch<BrokenConnections>("/things/broken-connections"),
  });
}

type ConnectionType = "google-calendar" | "granola" | "ai";

function parseConnectionType(sourceId: string): ConnectionType | null {
  const type = sourceId.split(":")[1];
  if (type === "google-calendar" || type === "granola" || type === "ai") return type;
  return null;
}

/**
 * Initiate an OAuth reconnect for the given connection.
 *
 * No client-side polling after the OAuth window opens — the server emits a
 * `connection.synced` SSE event when the post-OAuth initial sync completes
 * (see calendar-sync.ts and granola-sync.ts), and the SSE client invalidates
 * the relevant queries. The previous design polled every 2–3 seconds for two
 * minutes and was a major background-battery offender.
 */
export function useReconnect() {
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
  });

  return {
    reconnect: mutation.mutate,
    isPending: mutation.isPending,
    pendingSourceId: mutation.isPending ? (mutation.variables as string | undefined) : undefined,
  };
}
