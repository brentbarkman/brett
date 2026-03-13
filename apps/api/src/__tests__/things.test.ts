import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { app } from "../app.js";

describe("Things routes", () => {
  let token: string;
  let listId: string;

  beforeAll(async () => {
    const user = await createTestUser("Things User");
    token = user.token;

    // Create a list for items
    const listRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Work", colorClass: "bg-blue-500" }),
    });
    const list = (await listRes.json()) as any;
    listId = list.id;
  });

  it("GET /things returns empty array initially", async () => {
    const res = await authRequest("/things", token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("POST /things creates a thing", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "task",
        title: "My first task",
        listId,
        description: "A description",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.title).toBe("My first task");
    expect(body.type).toBe("task");
    expect(body.list).toBe("Work");
    expect(body.status).toBe("inbox");
    expect(body.isCompleted).toBe(false);
    expect(body.source).toBe("Brett");
    expect(body.description).toBe("A description");
  });

  it("POST /things rejects missing title", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", listId }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /things rejects invalid type", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "banana", title: "Bad", listId }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /things rejects invalid listId", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "task",
        title: "Bad list",
        listId: "nonexistent",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /things returns created things", async () => {
    const res = await authRequest("/things", token);
    const body = (await res.json()) as any[];
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].title).toBe("My first task");
  });

  it("GET /things filters by status", async () => {
    const res = await authRequest("/things?status=inbox", token);
    const body = (await res.json()) as any[];
    expect(body.every((t: any) => t.status === "inbox")).toBe(true);
  });

  it("GET /things filters by type", async () => {
    const res = await authRequest("/things?type=task", token);
    const body = (await res.json()) as any[];
    expect(body.every((t: any) => t.type === "task")).toBe(true);
  });

  it("GET /things/:id returns a single thing", async () => {
    const listRes = await authRequest("/things", token);
    const things = (await listRes.json()) as any[];
    const id = things[0].id;

    const res = await authRequest(`/things/${id}`, token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe(id);
  });

  it("GET /things/:id returns 404 for nonexistent", async () => {
    const res = await authRequest("/things/nonexistent", token);
    expect(res.status).toBe(404);
  });

  it("PATCH /things/:id updates a thing", async () => {
    const listRes = await authRequest("/things", token);
    const things = (await listRes.json()) as any[];
    const id = things[0].id;

    const res = await authRequest(`/things/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ title: "Updated title", status: "active" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.title).toBe("Updated title");
    expect(body.status).toBe("active");
  });

  it("PATCH /things/:id/toggle toggles completion", async () => {
    const listRes = await authRequest("/things", token);
    const things = (await listRes.json()) as any[];
    const id = things[0].id;

    // Toggle on
    const res1 = await authRequest(`/things/${id}/toggle`, token, {
      method: "PATCH",
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as any;
    expect(body1.isCompleted).toBe(true);
    expect(body1.status).toBe("done");

    // Toggle off
    const res2 = await authRequest(`/things/${id}/toggle`, token, {
      method: "PATCH",
    });
    const body2 = (await res2.json()) as any;
    expect(body2.isCompleted).toBe(false);
    expect(body2.status).toBe("active");
  });

  it("DELETE /things/:id deletes a thing", async () => {
    // Create one to delete
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Delete me", listId }),
    });
    const { id } = (await createRes.json()) as any;

    const res = await authRequest(`/things/${id}`, token, { method: "DELETE" });
    expect(res.status).toBe(200);

    // Verify gone
    const getRes = await authRequest(`/things/${id}`, token);
    expect(getRes.status).toBe(404);
  });

  it("GET /things returns 401 without auth", async () => {
    const res = await app.request("/things");
    expect(res.status).toBe(401);
  });

  it("things are isolated between users", async () => {
    const otherUser = await createTestUser("Other Things User");
    const res = await authRequest("/things", otherUser.token);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(0);
  });
});
