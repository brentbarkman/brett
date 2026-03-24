import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { AIProviderName, UserAIConfigRecord } from "@brett/types";

interface AIConfigResponse {
  configs: (UserAIConfigRecord & { maskedKey: string })[];
}

export function useAIConfigs() {
  return useQuery({
    queryKey: ["ai-config"],
    queryFn: () => apiFetch<AIConfigResponse>("/ai/config"),
  });
}

export function useSaveAIConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { provider: AIProviderName; apiKey: string }) =>
      apiFetch("/ai/config", {
        method: "POST",
        body: JSON.stringify(data),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-config"] }),
  });
}

export function useActivateAIConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/ai/config/${id}/activate`, { method: "PUT" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-config"] }),
  });
}

export function useDeleteAIConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/ai/config/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-config"] }),
  });
}
