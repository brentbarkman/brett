import { useQuery } from "@tanstack/react-query";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface AppConfig {
  storageBaseUrl: string;
}

export function useAppConfig() {
  return useQuery({
    queryKey: ["app-config"],
    queryFn: async (): Promise<AppConfig> => {
      const res = await fetch(`${API_URL}/config`);
      const data = await res.json();
      return {
        storageBaseUrl: data.storageBaseUrl ?? "",
      };
    },
    staleTime: Infinity,
    retry: 2,
  });
}
