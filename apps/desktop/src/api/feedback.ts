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

export type FeedbackType = "bug" | "feature" | "enhancement";

export interface FeedbackPayload {
  type: FeedbackType;
  title: string;
  description: string;
  diagnostics: FeedbackDiagnostics;
}

interface FeedbackResponse {
  issueUrl: string;
  issueNumber: number;
}

/**
 * 5-second timeout on `/feedback`. Railway's gateway responds at
 * ~15s during an outage; failing client-side at 5s keeps the user
 * out of a 30-second hang while still allowing healthy submits
 * plenty of time. The mutation surfaces the timeout as an error
 * the modal can render with the Copy-report recovery path.
 */
const FEEDBACK_TIMEOUT_MS = 5_000;

export function useSubmitFeedback() {
  return useMutation({
    mutationFn: (payload: FeedbackPayload) =>
      apiFetch<FeedbackResponse>("/feedback", {
        method: "POST",
        body: JSON.stringify(payload),
        timeoutMs: FEEDBACK_TIMEOUT_MS,
      }),
  });
}

/**
 * Compose the plain-text report a user pastes into email or Slack
 * when the API is unreachable. Mirrors iOS's `formatReportForClipboard`
 * so the two clients copy near-identical reports. Pure function so
 * tests can pin the format exactly.
 */
export function formatReportForClipboard(input: {
  type: FeedbackType;
  title: string;
  description: string;
  appVersion: string;
  os: string;
  userId: string | null | undefined;
}): string {
  const trimmedTitle = input.title.trim();
  const trimmedDescription = input.description.trim();
  const label =
    input.type === "bug" ? "Bug" : input.type === "feature" ? "Feature" : "Enhancement";

  const lines: string[] = [];
  lines.push(`[${label}] ${trimmedTitle === "" ? "(no title)" : trimmedTitle}`);
  lines.push("");
  lines.push(trimmedDescription === "" ? "(no description)" : trimmedDescription);
  lines.push("");
  lines.push("— Diagnostics —");
  lines.push(`App: ${input.appVersion}`);
  lines.push(`OS: ${input.os}`);
  if (input.userId && input.userId.length > 0) {
    lines.push(`User: ${input.userId}`);
  }
  return lines.join("\n");
}

/**
 * Map a mutation error from `/feedback` into user-facing copy.
 * Mirrors iOS's `errorCopy(for:)` — transport errors collapse into
 * "Brett is unreachable", others fall through to the raw error
 * message. Pure function so tests can exercise it without React.
 */
export function feedbackErrorCopy(error: unknown): string {
  const unreachable =
    "Couldn't send — Brett is unreachable. Try again or copy your report.";
  if (!(error instanceof Error)) return unreachable;

  // TimeoutError is thrown by apiFetch when the 5s budget expires.
  if (error.name === "TimeoutError") return unreachable;

  const message = error.message ?? "";

  // 5xx + generic "API error" shapes from apiFetch all funnel into
  // the unreachable copy. Network failures from fetch surface as
  // "Failed to fetch" or "Load failed" depending on platform.
  if (/^API error 5\d\d/i.test(message)) return unreachable;
  if (/failed to fetch|load failed|networkerror/i.test(message)) return unreachable;

  // Validation / specific server messages — show what we got. Cap
  // length so a chatty server can't blow up the modal.
  if (message.length > 0 && message.length < 240) return message;

  return unreachable;
}
