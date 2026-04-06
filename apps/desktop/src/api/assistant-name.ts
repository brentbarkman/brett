import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { useAuth } from "../auth/AuthContext";

/** Returns the user's custom assistant name, defaulting to "Brett". */
export function useAssistantName(): string {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["user-me"],
    queryFn: () => apiFetch<{ assistantName: string }>("/users/me"),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
  return data?.assistantName ?? "Brett";
}

export function useUpdateAssistantName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 10) throw new Error("Name must be 1-10 characters");
      return apiFetch("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ assistantName: trimmed }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-me"] });
    },
  });
}
