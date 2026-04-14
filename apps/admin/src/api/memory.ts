import { useQuery } from "@tanstack/react-query";
import { adminFetch } from "./client";

interface EmbeddingCoverage {
  total: number;
  embedded: number;
  coverage: number; // percentage 0-100
}

interface ExtractionSource {
  calls: number;
  tokens: number;
  costUsd: number;
}

interface MemoryStats {
  graph: {
    totalEntities: number;
    totalRelationships: number;
    entitiesByType: Array<{ type: string; count: number }>;
    newEntities30d: number;
    newRelationships30d: number;
  };
  embeddings: {
    items: EmbeddingCoverage;
    calendarEvents: EmbeddingCoverage;
    meetingNotes: EmbeddingCoverage;
  };
  facts: {
    active: number;
    expired: number;
    newLast30d: number;
  };
  extraction: {
    totalCalls: number;
    totalSpendUsd: number;
    bySource: Record<string, ExtractionSource>;
  };
}

interface MemoryUser {
  userId: string;
  name: string;
  email: string;
  entityCount: number;
  relationshipCount: number;
  factCount: number;
}

export function useMemoryStats() {
  return useQuery({
    queryKey: ["admin", "memory", "stats"],
    queryFn: () => adminFetch<MemoryStats>("/admin/memory/stats"),
    refetchInterval: 60_000,
  });
}

export function useMemoryUsers(limit = 20) {
  return useQuery({
    queryKey: ["admin", "memory", "users", limit],
    queryFn: () => adminFetch<{ users: MemoryUser[] }>(`/admin/memory/users?limit=${limit}`),
    refetchInterval: 60_000,
  });
}
