import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Soft delete", () => {
  let token: string;
  let listId: string;

  beforeAll(async () => {
    const user = await createTestUser("SoftDelete User");
    token = user.token;

    // Create a list to put items in
    const listRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "SD List", colorClass: "bg-red-500" }),
    });
    listId = ((await listRes.json()) as any).id;
  });

  it("DELETE /things/:id returns 200 and item disappears from GET /things", async () => {
    // Create an item
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Soft delete me", listId }),
    });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as any;

    // Delete it
    const deleteRes = await authRequest(`/things/${id}`, token, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    // It should not appear in GET /things
    const listRes = await authRequest("/things", token);
    const things = (await listRes.json()) as any[];
    expect(things.find((t: any) => t.id === id)).toBeUndefined();

    // It should return 404 on GET /things/:id
    const getRes = await authRequest(`/things/${id}`, token);
    expect(getRes.status).toBe(404);
  });

  it("soft-deleted items don't appear in GET /things", async () => {
    // Create two items
    const res1 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Keep me", listId }),
    });
    const kept = (await res1.json()) as any;

    const res2 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Delete me", listId }),
    });
    const deleted = (await res2.json()) as any;

    // Delete one
    await authRequest(`/things/${deleted.id}`, token, { method: "DELETE" });

    // Only the kept one should appear
    const listRes = await authRequest("/things", token);
    const things = (await listRes.json()) as any[];
    const ids = things.map((t: any) => t.id);
    expect(ids).toContain(kept.id);
    expect(ids).not.toContain(deleted.id);
  });

  it("DELETE /lists/:id soft-deletes the list AND its items", async () => {
    // Create a separate list with items
    const listRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Delete Cascade List", colorClass: "bg-green-500" }),
    });
    const cascadeListId = ((await listRes.json()) as any).id;

    // Add items
    const item1Res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Cascade item 1", listId: cascadeListId }),
    });
    const item1Id = ((await item1Res.json()) as any).id;

    const item2Res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Cascade item 2", listId: cascadeListId }),
    });
    const item2Id = ((await item2Res.json()) as any).id;

    // Delete the list
    const deleteRes = await authRequest(`/lists/${cascadeListId}`, token, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);

    // List should not appear in GET /lists
    const listsRes = await authRequest("/lists", token);
    const lists = (await listsRes.json()) as any[];
    expect(lists.find((l: any) => l.id === cascadeListId)).toBeUndefined();

    // Items should not appear in GET /things
    const thingsRes = await authRequest("/things", token);
    const things = (await thingsRes.json()) as any[];
    expect(things.find((t: any) => t.id === item1Id)).toBeUndefined();
    expect(things.find((t: any) => t.id === item2Id)).toBeUndefined();

    // Individual item lookups should 404
    const get1 = await authRequest(`/things/${item1Id}`, token);
    expect(get1.status).toBe(404);
    const get2 = await authRequest(`/things/${item2Id}`, token);
    expect(get2.status).toBe(404);
  });

  it("soft-deleted lists don't appear in GET /lists", async () => {
    // Create a list and delete it
    const createRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Vanishing List", colorClass: "bg-purple-500" }),
    });
    const vanishId = ((await createRes.json()) as any).id;

    await authRequest(`/lists/${vanishId}`, token, { method: "DELETE" });

    const listsRes = await authRequest("/lists", token);
    const lists = (await listsRes.json()) as any[];
    expect(lists.find((l: any) => l.id === vanishId)).toBeUndefined();
  });

  it("soft-deleted items don't appear in GET /things/inbox", async () => {
    // Create an inbox item (no list, no due date)
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Inbox soft delete" }),
    });
    const { id } = (await createRes.json()) as any;

    // Delete it
    await authRequest(`/things/${id}`, token, { method: "DELETE" });

    // Should not appear in inbox
    const inboxRes = await authRequest("/things/inbox", token);
    const inbox = (await inboxRes.json()) as any;
    expect(inbox.visible.find((t: any) => t.id === id)).toBeUndefined();
  });

  it("deleting a thing twice returns 404 on second attempt", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Double delete", listId }),
    });
    const { id } = (await createRes.json()) as any;

    // First delete succeeds
    const res1 = await authRequest(`/things/${id}`, token, { method: "DELETE" });
    expect(res1.status).toBe(200);

    // Second delete returns 404 (item is "gone")
    const res2 = await authRequest(`/things/${id}`, token, { method: "DELETE" });
    expect(res2.status).toBe(404);
  });
});
