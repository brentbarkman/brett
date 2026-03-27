import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { GeocodingResult, LocationSettings } from "@brett/types";

export function useLocationSettings() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (data: Partial<LocationSettings> & { timezone?: string }) =>
      apiFetch("/users/location", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-me"] });
      queryClient.invalidateQueries({ queryKey: ["weather"] });
    },
  });
  return {
    updateLocation: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}

export function useCitySearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const search = useQuery({
    queryKey: ["city-search", debouncedQuery],
    queryFn: () =>
      apiFetch<{ results: GeocodingResult[] }>(`/weather/geocode?q=${encodeURIComponent(debouncedQuery)}`),
    enabled: debouncedQuery.length >= 2,
    staleTime: 60 * 1000,
  });
  return {
    query,
    setQuery,
    results: search.data?.results ?? [],
    isSearching: search.isFetching,
  };
}
