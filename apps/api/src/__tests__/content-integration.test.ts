import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Content lifecycle", () => {
  let token: string;
  let listId: string;

  beforeAll(async () => {
    const user = await createTestUser("Content Lifecycle User");
    token = user.token;
    const listRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Reading", colorClass: "bg-amber-500" }),
    });
    const list = (await listRes.json()) as any;
    listId = list.id;
  });

  // 1. Create content item — verify pending status and auto-source
  it("creates content item with auto-pending status and domain source", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "https://example.com/article",
        sourceUrl: "https://example.com/article",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.type).toBe("content");
    expect(body.contentStatus).toBe("pending");
    expect(body.source).toBe("example.com");
  });

  // 2. Create content with explicit contentType
  it("creates content with explicit contentType", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "https://youtube.com/watch?v=abc",
        sourceUrl: "https://youtube.com/watch?v=abc",
        contentType: "video",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.contentType).toBe("video");
    expect(body.contentStatus).toBe("pending");
  });

  // 3. Create content in a list — verify listId is preserved
  it("creates content item in a specific list", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "https://medium.com/test",
        sourceUrl: "https://medium.com/test",
        listId,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.listId).toBe(listId);
    expect(body.list).toBe("Reading");
  });

  // 4. PATCH content fields — simulate extraction completing
  it("updates content fields via PATCH (simulates extraction)", async () => {
    // Create without sourceUrl to avoid triggering auto-extraction (which races with the PATCH below)
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "content", title: "Test" }),
    });
    const item = (await createRes.json()) as any;

    const patchRes = await authRequest(`/things/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        title: "Extracted Title",
        contentType: "article",
        contentStatus: "extracted",
        contentTitle: "Original Article Title",
        contentDescription: "A great article about testing",
        contentBody: "<p>Article content here</p>",
        contentDomain: "example.com",
        contentFavicon: "https://example.com/favicon.ico",
        contentImageUrl: "https://example.com/og.jpg",
        contentMetadata: { type: "article", wordCount: 500 },
      }),
    });
    expect(patchRes.status).toBe(200);

    // Verify detail endpoint returns all content fields
    const detailRes = await authRequest(`/things/${item.id}`, token);
    const detail = (await detailRes.json()) as any;
    expect(detail.contentType).toBe("article");
    expect(detail.contentStatus).toBe("extracted");
    expect(detail.contentTitle).toBe("Original Article Title");
    expect(detail.contentDescription).toBe("A great article about testing");
    expect(detail.contentBody).toBe("<p>Article content here</p>");
    expect(detail.contentDomain).toBe("example.com");
    expect(detail.contentFavicon).toBe("https://example.com/favicon.ico");
    expect(detail.contentImageUrl).toBe("https://example.com/og.jpg");
    expect(detail.contentMetadata).toEqual({ type: "article", wordCount: 500 });
  });

  // 5. Toggle content completion
  it("toggles content item completion", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "content", title: "Complete me", sourceUrl: "https://example.com/complete" }),
    });
    const item = (await createRes.json()) as any;
    expect(item.isCompleted).toBe(false);

    const toggleRes = await authRequest(`/things/${item.id}/toggle`, token, { method: "PATCH" });
    expect(toggleRes.status).toBe(200);
    const toggled = (await toggleRes.json()) as any;
    expect(toggled.isCompleted).toBe(true);
  });

  // 6. Filter by type=content
  it("filters things by type=content", async () => {
    const res = await authRequest("/things?type=content", token);
    const items = (await res.json()) as any[];
    expect(items.length).toBeGreaterThan(0);
    items.forEach((item: any) => expect(item.type).toBe("content"));
  });

  // 7. Filter by type=task excludes content
  it("filters things by type=task excludes content items", async () => {
    // Create a task to ensure we have one
    await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "A real task" }),
    });

    const res = await authRequest("/things?type=task", token);
    const items = (await res.json()) as any[];
    items.forEach((item: any) => expect(item.type).toBe("task"));
  });

  // 8. Content item has links, attachments, Brett thread (same as tasks)
  it("supports links on content items", async () => {
    const contentRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "content", title: "Article", sourceUrl: "https://example.com/a" }),
    });
    const content = (await contentRes.json()) as any;

    const taskRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Related task" }),
    });
    const task = (await taskRes.json()) as any;

    // Link content to task
    const linkRes = await authRequest(`/things/${content.id}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: task.id, toItemType: "task" }),
    });
    expect(linkRes.status).toBe(201);

    // Verify link appears in content detail
    const detailRes = await authRequest(`/things/${content.id}`, token);
    const detail = (await detailRes.json()) as any;
    expect(detail.links.length).toBe(1);
    expect(detail.links[0].toItemId).toBe(task.id);
  });

  // 9. Validation — reject invalid sourceUrl
  it("rejects non-http sourceUrl", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "Bad URL",
        sourceUrl: "javascript:alert(1)",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects file:// sourceUrl", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "Bad URL",
        sourceUrl: "file:///etc/passwd",
      }),
    });
    expect(res.status).toBe(400);
  });

  // 10. Validation — reject invalid contentType
  it("rejects invalid contentType", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "content",
        title: "Test",
        sourceUrl: "https://example.com",
        contentType: "banana",
      }),
    });
    expect(res.status).toBe(400);
  });

  // 11. Validation — reject oversized contentBody via PATCH
  it("rejects contentBody over 500KB", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "content", title: "Big", sourceUrl: "https://example.com/big" }),
    });
    const item = (await createRes.json()) as any;

    const patchRes = await authRequest(`/things/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ contentBody: "x".repeat(500_001) }),
    });
    expect(patchRes.status).toBe(400);
  });

  // 12. Validation — reject untrusted embedUrl in contentMetadata
  it("rejects untrusted embedUrl in contentMetadata", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "content", title: "Test", sourceUrl: "https://example.com" }),
    });
    const item = (await createRes.json()) as any;

    const patchRes = await authRequest(`/things/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        contentMetadata: { type: "video", embedUrl: "https://evil.com/exploit" },
      }),
    });
    expect(patchRes.status).toBe(400);
  });

  // 13. Extract endpoint guards
  it("extract endpoint rejects task items", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Not content" }),
    });
    const item = (await createRes.json()) as any;

    const res = await authRequest(`/things/${item.id}/extract`, token, { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("extract endpoint rejects items without sourceUrl", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "content", title: "No URL", contentType: "pdf" }),
    });
    const item = (await createRes.json()) as any;

    const res = await authRequest(`/things/${item.id}/extract`, token, { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("extract endpoint rejects already-extracted items", async () => {
    // Create without sourceUrl to avoid triggering auto-extraction (which would race with our PATCH)
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "content", title: "Done" }),
    });
    const item = (await createRes.json()) as any;

    // Set sourceUrl and contentStatus atomically via PATCH
    await authRequest(`/things/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ sourceUrl: "https://example.com/done", contentStatus: "extracted", contentType: "web_page" }),
    });

    const res = await authRequest(`/things/${item.id}/extract`, token, { method: "POST" });
    expect(res.status).toBe(400);
  });
});
