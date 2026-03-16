import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { app } from "../app.js";
import { DEFAULT_LIST_NAME } from "@brett/business";

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
    expect(body.status).toBe("active");
    expect(body.isCompleted).toBe(false);
    expect(body.source).toBe("Brett");
    expect(body.description).toBe("A description");
  });

  it("POST /things creates a thing without listId (inbox)", async () => {
    const res = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({
        type: "task",
        title: "Inbox task",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.title).toBe("Inbox task");
    expect(body.list).toBe(DEFAULT_LIST_NAME);
    expect(body.listId).toBeNull();
    expect(body.status).toBe("active");
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
    expect(body.length).toBeGreaterThanOrEqual(2);
    // Ordered by createdAt desc — newest first
    expect(body.map((t: any) => t.title)).toContain("My first task");
    expect(body.map((t: any) => t.title)).toContain("Inbox task");
  });

  it("GET /things filters by status", async () => {
    const res = await authRequest("/things?status=active", token);
    const body = (await res.json()) as any[];
    expect(body.every((t: any) => t.status === "active")).toBe(true);
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

  it("PATCH /things/:id can move thing to inbox (null listId)", async () => {
    // Get a thing that has a list
    const listRes = await authRequest("/things", token);
    const things = (await listRes.json()) as any[];
    const withList = things.find((t: any) => t.listId !== null);

    const res = await authRequest(`/things/${withList.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ listId: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.listId).toBeNull();
    expect(body.list).toBe(DEFAULT_LIST_NAME);
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

  // ── Bulk Update Tests ──

  it("PATCH /things/bulk updates multiple items", async () => {
    // Create two inbox items
    const res1 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Bulk item 1" }),
    });
    const res2 = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Bulk item 2" }),
    });
    const id1 = ((await res1.json()) as any).id;
    const id2 = ((await res2.json()) as any).id;

    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({
        ids: [id1, id2],
        updates: { listId },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.updated).toBe(2);
  });

  it("PATCH /things/bulk rejects empty ids", async () => {
    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({ ids: [], updates: { listId } }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /things/bulk rejects > 100 ids", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `fake-${i}`);
    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({ ids, updates: { listId } }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /things/bulk rejects wrong user's ids", async () => {
    const otherUser = await createTestUser("Bulk Other User");
    const createRes = await authRequest("/things", otherUser.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Other user item" }),
    });
    const otherId = ((await createRes.json()) as any).id;

    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({ ids: [otherId], updates: { status: "archived" } }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /things/bulk rejects invalid listId", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Bulk invalid list" }),
    });
    const id = ((await createRes.json()) as any).id;

    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({ ids: [id], updates: { listId: "nonexistent" } }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /things/bulk with dueDate", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Bulk date item" }),
    });
    const id = ((await createRes.json()) as any).id;

    const res = await authRequest("/things/bulk", token, {
      method: "PATCH",
      body: JSON.stringify({
        ids: [id],
        updates: { dueDate: "2026-03-20T00:00:00Z" },
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).updated).toBe(1);
  });

  // ── Inbox Tests ──

  it("GET /things/inbox returns only null-listId items", async () => {
    const res = await authRequest("/things/inbox", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.visible).toBeDefined();
    // All visible items should have null listId
    for (const item of body.visible) {
      expect(item.listId).toBeNull();
    }
  });

  it("GET /things/inbox excludes done and archived items", async () => {
    // Create an inbox item and archive it
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Archived inbox item" }),
    });
    const id = ((await createRes.json()) as any).id;
    await authRequest(`/things/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    });

    const res = await authRequest("/things/inbox", token);
    const body = (await res.json()) as any;
    const archivedInInbox = body.visible.find((t: any) => t.id === id);
    expect(archivedInInbox).toBeUndefined();
  });

  it("GET /things/inbox excludes items with due dates", async () => {
    const user = await createTestUser("Inbox Dated User");

    await authRequest("/things", user.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Dated No List", dueDate: "2026-03-20T00:00:00Z", dueDatePrecision: "day" }),
    });
    await authRequest("/things", user.token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "No Date No List" }),
    });

    const res = await authRequest("/things/inbox", user.token);
    const body = (await res.json()) as any;
    expect(body.visible.length).toBe(1);
    expect(body.visible[0].title).toBe("No Date No List");
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

describe("GET /things?dueAfter", () => {
  let daToken: string;

  beforeAll(async () => {
    const user = await createTestUser("DueAfter User");
    daToken = user.token;

    await authRequest("/things", daToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Past", dueDate: "2026-03-10T00:00:00Z", dueDatePrecision: "day" }),
    });
    await authRequest("/things", daToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Today", dueDate: "2026-03-16T00:00:00Z", dueDatePrecision: "day" }),
    });
    await authRequest("/things", daToken, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Future", dueDate: "2026-03-20T00:00:00Z", dueDatePrecision: "day" }),
    });
  });

  it("filters items with dueDate after the given date", async () => {
    const res = await authRequest("/things?dueAfter=2026-03-16T00:00:00Z", daToken);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(1);
    expect(body[0].title).toBe("Future");
  });

  it("works with dueBefore for date range", async () => {
    const res = await authRequest("/things?dueAfter=2026-03-09T00:00:00Z&dueBefore=2026-03-17T00:00:00Z", daToken);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(2);
    const titles = body.map((t: any) => t.title).sort();
    expect(titles).toEqual(["Past", "Today"]);
  });
});
