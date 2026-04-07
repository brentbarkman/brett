# Feedback Submission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a keyboard-shortcut-triggered feedback modal that auto-captures diagnostics and creates GitHub Issues via the API.

**Architecture:** Desktop renderer captures diagnostics (console logs, failed API calls, breadcrumbs, screenshot via IPC) into ring buffers initialized at startup. `Cmd+Shift+F` snapshots the buffers + screenshot, opens a modal, and POSTs to `/feedback` on the API. The API validates, sanitizes, and creates a GitHub Issue with the diagnostics in collapsible `<details>` blocks.

**Tech Stack:** Hono (API route), React + React Query (modal + mutation), Electron IPC (screenshot), GitHub REST API (issue creation)

**Spec:** `docs/superpowers/specs/2026-04-07-feedback-submission-design.md`

---

### Task 1: Diagnostics Ring Buffer Module

**Files:**
- Create: `apps/desktop/src/lib/diagnostics.ts`

This is the foundation — captures console logs, failed API calls, and breadcrumbs into fixed-size circular buffers with token scrubbing.

- [ ] **Step 1: Create the diagnostics module**

```typescript
// apps/desktop/src/lib/diagnostics.ts

// --- Token scrubbing ---

const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /token=[A-Za-z0-9._\-]+/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
];

const AUTH_ROUTE_PATTERNS = [/\/auth/, /\/calendar-accounts/, /\/granola/];

function scrub(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

// --- Ring buffer ---

class RingBuffer<T> {
  private items: T[] = [];
  constructor(private maxSize: number) {}

  push(item: T) {
    this.items.push(item);
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  snapshot(): T[] {
    return [...this.items];
  }

  clear() {
    this.items = [];
  }
}

// --- Buffers ---

const consoleErrors = new RingBuffer<string>(50);
const consoleLogs = new RingBuffer<string>(100);
const failedApiCalls = new RingBuffer<{
  path: string;
  method: string;
  status: number;
  timestamp: string;
}>(20);
const breadcrumbs = new RingBuffer<{
  selector: string;
  action?: string;
  label?: string;
  route?: string;
  timestamp: string;
}>(20);

// --- Console interception ---

let initialized = false;

function initConsoleCapture() {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;

  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    consoleErrors.push(scrub(text));
    originalError.apply(console, args);
  };

  console.warn = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    consoleLogs.push(`[warn] ${scrub(text)}`);
    originalWarn.apply(console, args);
  };

  console.log = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    consoleLogs.push(scrub(text));
    originalLog.apply(console, args);
  };
}

// --- Breadcrumb tracking ---

function initBreadcrumbs() {
  // Click breadcrumbs
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target as HTMLElement;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      const className = target.className && typeof target.className === "string"
        ? `.${target.className.split(" ").slice(0, 2).join(".")}`
        : "";
      breadcrumbs.push({
        selector: `${tag}${className}`,
        action: target.dataset.action,
        label: target.getAttribute("aria-label") || undefined,
        timestamp: new Date().toISOString(),
      });
    },
    { capture: true },
  );

  // Route change breadcrumbs
  let lastRoute = window.location.pathname + window.location.hash;
  const observer = new MutationObserver(() => {
    const currentRoute = window.location.pathname + window.location.hash;
    if (currentRoute !== lastRoute) {
      lastRoute = currentRoute;
      breadcrumbs.push({
        selector: "navigation",
        route: currentRoute,
        timestamp: new Date().toISOString(),
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// --- Failed API call recording ---

export function recordFailedApiCall(url: string, method: string, status: number) {
  // Strip query params and extract path only
  try {
    const parsed = new URL(url);
    // Skip auth-related routes
    if (AUTH_ROUTE_PATTERNS.some((p) => p.test(parsed.pathname))) return;
    failedApiCalls.push({
      path: parsed.pathname,
      method: method.toUpperCase(),
      status,
      timestamp: new Date().toISOString(),
    });
  } catch {
    failedApiCalls.push({
      path: url.split("?")[0],
      method: method.toUpperCase(),
      status,
      timestamp: new Date().toISOString(),
    });
  }
}

// --- Public API ---

export interface DiagnosticSnapshot {
  consoleErrors: string[];
  consoleLogs: string[];
  failedApiCalls: { path: string; method: string; status: number; timestamp: string }[];
  breadcrumbs: { selector: string; action?: string; label?: string; route?: string; timestamp: string }[];
  appVersion: string;
  os: string;
  currentRoute: string;
}

export function collectDiagnostics(): DiagnosticSnapshot {
  return {
    consoleErrors: consoleErrors.snapshot(),
    consoleLogs: consoleLogs.snapshot(),
    failedApiCalls: failedApiCalls.snapshot(),
    breadcrumbs: breadcrumbs.snapshot(),
    appVersion: import.meta.env.VITE_APP_VERSION || "unknown",
    os: navigator.userAgent,
    currentRoute: window.location.pathname + window.location.hash,
  };
}

export function initDiagnostics() {
  if (initialized) return;
  initialized = true;
  initConsoleCapture();
  initBreadcrumbs();
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck --filter @brett/desktop`
Expected: No errors related to diagnostics.ts

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/lib/diagnostics.ts
git commit -m "feat(feedback): add diagnostics ring buffer module with token scrubbing"
```

---

### Task 2: Hook Diagnostics into apiFetch

**Files:**
- Modify: `apps/desktop/src/api/client.ts` (add failed API call recording)

- [ ] **Step 1: Add the recordFailedApiCall import and hook into the error path**

In `apps/desktop/src/api/client.ts`, add the import at the top:

```typescript
import { recordFailedApiCall } from "../lib/diagnostics";
```

Then modify the error handling block (the `if (!res.ok)` section) to record the failed call before throwing:

Replace:
```typescript
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message || (body as any).error || `API error ${res.status}`);
  }
```

With:
```typescript
  if (!res.ok) {
    recordFailedApiCall(
      `${API_URL}${path}`,
      init?.method || "GET",
      res.status,
    );
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message || (body as any).error || `API error ${res.status}`);
  }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck --filter @brett/desktop`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/api/client.ts
git commit -m "feat(feedback): record failed API calls in diagnostics buffer"
```

---

### Task 3: Screenshot IPC (Main Process + Preload)

**Files:**
- Modify: `apps/desktop/electron/main.ts` (add capture-screenshot handler)
- Modify: `apps/desktop/electron/preload.ts` (expose captureScreenshot)

- [ ] **Step 1: Add the IPC handler in main.ts**

In `apps/desktop/electron/main.ts`, add the screenshot handler after the existing IPC handlers (after the `set-auto-install-on-quit` handler, around line 131). The handler needs access to `mainWindow`, so add it inside the `app.whenReady()` block where `mainWindow` is available, or wherever the existing IPC handlers are that reference the window.

If `mainWindow` is not directly accessible where the IPC handlers are registered, capture it via a module-level variable. Look at how the codebase currently references `mainWindow` in IPC handlers and follow the same pattern.

```typescript
ipcMain.handle("capture-screenshot", async () => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) throw new Error("No focused window");
  const image = await win.webContents.capturePage();
  // Resize to max 1280px wide to limit payload size
  const size = image.getSize();
  if (size.width > 1280) {
    const ratio = 1280 / size.width;
    const resized = image.resize({
      width: 1280,
      height: Math.round(size.height * ratio),
    });
    return resized.toPNG().toString("base64");
  }
  return image.toPNG().toString("base64");
});
```

Note: `BrowserWindow` must be imported from `electron` — check if it's already imported at the top of main.ts. If not, add it to the existing electron import.

- [ ] **Step 2: Expose in preload.ts**

In `apps/desktop/electron/preload.ts`, add this line inside the `contextBridge.exposeInMainWorld("electronAPI", { ... })` object:

```typescript
  captureScreenshot: () => ipcRenderer.invoke("capture-screenshot"),
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck --filter @brett/desktop`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/electron/main.ts apps/desktop/electron/preload.ts
git commit -m "feat(feedback): add capture-screenshot IPC handler with 1280px resize"
```

---

### Task 4: API Feedback Route

**Files:**
- Create: `apps/api/src/routes/feedback.ts`
- Modify: `apps/api/src/app.ts` (mount the route)

- [ ] **Step 1: Create the feedback route**

```typescript
// apps/api/src/routes/feedback.ts
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/rate-limit.js";
import { publicS3, PUBLIC_STORAGE_BUCKET } from "../lib/storage.js";

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;
const MAX_CONSOLE_ERRORS = 50;
const MAX_CONSOLE_LOGS = 100;
const MAX_FAILED_CALLS = 20;
const MAX_BREADCRUMBS = 20;
const MAX_ISSUE_BODY = 65_000;

const GITHUB_REPO = process.env.GITHUB_FEEDBACK_REPO || "";
const GITHUB_PAT = process.env.GITHUB_FEEDBACK_PAT || "";

// Public storage base URL for screenshot links in GitHub Issues.
// Uses the storage proxy route so URLs go through our API domain.
const storageBaseUrl = process.env.BETTER_AUTH_URL
  ? `${process.env.BETTER_AUTH_URL}/public`
  : "http://localhost:3001/public";

const TYPE_LABELS: Record<string, { prefix: string; label: string }> = {
  bug: { prefix: "Bug", label: "bug" },
  feature: { prefix: "Feature", label: "feature-request" },
  enhancement: { prefix: "Enhancement", label: "enhancement" },
};

function escapeMarkdown(text: string): string {
  // Escape any existing triple-backtick sequences to prevent breaking fenced code blocks
  return text.replace(/```/g, "` ` `");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n[truncated]";
}

export const feedback = new Hono<AuthEnv>();

feedback.use("*", authMiddleware);

feedback.post(
  "/",
  rateLimiter(10, 60_000),
  bodyLimit({ maxSize: 5 * 1024 * 1024 }),
  async (c) => {
    if (!GITHUB_PAT || !GITHUB_REPO) {
      return c.json({ error: "Feedback submission is not configured" }, 503);
    }

    const user = c.get("user");
    const body = await c.req.json<{
      type: string;
      title: string;
      description: string;
      diagnostics?: {
        screenshot?: string;
        appVersion?: string;
        os?: string;
        electronVersion?: string;
        currentRoute?: string;
        consoleErrors?: string[];
        consoleLogs?: string[];
        failedApiCalls?: { path: string; method: string; status: number; timestamp: string }[];
        breadcrumbs?: { selector: string; action?: string; label?: string; route?: string; timestamp: string }[];
        userId?: string;
      };
    }>();

    // Validate required fields
    if (!body.type || !body.title || !body.description) {
      return c.json({ error: "type, title, and description are required" }, 400);
    }

    const typeConfig = TYPE_LABELS[body.type];
    if (!typeConfig) {
      return c.json({ error: "type must be 'bug', 'feature', or 'enhancement'" }, 400);
    }

    const title = body.title.slice(0, MAX_TITLE);
    const description = body.description.slice(0, MAX_DESCRIPTION);
    const diag = body.diagnostics;

    // Enforce array length limits
    const consoleErrors = diag?.consoleErrors?.slice(0, MAX_CONSOLE_ERRORS) || [];
    const consoleLogs = diag?.consoleLogs?.slice(0, MAX_CONSOLE_LOGS) || [];
    const failedApiCalls = diag?.failedApiCalls?.slice(0, MAX_FAILED_CALLS) || [];
    const breadcrumbs = diag?.breadcrumbs?.slice(0, MAX_BREADCRUMBS) || [];

    // Upload screenshot to public S3 if present
    let screenshotUrl: string | null = null;
    if (diag?.screenshot) {
      try {
        const key = `feedback/${Date.now()}-${user.id.slice(0, 8)}.png`;
        const imageBuffer = Buffer.from(diag.screenshot, "base64");
        await publicS3.send(
          new PutObjectCommand({
            Bucket: PUBLIC_STORAGE_BUCKET,
            Key: key,
            Body: imageBuffer,
            ContentType: "image/png",
          }),
        );
        screenshotUrl = `${storageBaseUrl}/${key}`;
      } catch (err) {
        console.error("[feedback] Screenshot upload failed:", err);
        // Continue without screenshot — don't fail the whole submission
      }
    }

    // Build issue body
    let issueBody = `${escapeMarkdown(description)}\n\n---\n\n`;
    issueBody += `**Submitted by:** user \`${user.id}\`\n\n`;

    if (screenshotUrl) {
      issueBody += `<details><summary>Screenshot</summary>\n\n![screenshot](${screenshotUrl})\n\n</details>\n\n`;
    }

    if (diag?.appVersion || diag?.os || diag?.currentRoute) {
      issueBody += `<details><summary>System Info</summary>\n\n`;
      issueBody += "```\n";
      if (diag.appVersion) issueBody += `App Version: ${escapeMarkdown(diag.appVersion)}\n`;
      if (diag.os) issueBody += `OS: ${escapeMarkdown(diag.os)}\n`;
      if (diag.electronVersion) issueBody += `Electron: ${escapeMarkdown(diag.electronVersion)}\n`;
      if (diag.currentRoute) issueBody += `Route: ${escapeMarkdown(diag.currentRoute)}\n`;
      issueBody += "```\n\n</details>\n\n";
    }

    if (consoleErrors.length > 0) {
      issueBody += `<details><summary>Console Errors (${consoleErrors.length})</summary>\n\n`;
      issueBody += "```\n";
      issueBody += consoleErrors.map((e) => escapeMarkdown(e)).join("\n");
      issueBody += "\n```\n\n</details>\n\n";
    }

    if (consoleLogs.length > 0) {
      issueBody += `<details><summary>Console Logs (${consoleLogs.length})</summary>\n\n`;
      issueBody += "```\n";
      issueBody += consoleLogs.map((e) => escapeMarkdown(e)).join("\n");
      issueBody += "\n```\n\n</details>\n\n";
    }

    if (failedApiCalls.length > 0) {
      issueBody += `<details><summary>Failed API Calls (${failedApiCalls.length})</summary>\n\n`;
      issueBody += "```json\n";
      issueBody += escapeMarkdown(JSON.stringify(failedApiCalls, null, 2));
      issueBody += "\n```\n\n</details>\n\n";
    }

    if (breadcrumbs.length > 0) {
      issueBody += `<details><summary>Breadcrumbs (${breadcrumbs.length})</summary>\n\n`;
      issueBody += "```json\n";
      issueBody += escapeMarkdown(JSON.stringify(breadcrumbs, null, 2));
      issueBody += "\n```\n\n</details>\n\n";
    }

    // Truncate to GitHub's limit
    issueBody = truncate(issueBody, MAX_ISSUE_BODY);

    // Create GitHub Issue
    const [owner, repo] = GITHUB_REPO.split("/");
    const ghResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_PAT}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: `[${typeConfig.prefix}] ${title}`,
        body: issueBody,
        labels: [typeConfig.label],
      }),
    });

    if (!ghResponse.ok) {
      const ghError = await ghResponse.json().catch(() => ({}));
      console.error("[feedback] GitHub API error:", ghResponse.status, ghError);
      return c.json(
        { error: `Failed to create issue: GitHub API returned ${ghResponse.status}` },
        502,
      );
    }

    const ghIssue = (await ghResponse.json()) as { html_url: string; number: number };

    return c.json({
      issueUrl: ghIssue.html_url,
      issueNumber: ghIssue.number,
    });
  },
);
```

- [ ] **Step 2: Mount the route in app.ts**

In `apps/api/src/app.ts`, add the import at the top with the other route imports:

```typescript
import { feedback } from "./routes/feedback.js";
```

Add the route mount after the existing routes (around line 92, after the scouts route):

```typescript
app.route("/feedback", feedback);
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck --filter @brett/api`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/feedback.ts apps/api/src/app.ts
git commit -m "feat(feedback): add POST /feedback route with GitHub Issues integration"
```

---

### Task 5: Desktop Feedback Mutation Hook

**Files:**
- Create: `apps/desktop/src/api/feedback.ts`

- [ ] **Step 1: Create the mutation hook**

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck --filter @brett/desktop`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/api/feedback.ts
git commit -m "feat(feedback): add useSubmitFeedback React Query mutation hook"
```

---

### Task 6: Feedback Modal Component

**Files:**
- Create: `apps/desktop/src/components/FeedbackModal.tsx`

This is the main UI — a modal with type selector, title, description, diagnostics preview with remove buttons, and submit.

- [ ] **Step 1: Create the modal component**

```tsx
// apps/desktop/src/components/FeedbackModal.tsx
import React, { useState, useEffect, useRef } from "react";
import { useSubmitFeedback } from "../api/feedback";
import type { DiagnosticSnapshot } from "../lib/diagnostics";

type FeedbackType = "bug" | "feature" | "enhancement";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  diagnostics: DiagnosticSnapshot | null;
  screenshot: string | null;
  userId: string;
}

const TYPE_OPTIONS: { value: FeedbackType; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "Feature Request" },
  { value: "enhancement", label: "Enhancement" },
];

const PLACEHOLDERS: Record<FeedbackType, string> = {
  bug: "What happened? What did you expect?",
  feature: "What would you like to see?",
  enhancement: "What could be better?",
};

export function FeedbackModal({ isOpen, onClose, diagnostics, screenshot, userId }: FeedbackModalProps) {
  const [type, setType] = useState<FeedbackType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showScreenshotPreview, setShowScreenshotPreview] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const submitFeedback = useSubmitFeedback();

  // Focus title on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => titleRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Reset state on close
  useEffect(() => {
    if (!isOpen) {
      setType("bug");
      setTitle("");
      setDescription("");
      setIncludeScreenshot(true);
      setIncludeDiagnostics(true);
      setShowDiagnostics(false);
      setShowScreenshotPreview(false);
      submitFeedback.reset();
    }
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && !submitFeedback.isPending;

  const handleSubmit = () => {
    if (!canSubmit || !diagnostics) return;

    submitFeedback.mutate({
      type,
      title: title.slice(0, 200),
      description: description.slice(0, 4000),
      diagnostics: {
        ...(includeScreenshot && screenshot ? { screenshot } : {}),
        appVersion: diagnostics.appVersion,
        os: diagnostics.os,
        currentRoute: diagnostics.currentRoute,
        ...(includeDiagnostics
          ? {
              consoleErrors: diagnostics.consoleErrors,
              consoleLogs: diagnostics.consoleLogs,
              failedApiCalls: diagnostics.failedApiCalls,
              breadcrumbs: diagnostics.breadcrumbs,
            }
          : {
              consoleErrors: [],
              consoleLogs: [],
              failedApiCalls: [],
              breadcrumbs: [],
            }),
        userId,
      },
    });
  };

  // Success state
  if (submitFeedback.isSuccess) {
    const data = submitFeedback.data;
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} style={{ animation: "confirmBackdropIn 150ms ease-out forwards" }} />
        <div
          className="relative z-10 w-[500px] bg-black/80 backdrop-blur-2xl rounded-xl border border-white/15 shadow-2xl overflow-hidden"
          style={{ animation: "confirmDialogIn 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
        >
          <div className="px-6 py-8 text-center">
            <div className="text-2xl mb-2">Submitted</div>
            <p className="text-sm text-white/50 mb-4">
              Issue #{data.issueNumber} created successfully.
            </p>
            <a
              href={data.issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-brett-gold hover:text-brett-gold/80 underline"
            >
              View on GitHub
            </a>
            <div className="mt-6">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-white/10 text-white hover:bg-white/15 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
        <style>{feedbackAnimationStyles}</style>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} style={{ animation: "confirmBackdropIn 150ms ease-out forwards" }} />

      {/* Modal */}
      <div
        className="relative z-10 w-[600px] max-h-[80vh] bg-black/80 backdrop-blur-2xl rounded-xl border border-white/15 shadow-2xl overflow-hidden flex flex-col"
        style={{ animation: "confirmDialogIn 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards" }}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3">
          <h2 className="text-sm font-semibold text-white">Send Feedback</h2>
        </div>

        {/* Body - scrollable */}
        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-4">
          {/* Type selector */}
          <div className="flex gap-1 bg-white/5 rounded-lg p-1">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setType(opt.value)}
                className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  type === opt.value
                    ? "bg-white/15 text-white"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Title */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 200))}
            placeholder="Title"
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
          />

          {/* Description */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 4000))}
            placeholder={PLACEHOLDERS[type]}
            rows={4}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 resize-none"
          />

          {/* Screenshot preview */}
          {screenshot && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowScreenshotPreview(!showScreenshotPreview)}
                  className="text-xs text-white/40 hover:text-white/60"
                >
                  Screenshot {showScreenshotPreview ? "▼" : "▶"}
                </button>
                <button
                  onClick={() => setIncludeScreenshot(!includeScreenshot)}
                  className={`text-xs ${includeScreenshot ? "text-white/40 hover:text-red-400" : "text-red-400"}`}
                >
                  {includeScreenshot ? "Remove" : "Include"}
                </button>
              </div>
              {showScreenshotPreview && includeScreenshot && (
                <img
                  src={`data:image/png;base64,${screenshot}`}
                  alt="Screenshot"
                  className="w-full rounded-lg border border-white/10 opacity-80"
                />
              )}
              {!includeScreenshot && (
                <p className="text-xs text-white/30 italic">Screenshot removed from submission</p>
              )}
            </div>
          )}

          {/* Diagnostics preview */}
          {diagnostics && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowDiagnostics(!showDiagnostics)}
                  className="text-xs text-white/40 hover:text-white/60"
                >
                  Diagnostics {showDiagnostics ? "▼" : "▶"}
                </button>
                <button
                  onClick={() => setIncludeDiagnostics(!includeDiagnostics)}
                  className={`text-xs ${includeDiagnostics ? "text-white/40 hover:text-red-400" : "text-red-400"}`}
                >
                  {includeDiagnostics ? "Remove" : "Include"}
                </button>
              </div>
              {showDiagnostics && includeDiagnostics && (
                <div className="bg-white/5 rounded-lg p-3 text-xs text-white/40 font-mono space-y-1 max-h-40 overflow-y-auto">
                  <div>App: {diagnostics.appVersion}</div>
                  <div>Route: {diagnostics.currentRoute}</div>
                  <div>Console Errors: {diagnostics.consoleErrors.length}</div>
                  <div>Console Logs: {diagnostics.consoleLogs.length}</div>
                  <div>Failed API Calls: {diagnostics.failedApiCalls.length}</div>
                  <div>Breadcrumbs: {diagnostics.breadcrumbs.length}</div>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {submitFeedback.isError && (
            <p className="text-xs text-red-400">
              {submitFeedback.error.message}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-white/5">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-sm font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-brett-gold/20 text-brett-gold hover:bg-brett-gold/30 border border-brett-gold/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {submitFeedback.isPending ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>

      <style>{feedbackAnimationStyles}</style>
    </div>
  );
}

const feedbackAnimationStyles = `
  @keyframes confirmBackdropIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes confirmDialogIn {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
`;
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck --filter @brett/desktop`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/components/FeedbackModal.tsx
git commit -m "feat(feedback): add FeedbackModal component with diagnostics preview"
```

---

### Task 7: Wire Everything into App.tsx

**Files:**
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: Add imports at the top of App.tsx**

Add these imports alongside the existing imports:

```typescript
import { initDiagnostics, collectDiagnostics } from "./lib/diagnostics";
import { FeedbackModal } from "./components/FeedbackModal";
```

- [ ] **Step 2: Initialize diagnostics at startup**

Inside the `App` component, add a one-time init call near the top (before other useEffect calls):

```typescript
useEffect(() => {
  initDiagnostics();
}, []);
```

- [ ] **Step 3: Add feedback modal state**

Add these state variables alongside the existing state declarations:

```typescript
const [feedbackOpen, setFeedbackOpen] = useState(false);
const [feedbackDiagnostics, setFeedbackDiagnostics] = useState<ReturnType<typeof collectDiagnostics> | null>(null);
const [feedbackScreenshot, setFeedbackScreenshot] = useState<string | null>(null);
```

- [ ] **Step 4: Add the Cmd+Shift+F keyboard handler**

Add a new useEffect for the feedback shortcut. Place it near the existing keyboard handler useEffects:

```typescript
useEffect(() => {
  const handleFeedbackShortcut = async (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
      e.preventDefault();
      if (feedbackOpen) return;

      // Capture screenshot BEFORE opening modal
      let screenshot: string | null = null;
      try {
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.captureScreenshot) {
          screenshot = await electronAPI.captureScreenshot();
        }
      } catch (err) {
        console.error("[feedback] Screenshot capture failed:", err);
      }

      // Snapshot diagnostics
      const diag = collectDiagnostics();

      setFeedbackScreenshot(screenshot);
      setFeedbackDiagnostics(diag);
      setFeedbackOpen(true);
    }
  };
  document.addEventListener("keydown", handleFeedbackShortcut);
  return () => document.removeEventListener("keydown", handleFeedbackShortcut);
}, [feedbackOpen]);
```

- [ ] **Step 5: Add the FeedbackModal to the JSX**

Add the modal component inside the outermost JSX wrapper, alongside other modals (like ConfirmDialog or SpotlightModal). Get the user ID from the auth context — look for how `user` is accessed in App.tsx (likely from `useAuth()` or similar).

```tsx
<FeedbackModal
  isOpen={feedbackOpen}
  onClose={() => setFeedbackOpen(false)}
  diagnostics={feedbackDiagnostics}
  screenshot={feedbackScreenshot}
  userId={user?.id || "unknown"}
/>
```

- [ ] **Step 6: Verify it compiles**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck --filter @brett/desktop`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/App.tsx
git commit -m "feat(feedback): wire Cmd+Shift+F shortcut, diagnostics init, and FeedbackModal into App"
```

---

### Task 8: Environment Variables & Configuration

**Files:**
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Add the feedback env vars to .env.example**

Add these lines to `apps/api/.env.example`:

```bash
# Feedback → GitHub Issues
GITHUB_FEEDBACK_PAT=        # Fine-grained PAT with Issues R/W on the target repo
GITHUB_FEEDBACK_REPO=       # owner/repo format, e.g. brentbarkman/brett
```

- [ ] **Step 2: Add the actual values to your local .env**

Add the real `GITHUB_FEEDBACK_PAT` and `GITHUB_FEEDBACK_REPO` values to `apps/api/.env`. (Do NOT commit `.env`.)

- [ ] **Step 3: Verify the API starts correctly**

Run: `cd /Users/brentbarkman/code/brett && pnpm dev:api`
Expected: Server starts without errors. Check logs for no issues related to feedback configuration.

- [ ] **Step 4: Commit**

```bash
git add apps/api/.env.example
git commit -m "feat(feedback): add GITHUB_FEEDBACK_PAT and GITHUB_FEEDBACK_REPO to env example"
```

---

### Task 9: End-to-End Manual Test

- [ ] **Step 1: Start the dev environment**

Run: `cd /Users/brentbarkman/code/brett && pnpm dev`

- [ ] **Step 2: Test the keyboard shortcut**

In the Electron app, press `Cmd+Shift+F`. The feedback modal should appear. Verify:
- Screenshot was captured (thumbnail visible in modal)
- Diagnostics section shows buffer counts
- Type selector toggles between Bug/Feature/Enhancement
- Title and description placeholders change with type
- Remove buttons work for screenshot and diagnostics
- Cancel closes the modal
- Escape closes the modal

- [ ] **Step 3: Test a real submission**

Fill in a test bug report and submit. Verify:
- Success state shows with the GitHub Issue URL
- The GitHub Issue was created with the correct title prefix, labels, and diagnostics in collapsible sections
- Screenshot is embedded in the issue body

- [ ] **Step 4: Test error handling**

Temporarily set an invalid `GITHUB_FEEDBACK_PAT` and submit. Verify:
- Error message is displayed in the modal
- The modal doesn't close on error

- [ ] **Step 5: Final typecheck**

Run: `cd /Users/brentbarkman/code/brett && pnpm typecheck`
Expected: PASS across all packages

- [ ] **Step 6: Commit any final fixes**

```bash
git add -A
git commit -m "feat(feedback): end-to-end feedback submission working"
```
