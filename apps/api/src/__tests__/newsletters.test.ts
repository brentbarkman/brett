import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";
import { generateId } from "@brett/utils";
import {
  findApprovedSender,
  ingestNewsletter,
  createPendingNewsletter,
  approveSender,
  blockSender,
} from "../lib/newsletter-ingest.js";

process.env.NEWSLETTER_INGEST_SECRET = "test-secret-abc123";

const WEBHOOK_URL = "http://localhost/webhooks/email/ingest/test-secret-abc123";
const WRONG_SECRET_URL = "http://localhost/webhooks/email/ingest/wrong-secret";

function makePayload(overrides: Record<string, any> = {}) {
  return {
    From: "sender@newsletters.com",
    FromName: "Newsletter Sender",
    Subject: "Weekly Update",
    HtmlBody: "<h1>Hello</h1><p>Content here</p>",
    TextBody: "Hello\nContent here",
    Date: "2026-04-07T10:00:00Z",
    MessageID: `msg-${generateId()}`,
    To: `ingest+${TEST_INGEST_TOKEN}@example.com`,
    ...overrides,
  };
}

const TEST_INGEST_TOKEN = "testtoken123abc";

describe("newsletter webhook + sender management", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        id: generateId(),
        name: "Newsletter Test User",
        email: `newsletter-${Date.now()}@test.com`,
        emailVerified: true,
        newsletterIngestToken: TEST_INGEST_TOKEN,
      },
    });
    userId = user.id;
  });

  // ── Webhook: Secret Validation ──

  describe("secret validation", () => {
    it("rejects wrong secret with 401", async () => {
      const res = await app.request(WRONG_SECRET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makePayload()),
      });
      expect(res.status).toBe(401);
    });

    it("accepts correct secret", async () => {
      const res = await app.request(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makePayload()),
      });
      expect(res.status).toBe(200);
    });
  });

  // ── Webhook: Known Sender ──

  describe("known sender", () => {
    const senderEmail = "known@newsletters.com";

    beforeAll(async () => {
      // Create an approved sender
      await prisma.newsletterSender.create({
        data: {
          userId,
          name: "Known Sender",
          email: senderEmail,
          active: true,
        },
      });
    });

    it("creates content item with correct fields", async () => {
      const msgId = `msg-known-${generateId()}`;
      const payload = makePayload({
        From: `Known Sender <${senderEmail}>`,
        FromName: "Known Sender",
        Subject: "Known Sender Issue #42",
        MessageID: msgId,
      });

      const res = await app.request(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(200);

      const item = await prisma.item.findFirst({
        where: { sourceId: msgId, userId },
      });
      expect(item).toBeTruthy();
      expect(item!.type).toBe("content");
      expect(item!.contentType).toBe("newsletter");
      expect(item!.title).toBe("Known Sender Issue #42");
      expect(item!.source).toBe("Known Sender");
    });

    it("deduplicates by MessageID", async () => {
      const msgId = `msg-dedup-${generateId()}`;
      const payload = makePayload({
        From: senderEmail,
        MessageID: msgId,
      });

      // First request
      await app.request(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Second request with same MessageID
      const res = await app.request(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe("duplicate");

      // Only one item should exist
      const items = await prisma.item.findMany({
        where: { sourceId: msgId, userId },
      });
      expect(items).toHaveLength(1);
    });
  });

  // ── Webhook: Case-insensitive Sender Matching ──

  describe("case-insensitive sender matching", () => {
    const senderEmail = "casematch@newsletters.com";

    beforeAll(async () => {
      await prisma.newsletterSender.create({
        data: {
          userId,
          name: "Case Match Sender",
          email: senderEmail, // stored lowercase
          active: true,
        },
      });
    });

    it("matches sender regardless of case", async () => {
      const msgId = `msg-case-${generateId()}`;
      const payload = makePayload({
        From: "CaseMatch@Newsletters.COM",
        MessageID: msgId,
      });

      const res = await app.request(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(200);

      const item = await prisma.item.findFirst({
        where: { sourceId: msgId, userId },
      });
      expect(item).toBeTruthy();
      expect(item!.contentType).toBe("newsletter");
    });
  });

  // ── Webhook: Unknown Sender ──

  describe("unknown sender", () => {
    it("creates pending newsletter and approval task", async () => {
      const msgId = `msg-unknown-${generateId()}`;
      const payload = makePayload({
        From: "unknown-sender@example.com",
        FromName: "Unknown Sender",
        Subject: "New Newsletter",
        MessageID: msgId,
      });

      const res = await app.request(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(200);

      // Should have a pending record
      const pending = await prisma.pendingNewsletter.findFirst({
        where: { postmarkMessageId: msgId, userId },
      });
      expect(pending).toBeTruthy();
      expect(pending!.senderEmail).toBe("unknown-sender@example.com");

      // Should have an approval task
      const task = await prisma.item.findFirst({
        where: {
          userId,
          sourceId: `newsletter-approve:unknown-sender@example.com`,
          status: "active",
        },
      });
      expect(task).toBeTruthy();
      expect(task!.title).toContain("Approve newsletter sender");
    });
  });

  // ── Webhook: Blocked Sender ──

  describe("blocked sender", () => {
    const blockedEmail = "blocked@newsletters.com";

    beforeAll(async () => {
      await prisma.newsletterSender.create({
        data: {
          userId,
          name: "Blocked Sender",
          email: blockedEmail,
          active: false,
        },
      });
    });

    it("silently drops emails from blocked senders", async () => {
      const msgId = `msg-blocked-${generateId()}`;
      const payload = makePayload({
        From: blockedEmail,
        MessageID: msgId,
      });

      const res = await app.request(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe("blocked sender");

      // No item should be created
      const item = await prisma.item.findFirst({
        where: { sourceId: msgId, userId },
      });
      expect(item).toBeNull();
    });
  });

  // ── Webhook: Malformed Payload ──

  describe("malformed payload", () => {
    it("returns 200 for invalid JSON", async () => {
      const res = await app.request(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json {{{",
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe("malformed payload");
    });

    it("returns 200 for missing required fields", async () => {
      const res = await app.request(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ From: "test@test.com" }), // missing Subject, Body, MessageID
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe("missing required fields");
    });
  });

  // ── Webhook: TextBody Fallback ──

  describe("TextBody fallback", () => {
    it("uses TextBody when HtmlBody is empty", async () => {
      const senderEmail = "textonly@newsletters.com";
      await prisma.newsletterSender.create({
        data: { userId, name: "Text Sender", email: senderEmail, active: true },
      });

      const msgId = `msg-textonly-${generateId()}`;
      const payload = makePayload({
        From: senderEmail,
        HtmlBody: "",
        TextBody: "Plain text newsletter content",
        MessageID: msgId,
      });

      const res = await app.request(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(200);

      const item = await prisma.item.findFirst({
        where: { sourceId: msgId, userId },
      });
      expect(item).toBeTruthy();
      expect(item!.contentBody).toContain("Plain text newsletter content");
      expect(item!.contentBody).toContain("<pre");
    });
  });

  // ── Library: Approve Flow ──

  describe("approve flow", () => {
    it("creates sender, ingests pending newsletters, completes task", async () => {
      const senderEmail = "approve-test@newsletters.com";
      const msgId = `msg-approve-${generateId()}`;

      // Create a pending newsletter via the library
      const { pendingId, taskId } = await createPendingNewsletter({
        userId,
        senderName: "Approve Test",
        senderEmail,
        subject: "Approve Me",
        htmlBody: "<p>Approve this</p>",
        textBody: null,
        messageId: msgId,
        receivedAt: new Date().toISOString(),
      });

      expect(pendingId).toBeTruthy();
      expect(taskId).toBeTruthy();

      // Approve
      const result = await approveSender(userId, pendingId);
      expect(result.senderId).toBeTruthy();
      expect(result.ingestedCount).toBe(1);

      // Sender should exist and be active
      const sender = await findApprovedSender(userId, senderEmail);
      expect(sender).toBeTruthy();
      expect(sender!.active).toBe(true);

      // Pending records should be cleaned up
      const remaining = await prisma.pendingNewsletter.findMany({
        where: { userId, senderEmail },
      });
      expect(remaining).toHaveLength(0);

      // Task should be completed
      const task = await prisma.item.findUnique({ where: { id: taskId } });
      expect(task!.status).toBe("done");

      // Item should exist
      const item = await prisma.item.findFirst({
        where: { sourceId: msgId, userId },
      });
      expect(item).toBeTruthy();
      expect(item!.contentType).toBe("newsletter");
    });
  });

  // ── Library: Block Flow ──

  describe("block flow", () => {
    it("creates inactive sender, deletes pending, completes task", async () => {
      const senderEmail = "block-test@newsletters.com";
      const msgId = `msg-block-${generateId()}`;

      // Create a pending newsletter
      const { pendingId, taskId } = await createPendingNewsletter({
        userId,
        senderName: "Block Test",
        senderEmail,
        subject: "Block Me",
        htmlBody: "<p>Block this</p>",
        textBody: null,
        messageId: msgId,
        receivedAt: new Date().toISOString(),
      });

      // Block
      await blockSender(userId, pendingId);

      // Sender should exist but be inactive
      const sender = await prisma.newsletterSender.findFirst({
        where: { userId, email: senderEmail },
      });
      expect(sender).toBeTruthy();
      expect(sender!.active).toBe(false);

      // Pending records should be cleaned up
      const remaining = await prisma.pendingNewsletter.findMany({
        where: { userId, senderEmail },
      });
      expect(remaining).toHaveLength(0);

      // Task should be completed
      const task = await prisma.item.findUnique({ where: { id: taskId } });
      expect(task!.status).toBe("done");

      // No content item should be created
      const item = await prisma.item.findFirst({
        where: { sourceId: msgId, userId },
      });
      expect(item).toBeNull();
    });
  });
});
