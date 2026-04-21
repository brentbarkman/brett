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
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["ai-config"] });
      const prev = qc.getQueryData<AIConfigResponse>(["ai-config"]);
      if (prev) {
        qc.setQueryData<AIConfigResponse>(["ai-config"], {
          configs: prev.configs.map((c) => ({ ...c, isActive: c.id === id })),
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(["ai-config"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["ai-config"] }),
  });
}

export function useDeleteAIConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/ai/config/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["ai-config"] });
      const prev = qc.getQueryData<AIConfigResponse>(["ai-config"]);
      if (prev) {
        qc.setQueryData<AIConfigResponse>(["ai-config"], {
          configs: prev.configs.filter((c) => c.id !== id),
        });
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(["ai-config"], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["ai-config"] }),
  });
}
