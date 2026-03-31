import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { streamingFetch } from "./streaming";

// ─── Hook ───

export function useBrettsTake() {
  const qc = useQueryClient();
  const [streamingContent, setStreamingContent] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(
    async (opts: { itemId?: string; calendarEventId?: string }) => {
      if (isGenerating) return;

      const path = opts.itemId
        ? `/brett/take/${opts.itemId}`
        : opts.calendarEventId
          ? `/brett/take/event/${opts.calendarEventId}`
          : null;

      if (!path) return;

      setStreamingContent("");
      setIsGenerating(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        for await (const chunk of streamingFetch(
          path,
          {},
          controller.signal,
        )) {
          if (controller.signal.aborted) break;

          if (chunk.type === "text") {
            setStreamingContent((prev) => prev + chunk.content);
          } else if (chunk.type === "error") {
            setStreamingContent(
              (prev) => prev || "Something went wrong. Please try again.",
            );
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setStreamingContent(
            (prev) => prev || "Failed to generate take. Please try again.",
          );
        }
      } finally {
        setIsGenerating(false);
        abortRef.current = null;
        // Invalidate relevant queries so cached brettObservation updates
        if (opts.itemId) {
          qc.invalidateQueries({ queryKey: ["thing-detail", opts.itemId] });
          qc.invalidateQueries({ queryKey: ["things"] });
        }
        if (opts.calendarEventId) {
          qc.invalidateQueries({ queryKey: ["calendar-event-detail", opts.calendarEventId] });
        }
      }
    },
    [isGenerating, qc],
  );

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsGenerating(false);
  }, []);

  return {
    streamingContent,
    isGenerating,
    generate,
    cancel,
  };
}
