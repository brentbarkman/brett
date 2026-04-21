import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import type { NewsletterSender, PendingNewsletterSummary } from "@brett/types";

export function useNewsletterIngestAddress() {
  return useQuery({
    queryKey: ["newsletter-ingest-address"],
    queryFn: () => apiFetch<{ ingestEmail: string | null }>("/newsletters/senders/ingest-address"),
    staleTime: Infinity, // token doesn't change
  });
}

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
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: ["newsletter-senders"] });
      const prev = qc.getQueryData<NewsletterSender[]>(["newsletter-senders"]);
      if (prev) {
        qc.setQueryData<NewsletterSender[]>(
          ["newsletter-senders"],
          prev.map((s) => (s.id === id ? { ...s, ...data } : s)),
        );
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(["newsletter-senders"], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["newsletter-senders"] });
    },
  });
}

export function useDeleteSender() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/newsletters/senders/${id}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ["newsletter-senders"] });
      const prev = qc.getQueryData<NewsletterSender[]>(["newsletter-senders"]);
      if (prev) {
        qc.setQueryData<NewsletterSender[]>(["newsletter-senders"], prev.filter((s) => s.id !== id));
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(["newsletter-senders"], ctx.prev);
    },
    onSettled: () => {
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
    onMutate: async (pendingId) => {
      await qc.cancelQueries({ queryKey: ["newsletter-pending"] });
      const prev = qc.getQueryData<PendingNewsletterSummary[]>(["newsletter-pending"]);
      if (prev) {
        qc.setQueryData<PendingNewsletterSummary[]>(
          ["newsletter-pending"],
          prev.filter((p) => p.id !== pendingId),
        );
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(["newsletter-pending"], ctx.prev);
    },
    onSettled: () => {
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
    onMutate: async (pendingId) => {
      await qc.cancelQueries({ queryKey: ["newsletter-pending"] });
      const prev = qc.getQueryData<PendingNewsletterSummary[]>(["newsletter-pending"]);
      if (prev) {
        qc.setQueryData<PendingNewsletterSummary[]>(
          ["newsletter-pending"],
          prev.filter((p) => p.id !== pendingId),
        );
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev !== undefined) qc.setQueryData(["newsletter-pending"], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["newsletter-pending"] });
      qc.invalidateQueries({ queryKey: ["newsletter-senders"] });
    },
  });
}
