// apps/desktop/src/api/feedback.ts
import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "./client";

interface FeedbackDiagnostics {
  screenshot?: string;
  appVersion: string;
  os: string;
  electronVersion?: string;
  currentRoute: string;
  consoleErrors: string[];
  consoleLogs: string[];
  failedApiCalls: { path: string; method: string; status: number; timestamp: string }[];
  breadcrumbs: { selector: string; action?: string; label?: string; route?: string; timestamp: string }[];
  userId: string;
}

interface FeedbackPayload {
  type: "bug" | "feature" | "enhancement";
  title: string;
  description: string;
  diagnostics: FeedbackDiagnostics;
}

interface FeedbackResponse {
  issueUrl: string;
  issueNumber: number;
}

export function useSubmitFeedback() {
  return useMutation({
    mutationFn: (payload: FeedbackPayload) =>
      apiFetch<FeedbackResponse>("/feedback", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  });
}
