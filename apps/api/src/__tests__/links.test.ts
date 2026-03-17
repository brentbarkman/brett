import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Link routes", () => {
  let token: string;
  let itemAId: string;
  let itemBId: string;

  beforeAll(async () => {
    const user = await createTestUser("Link User");
    token = user.token;
    const resA = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Task A" }),
    });
    itemAId = ((await resA.json()) as any).id;
    const resB = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Task B" }),
    });
    itemBId = ((await resB.json()) as any).id;
  });

  it("POST /things/:id/links creates a link", async () => {
    const res = await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemBId, toItemType: "task" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.toItemId).toBe(itemBId);
  });

  it("POST /things/:id/links rejects duplicate link", async () => {
    const res = await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemBId, toItemType: "task" }),
    });
    expect(res.status).toBe(409);
  });

  it("GET /things/:id returns links in detail", async () => {
    const res = await authRequest(`/things/${itemAId}`, token);
    const detail = (await res.json()) as any;
    expect(detail.links.length).toBe(1);
    expect(detail.links[0].toItemTitle).toBe("Task B");
  });

  it("DELETE /things/:id/links/:linkId removes a link", async () => {
    const detailRes = await authRequest(`/things/${itemAId}`, token);
    const detail = (await detailRes.json()) as any;
    const linkId = detail.links[0].id;

    const res = await authRequest(`/things/${itemAId}/links/${linkId}`, token, { method: "DELETE" });
    expect(res.status).toBe(200);

    const afterRes = await authRequest(`/things/${itemAId}`, token);
    const after = (await afterRes.json()) as any;
    expect(after.links.length).toBe(0);
  });

  it("POST /things/:id/links rejects self-link", async () => {
    const res = await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemAId, toItemType: "task" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/links rejects invalid toItemType", async () => {
    const res = await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemBId, toItemType: "banana" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/links to other user's item does not leak title", async () => {
    const user2 = await createTestUser("Link User 2");
    const resC = await authRequest("/things", user2.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Secret Task" }),
    });
    const itemCId = ((await resC.json()) as any).id;

    // User 1 links to user 2's item
    await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemCId, toItemType: "task" }),
    });

    // Get detail — toItemTitle should be undefined (not "Secret Task")
    const detailRes = await authRequest(`/things/${itemAId}`, token);
    const detail = (await detailRes.json()) as any;
    const crossLink = detail.links.find((l: any) => l.toItemId === itemCId);
    expect(crossLink).toBeTruthy();
    expect(crossLink.toItemTitle).toBeUndefined();
  });
});
