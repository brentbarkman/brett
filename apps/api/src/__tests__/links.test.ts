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

  it("links are bidirectional — both items show the link", async () => {
    // Create a fresh link (previous test deleted the A→B link)
    await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemBId, toItemType: "task" }),
    });

    // Task A should show link to Task B
    const detailA = (await (await authRequest(`/things/${itemAId}`, token)).json()) as any;
    expect(detailA.links.length).toBe(1);
    expect(detailA.links[0].toItemId).toBe(itemBId);
    expect(detailA.links[0].toItemTitle).toBe("Task B");

    // Task B should also show link to Task A (reverse direction, same link record)
    const detailB = (await (await authRequest(`/things/${itemBId}`, token)).json()) as any;
    expect(detailB.links.length).toBe(1);
    expect(detailB.links[0].toItemId).toBe(itemAId);
    expect(detailB.links[0].toItemTitle).toBe("Task A");

    // Both should reference the same link ID
    expect(detailA.links[0].id).toBe(detailB.links[0].id);

    // Deleting from either side removes it from both
    const linkId = detailB.links[0].id;
    await authRequest(`/things/${itemBId}/links/${linkId}`, token, { method: "DELETE" });

    const afterA = (await (await authRequest(`/things/${itemAId}`, token)).json()) as any;
    const afterB = (await (await authRequest(`/things/${itemBId}`, token)).json()) as any;
    expect(afterA.links.length).toBe(0);
    expect(afterB.links.length).toBe(0);
  });

  it("POST /things/:id/links rejects self-link", async () => {
    const res = await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemAId, toItemType: "task" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/links rejects non-existent target item", async () => {
    const res = await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: "nonexistent-id", toItemType: "task" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /things/:id/links rejects invalid toItemType", async () => {
    const res = await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemBId, toItemType: "banana" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /things/:id/links to other user's item is rejected", async () => {
    const user2 = await createTestUser("Link User 2");
    const resC = await authRequest("/things", user2.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Secret Task" }),
    });
    const itemCId = ((await resC.json()) as any).id;

    // User 1 cannot link to user 2's item — target not found
    const res = await authRequest(`/things/${itemAId}/links`, token, {
      method: "POST",
      body: JSON.stringify({ toItemId: itemCId, toItemType: "task" }),
    });
    expect(res.status).toBe(404);
  });
});
