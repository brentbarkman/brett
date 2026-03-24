import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";

interface UserFact {
  id: string;
  category: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
}

interface UserFactsResponse {
  facts: UserFact[];
}

export function useUserFacts() {
  return useQuery({
    queryKey: ["user-facts"],
    queryFn: () => apiFetch<UserFactsResponse>("/brett/memory/facts"),
  });
}

export function useDeleteUserFact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/brett/memory/facts/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-facts"] }),
  });
}
