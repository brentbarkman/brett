import { useQuery } from "@tanstack/react-query";
import type { NavList } from "@brett/types";
import { apiFetch } from "./client";

export function useLists() {
  return useQuery({
    queryKey: ["lists"],
    queryFn: () => apiFetch<NavList[]>("/lists"),
  });
}
