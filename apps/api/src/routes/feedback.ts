// apps/api/src/routes/feedback.ts
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import crypto from "crypto";
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
const MAX_ENTRY_LENGTH = 2000;
const MAX_ISSUE_BODY = 65_000;
const MAX_SCREENSHOT_BASE64 = 4_000_000; // ~3MB decoded
const MAX_SCREENSHOT_BYTES = 3_000_000; // hard cap on the decoded buffer

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```/g, "` ` `");
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n[truncated]";
}

/** Cap each string entry in an array to MAX_ENTRY_LENGTH, coerce non-strings */
function sanitizeStringArray(arr: unknown[], max: number): string[] {
  return arr.slice(0, max).map((e) =>
    (typeof e === "string" ? e : String(e)).slice(0, MAX_ENTRY_LENGTH),
  );
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

    // Enforce array length limits and per-entry string length caps
    const consoleErrors = sanitizeStringArray(diag?.consoleErrors || [], MAX_CONSOLE_ERRORS);
    const consoleLogs = sanitizeStringArray(diag?.consoleLogs || [], MAX_CONSOLE_LOGS);
    const failedApiCalls = diag?.failedApiCalls?.slice(0, MAX_FAILED_CALLS) || [];
    const breadcrumbs = diag?.breadcrumbs?.slice(0, MAX_BREADCRUMBS) || [];

    // Upload screenshot to public S3 if present
    let screenshotUrl: string | null = null;
    if (diag?.screenshot) {
      try {
        // Validate size before decoding
        if (diag.screenshot.length > MAX_SCREENSHOT_BASE64) {
          console.error("[feedback] Screenshot too large, skipping");
        } else {
          const imageBuffer = Buffer.from(diag.screenshot, "base64");

          // Post-decode byte-size check. Base64 can encode payloads
          // compactly, so the string-length cap above is a rough ceiling —
          // this one is the actual file-size guard.
          if (imageBuffer.length > MAX_SCREENSHOT_BYTES) {
            console.error("[feedback] Screenshot decoded bytes exceed limit, skipping");
          }
          // Validate PNG magic bytes
          else if (imageBuffer.length < 8 || !imageBuffer.subarray(0, 8).equals(PNG_MAGIC)) {
            console.error("[feedback] Screenshot rejected: not a valid PNG");
          } else {
            const key = `feedback/${crypto.randomBytes(16).toString("hex")}.png`;
            await publicS3.send(
              new PutObjectCommand({
                Bucket: PUBLIC_STORAGE_BUCKET,
                Key: key,
                Body: imageBuffer,
                ContentType: "image/png",
              }),
            );
            screenshotUrl = `${storageBaseUrl}/${key}`;
          }
        }
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
      // Log only the message field, not the full error object (may contain token-adjacent info)
      const ghMessage = typeof ghError === "object" && ghError !== null ? (ghError as Record<string, unknown>).message : "";
      console.error("[feedback] GitHub API error:", ghResponse.status, ghMessage);
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
