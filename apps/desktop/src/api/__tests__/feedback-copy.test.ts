import { describe, it, expect } from "vitest";
import { formatReportForClipboard, feedbackErrorCopy } from "../feedback";

/// Pure-function tests for the desktop feedback recovery flow.
/// Mirrors the iOS `FeedbackSheetCopyTests` Swift suite — same
/// surface, same expectations. If you change one side, change both.
describe("formatReportForClipboard", () => {
  it("includes type, title, and description in plain text", () => {
    const result = formatReportForClipboard({
      type: "bug",
      title: "App crashes on launch",
      description: "Tap icon, see splash, then white screen.",
      appVersion: "1.0.0 (42)",
      os: "macOS 15.0",
      userId: "user_abc",
    });
    expect(result).toContain("[Bug] App crashes on launch");
    expect(result).toContain("Tap icon, see splash, then white screen.");
  });

  it("substitutes a placeholder when title is empty", () => {
    // The Submit button is gated on non-empty title, but Copy isn't —
    // a user might want to copy a partial draft when they see the
    // outage banner before finishing the form.
    const result = formatReportForClipboard({
      type: "bug",
      title: "   ",
      description: "Something broke.",
      appVersion: "1.0.0 (42)",
      os: "macOS 15.0",
      userId: "user_abc",
    });
    expect(result).toContain("(no title)");
    expect(result).toContain("Something broke.");
  });

  it("substitutes a placeholder when description is empty", () => {
    const result = formatReportForClipboard({
      type: "feature",
      title: "Idea",
      description: "",
      appVersion: "1.0.0 (42)",
      os: "macOS 15.0",
      userId: null,
    });
    expect(result).toContain("[Feature] Idea");
    expect(result).toContain("(no description)");
  });

  it("includes the minimal diagnostics needed for triage", () => {
    const result = formatReportForClipboard({
      type: "bug",
      title: "Title",
      description: "Desc",
      appVersion: "1.0.0 (42)",
      os: "macOS 15.0",
      userId: "user_abc",
    });
    expect(result).toContain("App: 1.0.0 (42)");
    expect(result).toContain("OS: macOS 15.0");
    expect(result).toContain("User: user_abc");
  });

  it("omits the User line when userId is null or empty", () => {
    const resultNull = formatReportForClipboard({
      type: "bug",
      title: "Title",
      description: "Desc",
      appVersion: "1.0.0 (42)",
      os: "macOS 15.0",
      userId: null,
    });
    expect(resultNull).not.toContain("User:");

    const resultEmpty = formatReportForClipboard({
      type: "bug",
      title: "Title",
      description: "Desc",
      appVersion: "1.0.0 (42)",
      os: "macOS 15.0",
      userId: "",
    });
    expect(resultEmpty).not.toContain("User:");
  });

  it("renders enhancement type with the correct label", () => {
    const result = formatReportForClipboard({
      type: "enhancement",
      title: "Better X",
      description: "Y",
      appVersion: "1.0.0 (42)",
      os: "macOS 15.0",
      userId: null,
    });
    expect(result).toContain("[Enhancement] Better X");
  });

  it("contains no JSON artifacts", () => {
    // The pasted report ends up in the user's email or Slack — no JSON
    // braces, no diagnostics key names. Pure plain text only.
    const result = formatReportForClipboard({
      type: "bug",
      title: "Title",
      description: "Desc",
      appVersion: "1.0.0 (42)",
      os: "macOS 15.0",
      userId: "user_abc",
    });
    expect(result).not.toContain("{");
    expect(result).not.toContain("}");
    expect(result).not.toContain('":"');
    expect(result).not.toContain("diagnostics");
  });
});

describe("feedbackErrorCopy", () => {
  it("returns unreachable copy for TimeoutError", () => {
    // The 5s timeout in `useSubmitFeedback` surfaces as a TimeoutError
    // — feedbackErrorCopy maps that to "Brett is unreachable" so the
    // user sees the Retry / Copy affordances.
    const err = new Error("Request to /feedback timed out after 5000ms");
    err.name = "TimeoutError";
    const copy = feedbackErrorCopy(err);
    expect(copy.toLowerCase()).toContain("brett is unreachable");
    expect(copy.toLowerCase()).toContain("copy your report");
  });

  it("returns unreachable copy for 5xx API errors", () => {
    // apiFetch surfaces non-2xx as `new Error("API error N")` when
    // the body has no message — common during a Railway gateway 502.
    expect(feedbackErrorCopy(new Error("API error 502")).toLowerCase()).toContain(
      "brett is unreachable",
    );
    expect(feedbackErrorCopy(new Error("API error 503")).toLowerCase()).toContain(
      "brett is unreachable",
    );
    expect(feedbackErrorCopy(new Error("API error 504")).toLowerCase()).toContain(
      "brett is unreachable",
    );
  });

  it("returns unreachable copy for raw network errors", () => {
    // Fetch reject shapes vary by platform: "Failed to fetch" on Chrome,
    // "Load failed" on Safari/WebKit (Electron uses Chromium so it's
    // usually the first). Match either.
    expect(feedbackErrorCopy(new Error("Failed to fetch")).toLowerCase()).toContain(
      "brett is unreachable",
    );
    expect(feedbackErrorCopy(new Error("Load failed")).toLowerCase()).toContain(
      "brett is unreachable",
    );
    expect(feedbackErrorCopy(new Error("NetworkError when attempting to fetch resource."))
      .toLowerCase()).toContain("brett is unreachable");
  });

  it("preserves specific validation messages from the server", () => {
    // 4xx with a body.message is forwarded by apiFetch as the Error
    // message verbatim. Show it — the server told us something
    // actionable ("Title too long", "Bad type", etc).
    const copy = feedbackErrorCopy(new Error("Title must be 200 characters or fewer."));
    expect(copy).toBe("Title must be 200 characters or fewer.");
  });

  it("falls back to unreachable copy for non-Error inputs", () => {
    // Defensive: useMutation should always reject with an Error, but
    // a future code path could theoretically throw something else.
    // Fail safe, not crash.
    expect(feedbackErrorCopy("just a string").toLowerCase()).toContain(
      "brett is unreachable",
    );
    expect(feedbackErrorCopy(null).toLowerCase()).toContain("brett is unreachable");
    expect(feedbackErrorCopy(undefined).toLowerCase()).toContain("brett is unreachable");
  });

  it("falls back to unreachable copy for excessively long messages", () => {
    // A pathological server response shouldn't blow up the modal.
    // We cap server messages at 240 chars; anything longer is
    // treated as transport-error-shaped.
    const long = "x".repeat(1000);
    const copy = feedbackErrorCopy(new Error(long));
    expect(copy.toLowerCase()).toContain("brett is unreachable");
  });
});
