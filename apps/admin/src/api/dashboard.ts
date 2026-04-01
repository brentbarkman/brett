import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "./client";

interface DashboardStats {
  totalUsers: number;
  totalItems: number;
  activeScouts: number;
  scoutRunsThisMonth: number;
  scoutFailuresThisMonth: number;
  scoutErrorRate: number;
  findingsThisMonth: number;
  aiSpendUsd: number;
  aiTokensThisMonth: number;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => adminFetch<DashboardStats>("/admin/dashboard/stats"),
    refetchInterval: 60_000,
  });
}
