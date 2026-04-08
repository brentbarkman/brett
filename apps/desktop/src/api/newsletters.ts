import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { NewsletterSender, PendingNewsletterSummary } from "@brett/types";

export function useNewsletterSenders() {
  return useQuery({
    queryKey: ["newsletter-senders"],
    queryFn: () => apiFetch<NewsletterSender[]>("/newsletters/senders"),
  });
}

export function useNewsletterPending() {
  return useQuery({
    queryKey: ["newsletter-pending"],
    queryFn: () => apiFetch<PendingNewsletterSummary[]>("/newsletters/senders/pending"),
  });
}

export function useUpdateSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<NewsletterSender, "name" | "active">> }) =>
      apiFetch<NewsletterSender>(`/newsletters/senders/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["newsletter-senders"] });
    },
  });
}

export function useDeleteSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/newsletters/senders/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["newsletter-senders"] });
    },
  });
}

export function useApprovePendingSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pendingId: string) =>
      apiFetch<NewsletterSender>(`/newsletters/senders/${pendingId}/approve`, {
        method: "POST",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["newsletter-pending"] });
      qc.invalidateQueries({ queryKey: ["newsletter-senders"] });
    },
  });
}

export function useBlockPendingSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pendingId: string) =>
      apiFetch(`/newsletters/senders/${pendingId}/block`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["newsletter-pending"] });
      qc.invalidateQueries({ queryKey: ["newsletter-senders"] });
    },
  });
}
