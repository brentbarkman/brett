import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Brett message routes", () => {
  let token: string;
  let itemId: string;

  beforeAll(async () => {
    const user = await createTestUser("Brett User");
    token = user.token;
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Brett test" }),
    });
    itemId = ((await res.json()) as any).id;
  });

  it("POST /things/:id/brett creates user message and gets stub response", async () => {
    const res = await authRequest(`/things/${itemId}/brett`, token, {
      method: "POST",
      body: JSON.stringify({ content: "What should I do about this?" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.userMessage.role).toBe("user");
    expect(body.userMessage.content).toBe("What should I do about this?");
    expect(body.brettMessage.role).toBe("brett");
    expect(body.brettMessage.content).toBeTruthy();
  });

  it("GET /things/:id/brett returns paginated messages", async () => {
    const res = await authRequest(`/things/${itemId}/brett`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.messages.length).toBe(2);
    expect(body.hasMore).toBe(false);
  });

  it("GET /things/:id/brett supports cursor pagination", async () => {
    for (let i = 0; i < 5; i++) {
      await authRequest(`/things/${itemId}/brett`, token, {
        method: "POST",
        body: JSON.stringify({ content: `Message ${i}` }),
      });
    }

    const res = await authRequest(`/things/${itemId}/brett?limit=4`, token);
    const body = (await res.json()) as any;
    expect(body.messages.length).toBe(4);
    expect(body.hasMore).toBe(true);
    expect(body.cursor).toBeTruthy();

    const res2 = await authRequest(`/things/${itemId}/brett?limit=20&cursor=${body.cursor}`, token);
    const body2 = (await res2.json()) as any;
    expect(body2.messages.length).toBeGreaterThan(0);
    expect(body2.hasMore).toBe(false);
  });

  it("POST /things/:id/brett rejects empty content", async () => {
    const res = await authRequest(`/things/${itemId}/brett`, token, {
      method: "POST",
      body: JSON.stringify({ content: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/brett-take returns a stub observation", async () => {
    const res = await authRequest(`/things/${itemId}/brett-take`, token, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.brettObservation).toBeTruthy();
    expect(body.brettTakeGeneratedAt).toBeTruthy();
  });

  it("GET /things/:id/brett rejects invalid cursor", async () => {
    const res = await authRequest(`/things/${itemId}/brett?cursor=not-a-date`, token);
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/brett rejects non-existent item", async () => {
    const res = await authRequest("/things/nonexistent/brett", token, {
      method: "POST",
      body: JSON.stringify({ content: "hello" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /things/:id/brett rejects non-existent item", async () => {
    const res = await authRequest("/things/nonexistent/brett", token);
    expect(res.status).toBe(404);
  });

  it("POST /things/:id/brett-take rejects non-existent item", async () => {
    const res = await authRequest("/things/nonexistent/brett-take", token, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});
