import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { useAuth } from "../auth/AuthContext";

/** Returns the user's custom assistant name, defaulting to "Brett". */
export function useAssistantName(): string {
  const { user } = useAuth();
  return user?.assistantName ?? "Brett";
}

export function useUpdateAssistantName() {
  const { refetchUser } = useAuth();

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
      refetchUser();
    },
  });
}
