import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { apiFetch } from "./client";
import type { WeatherData } from "@brett/types";

interface WeatherResponse {
  weather: WeatherData | null;
  reason?: string;
}

/** Ticks every minute, returning a new Date each time. */
function useCurrentTime() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Align to the next minute boundary for clean ticks
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    const timeout = setTimeout(() => {
      setNow(new Date());
      // After the first aligned tick, tick every 60s
    }, msUntilNextMinute);
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => { clearTimeout(timeout); clearInterval(interval); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return now;
}

export function useWeather(enabled: boolean = true) {
  const now = useCurrentTime();

  const query = useQuery({
    queryKey: ["weather"],
    queryFn: async () => {
      // `weather: null` with a reason is a valid terminal state (no_location,
      // disabled, fetch_failed) — not an error. Let the consumer render the
      // empty state directly rather than throwing into React Query's retry
      // loop, which would keep `isLoading` true for ~60s and stall the UI
      // on the skeleton. Network/HTTP errors still throw from apiFetch and
      // will be retried normally.
      return apiFetch<WeatherResponse>("/weather");
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 2,
    retryDelay: 30_000, // 30s between retries for transient API failures
  });

  const raw = query.data?.weather ?? null;

  // Derive live current conditions from hourly data as time passes
  const weather = (() => {
    if (!raw) return null;
    const currentHourStart = new Date(now);
    currentHourStart.setMinutes(0, 0, 0);

    const match = raw.hourly.find(
      (h: { hour: string }) => new Date(h.hour).getTime() === currentHourStart.getTime()
    );
    if (!match) return raw;

    // Only override temp/icon if they differ from what the API returned
    if (match.temp === raw.current.temp && match.icon === raw.current.icon) {
      return raw;
    }

    return {
      ...raw,
      current: {
        ...raw.current,
        temp: match.temp,
        icon: match.icon,
        conditionCode: match.conditionCode,
      },
    };
  })();

  return {
    weather,
    now,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
