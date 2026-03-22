import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Extract endpoint", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Extract User");
    token = user.token;
  });

  it("POST /things/:id/extract returns 400 for non-content items", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "A task" }),
    });
    const task = (await createRes.json()) as any;

    const res = await authRequest(`/things/${task.id}/extract`, token, { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/extract returns 400 for already extracted items", async () => {
    // Create without sourceUrl to avoid triggering auto-extraction (which would race with our PATCH)
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "content", title: "Already extracted item" }),
    });
    const item = (await createRes.json()) as any;

    // Set sourceUrl and contentStatus atomically via PATCH
    await authRequest(`/things/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ sourceUrl: "https://example.com/already-extracted", contentStatus: "extracted" }),
    });

    const res = await authRequest(`/things/${item.id}/extract`, token, { method: "POST" });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/extract accepts failed items for retry", async () => {
    // Create without sourceUrl to avoid triggering auto-extraction (which would race with our PATCH)
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "content", title: "Failed item for retry" }),
    });
    const item = (await createRes.json()) as any;

    // Set sourceUrl and contentStatus atomically via PATCH
    await authRequest(`/things/${item.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ sourceUrl: "https://example.com/retry", contentStatus: "failed" }),
    });

    const res = await authRequest(`/things/${item.id}/extract`, token, { method: "POST" });
    expect(res.status).toBe(202);
  });
});
