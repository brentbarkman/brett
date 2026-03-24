import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { streamingFetch } from "./streaming";
import { useAIConfigs } from "./ai-config";

// ─── Types ───

interface BriefingResponse {
  briefing: {
    sessionId: string;
    content: string;
    generatedAt: string;
  } | null;
}

// ─── Hook ───

export function useBriefing() {
  const qc = useQueryClient();
  const [streamingContent, setStreamingContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Check if AI is configured
  const { data: aiConfigData } = useAIConfigs();
  const hasAI = (aiConfigData?.configs ?? []).some((c) => c.isActive && c.isValid);

  // Cached briefing query
  const briefingQuery = useQuery({
    queryKey: ["briefing"],
    queryFn: () => apiFetch<BriefingResponse>("/brett/briefing"),
    enabled: hasAI,
  });

  const cachedBriefing = briefingQuery.data?.briefing ?? null;

  // The content to display: streaming content takes priority while generating
  const content = isGenerating && streamingContent
    ? streamingContent
    : cachedBriefing?.content ?? null;

  // ─── Regenerate ───

  const regenerate = useCallback(async () => {
    if (isGenerating) return;

    setStreamingContent("");
    setIsGenerating(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const chunk of streamingFetch(
        "/brett/briefing/generate",
        {},
        controller.signal,
      )) {
        if (controller.signal.aborted) break;

        if (chunk.type === "text") {
          setStreamingContent((prev) => prev + chunk.content);
        } else if (chunk.type === "error") {
          setStreamingContent(
            (prev) => prev || `Error: ${chunk.message}`,
          );
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setStreamingContent(
          (prev) => prev || "Failed to generate briefing. Please try again.",
        );
      }
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
      // Refresh cached data
      qc.invalidateQueries({ queryKey: ["briefing"] });
    }
  }, [isGenerating, qc]);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsGenerating(false);
  }, []);

  return {
    content,
    isLoading: briefingQuery.isLoading,
    isGenerating,
    hasAI,
    hasBriefing: !!cachedBriefing || (isGenerating && !!streamingContent),
    generatedAt: cachedBriefing?.generatedAt ?? null,
    regenerate,
    cancel,
  };
}
