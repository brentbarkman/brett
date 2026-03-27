import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { WeatherData } from "@brett/types";

interface WeatherResponse {
  weather: WeatherData | null;
  reason?: string;
}

export function useWeather(enabled: boolean = true) {
  const query = useQuery({
    queryKey: ["weather"],
    queryFn: () => apiFetch<WeatherResponse>("/weather"),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    weather: query.data?.weather ?? null,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
