import DOMPurify from "isomorphic-dompurify";
import { timingSafeEqual } from "crypto";
import { prisma } from "./prisma.js";
import { enqueueEmbed } from "@brett/ai";
import type { ContentMetadata } from "@brett/types";

// ── HTML Sanitization ──

const ALLOWED_CSS_PROPERTIES = new Set([
  "width", "max-width", "min-width",
  "height", "max-height", "min-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "text-align", "vertical-align",
  "color", "background-color", "background",
  "font-size", "font-weight", "font-family", "font-style",
  "line-height", "letter-spacing",
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-radius", "border-collapse", "border-spacing",
  "display", "table-layout",
]);

function sanitizeCssProperties(style: string): string {
  return style
    .split(";")
    .map((decl) => decl.trim())
    .filter((decl) => {
      if (!decl) return false;
      const colonIdx = decl.indexOf(":");
      if (colonIdx === -1) return false;
      const prop = decl.slice(0, colonIdx).trim().toLowerCase();
      const value = decl.slice(colonIdx + 1).trim().toLowerCase();
      // Block url() references (data exfiltration vector)
      if (value.includes("url(")) return false;
      // Block position: fixed/absolute (overlay attacks)
      if (prop === "position" && (value === "fixed" || value === "absolute")) return false;
      // Block high z-index
      if (prop === "z-index") return false;
      return ALLOWED_CSS_PROPERTIES.has(prop);
    })
    .join("; ");
}

/**
 * Regex-based inline style sanitization.
 * Replaces each style="..." attribute with a cleaned version.
 * Used instead of DOM TreeWalker because isomorphic-dompurify's JSDOM
 * backend doesn't reliably support document.createTreeWalker.
 */
function sanitizeStylesInHtml(html: string): string {
  return html.replace(/\sstyle=["']([^"']*)["']/gi, (_match, styleValue: string) => {
    const cleaned = sanitizeCssProperties(styleValue);
    return cleaned ? ` style="${cleaned}"` : "";
  });
}

/**
 * Force all <a> tags to open in new tabs with safe rel attributes.
 */
function setLinkTargets(html: string): string {
  return html.replace(/<a\s/gi, '<a target="_blank" rel="noopener noreferrer" ');
}

/**
 * Sanitize newsletter HTML for safe rendering.
 * If htmlBody is empty/null, falls back to textBody wrapped in <pre>.
 */
export function sanitizeNewsletterHtml(htmlBody: string, textBody?: string | null): string {
  if (!htmlBody && textBody) {
    // Escape HTML entities in plain text, then wrap in <pre>
    const escaped = textBody
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre style="white-space:pre-wrap;word-wrap:break-word">${escaped}</pre>`;
  }

  if (!htmlBody) return "";

  // Step 1: DOMPurify pass — strips dangerous tags/attributes
  const purified = DOMPurify.sanitize(htmlBody, {
    ALLOWED_TAGS: [
      "div", "span", "p", "br", "hr",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "strong", "b", "em", "i", "u", "s", "sub", "sup",
      "ul", "ol", "li",
      "a", "img",
      "table", "thead", "tbody", "tr", "td", "th",
      "blockquote", "pre", "code",
    ],
    ALLOWED_ATTR: [
      "href", "src", "alt", "title", "width", "height",
      "style",
      "class", "id",
      "target", "rel",
      "colspan", "rowspan", "cellpadding", "cellspacing",
    ],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "style"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onmouseout", "onfocus", "onblur"],
    ALLOW_DATA_ATTR: false,
  });

  // Step 2: Regex-based CSS sanitization + link target enforcement
  // (Can't use DOM TreeWalker — isomorphic-dompurify uses JSDOM server-side)
  const withSafeStyles = sanitizeStylesInHtml(purified);
  const withSafeLinks = setLinkTargets(withSafeStyles);

  return withSafeLinks;
}

// ── Email Parsing ──

/**
 * Extract bare email from a From header that may include a display name.
 * Handles both "dan@example.com" and "Dan <dan@example.com>" formats.
 * Always returns lowercase.
 */
export function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

// ── Secret Verification ──

/**
 * Timing-safe comparison of webhook secret.
 * Returns false for mismatched lengths without leaking timing info about the expected value.
 */
export function verifyIngestSecret(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// ── Sender Lookup ──

export async function findApprovedSender(userId: string, fromEmail: string) {
  return prisma.newsletterSender.findFirst({
    where: {
      userId,
      email: extractEmail(fromEmail).toLowerCase(),
    },
  });
}

// ── Item Creation ──

export async function ingestNewsletter(params: {
  userId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  htmlBody: string;
  textBody?: string | null;
  messageId: string;
  receivedAt: string;
}): Promise<{ itemId: string }> {
  const sanitizedBody = sanitizeNewsletterHtml(params.htmlBody, params.textBody);

  const metadata: ContentMetadata = {
    type: "newsletter",
    senderName: params.senderName,
    senderEmail: params.senderEmail,
    issueSubject: params.subject,
    receivedAt: params.receivedAt,
  };

  const item = await prisma.item.create({
    data: {
      type: "content",
      status: "active",
      title: params.subject,
      contentType: "newsletter",
      contentStatus: "extracted", // already have the full content
      contentTitle: params.subject,
      contentBody: sanitizedBody,
      contentMetadata: metadata as any,
      source: params.senderName,
      sourceId: params.messageId,
      userId: params.userId,
    },
  });

  // Fire-and-forget embedding for search
  enqueueEmbed({ entityType: "item", entityId: item.id, userId: params.userId });

  return { itemId: item.id };
}

// ── Pending Newsletter + Approval Task ──

export async function createPendingNewsletter(params: {
  userId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  htmlBody: string;
  textBody?: string | null;
  messageId: string;
  receivedAt: string;
}): Promise<{ pendingId: string; taskId: string }> {
  // Dedup on message ID
  const existingPending = await prisma.pendingNewsletter.findFirst({
    where: { postmarkMessageId: params.messageId },
  });
  if (existingPending) {
    return { pendingId: existingPending.id, taskId: existingPending.approvalItemId ?? "" };
  }

  const senderEmailLower = params.senderEmail.toLowerCase();

  // Check if there's already an active approval task for this sender (avoid spamming tasks)
  const existingTask = await prisma.item.findFirst({
    where: {
      userId: params.userId,
      source: "Brett",
      sourceId: `newsletter-approve:${senderEmailLower}`,
      status: "active",
    },
  });

  // Create pending record
  const pending = await prisma.pendingNewsletter.create({
    data: {
      userId: params.userId,
      senderEmail: senderEmailLower,
      senderName: params.senderName,
      subject: params.subject,
      htmlBody: params.htmlBody,
      textBody: params.textBody,
      postmarkMessageId: params.messageId,
      receivedAt: new Date(params.receivedAt),
      approvalItemId: existingTask?.id ?? null,
    },
  });

  // Reuse existing task if one exists for this sender
  if (existingTask) {
    return { pendingId: pending.id, taskId: existingTask.id };
  }

  // Create a new approval task
  const task = await prisma.item.create({
    data: {
      type: "task",
      title: `Approve newsletter sender: ${params.senderName} (${senderEmailLower})`,
      source: "Brett",
      sourceId: `newsletter-approve:${senderEmailLower}`,
      status: "active",
      userId: params.userId,
      contentMetadata: {
        newsletterApproval: true,
        pendingNewsletterId: pending.id,
        senderEmail: senderEmailLower,
        senderName: params.senderName,
      },
    },
  });

  // Link pending record back to the approval task
  await prisma.pendingNewsletter.update({
    where: { id: pending.id },
    data: { approvalItemId: task.id },
  });

  return { pendingId: pending.id, taskId: task.id };
}

// ── Approve / Block ──

const MAX_RETROACTIVE_INGEST = 10;

export async function approveSender(userId: string, pendingId: string): Promise<{ senderId: string; ingestedCount: number }> {
  const pending = await prisma.pendingNewsletter.findFirst({
    where: { id: pendingId, userId },
  });
  if (!pending) throw new Error("Pending newsletter not found");

  // Create or reactivate the sender record
  const sender = await prisma.newsletterSender.upsert({
    where: { userId_email: { userId, email: pending.senderEmail } },
    create: {
      userId,
      name: pending.senderName,
      email: pending.senderEmail, // already lowercase
      active: true,
    },
    update: { active: true, name: pending.senderName },
  });

  // Retroactively ingest pending newsletters from this sender (most recent first, capped)
  const allPending = await prisma.pendingNewsletter.findMany({
    where: { userId, senderEmail: pending.senderEmail },
    orderBy: { receivedAt: "desc" },
    take: MAX_RETROACTIVE_INGEST,
  });

  let ingestedCount = 0;
  for (const p of allPending) {
    // Dedup: skip if item with this messageId already exists
    const exists = await prisma.item.findFirst({
      where: { userId, sourceId: p.postmarkMessageId },
    });
    if (!exists) {
      await ingestNewsletter({
        userId,
        senderName: sender.name,
        senderEmail: sender.email,
        subject: p.subject,
        htmlBody: p.htmlBody,
        textBody: p.textBody,
        messageId: p.postmarkMessageId,
        receivedAt: p.receivedAt.toISOString(),
      });
      ingestedCount++;
    }
  }

  // Log if we're discarding old pending records beyond the cap
  const totalPending = await prisma.pendingNewsletter.count({
    where: { userId, senderEmail: pending.senderEmail },
  });
  if (totalPending > MAX_RETROACTIVE_INGEST) {
    console.warn(`[newsletter] ${totalPending - MAX_RETROACTIVE_INGEST} pending newsletters from ${pending.senderEmail} exceeded retroactive cap, discarded`);
  }

  // Clean up all pending records from this sender
  await prisma.pendingNewsletter.deleteMany({
    where: { userId, senderEmail: pending.senderEmail },
  });

  // Complete the approval task
  if (pending.approvalItemId) {
    await prisma.item.update({
      where: { id: pending.approvalItemId },
      data: { status: "done", completedAt: new Date() },
    });
  }

  return { senderId: sender.id, ingestedCount };
}

export async function blockSender(userId: string, pendingId: string): Promise<void> {
  const pending = await prisma.pendingNewsletter.findFirst({
    where: { id: pendingId, userId },
  });
  if (!pending) throw new Error("Pending newsletter not found");

  // Create blocked sender record (active: false)
  await prisma.newsletterSender.upsert({
    where: { userId_email: { userId, email: pending.senderEmail } },
    create: {
      userId,
      name: pending.senderName,
      email: pending.senderEmail,
      active: false,
    },
    update: { active: false },
  });

  // Delete all pending from this sender
  await prisma.pendingNewsletter.deleteMany({
    where: { userId, senderEmail: pending.senderEmail },
  });

  // Complete the approval task
  if (pending.approvalItemId) {
    await prisma.item.update({
      where: { id: pending.approvalItemId },
      data: { status: "done", completedAt: new Date() },
    });
  }
}

// ── Cleanup ──

/**
 * Delete pending newsletter records older than 30 days,
 * but only if their approval task is already resolved (or missing).
 */
export async function cleanupExpiredPending(): Promise<number> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const expired = await prisma.pendingNewsletter.findMany({
    where: {
      createdAt: { lt: cutoff },
    },
  });

  let cleaned = 0;
  for (const p of expired) {
    // Check if approval task is still active — don't clean up if user hasn't decided
    if (p.approvalItemId) {
      const task = await prisma.item.findUnique({
        where: { id: p.approvalItemId },
        select: { status: true },
      });
      if (task && (task.status === "active" || task.status === "snoozed")) {
        continue;
      }
    }

    await prisma.pendingNewsletter.delete({ where: { id: p.id } });
    cleaned++;
  }

  return cleaned;
}
