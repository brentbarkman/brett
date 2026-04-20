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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["user-facts"] });
      const prev = qc.getQueryData<UserFactsResponse>(["user-facts"]);
      if (prev) {
        qc.setQueryData<UserFactsResponse>(["user-facts"], {
          facts: prev.facts.filter((f) => f.id !== id),
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(["user-facts"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["user-facts"] }),
  });
}
