import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { NavList, CreateListInput } from "@brett/types";
import { apiFetch } from "./client";

export function useLists() {
  return useQuery({
    queryKey: ["lists"],
    queryFn: () => apiFetch<NavList[]>("/lists"),
  });
}

export function useCreateList() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateListInput) =>
      apiFetch<NavList>("/lists", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}
