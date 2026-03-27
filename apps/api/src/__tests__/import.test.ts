import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("POST /import/things3", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Import User");
    token = user.token;
  });

  it("imports lists and tasks in a single transaction", async () => {
    const res = await authRequest("/import/things3", token, {
      method: "POST",
      body: JSON.stringify({
        lists: [
          { name: "Work", thingsUuid: "proj-1" },
          { name: "Personal", thingsUuid: "proj-2" },
        ],
        tasks: [
          { title: "Buy milk", status: "active" },
          { title: "Ship feature", status: "active", thingsProjectUuid: "proj-1" },
          {
            title: "Old task",
            status: "done",
            completedAt: "2024-01-15T10:00:00.000Z",
            thingsProjectUuid: "proj-2",
          },
          {
            title: "With due date",
            status: "active",
            dueDate: "2024-06-15",
            thingsProjectUuid: "proj-1",
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.lists).toBe(2);
    expect(body.tasks).toBe(4);
  });

  it("sets source to 'Things 3' on imported items", async () => {
    const res = await authRequest("/things?source=Things%203", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((t: any) => t.source === "Things 3")).toBe(true);
  });

  it("maps thingsProjectUuid to correct listId", async () => {
    const listsRes = await authRequest("/lists", token);
    const lists = (await listsRes.json()) as any[];
    const workList = lists.find((l: any) => l.name === "Work");
    expect(workList).toBeDefined();

    const tasksRes = await authRequest(`/things?listId=${workList.id}`, token);
    const tasks = (await tasksRes.json()) as any[];
    const featureTask = tasks.find((t: any) => t.title === "Ship feature");
    expect(featureTask).toBeDefined();
  });

  it("handles completed tasks with completedAt", async () => {
    const res = await authRequest("/things?status=done&source=Things%203", token);
    const tasks = (await res.json()) as any[];
    const oldTask = tasks.find((t: any) => t.title === "Old task");
    expect(oldTask).toBeDefined();
    expect(oldTask.isCompleted).toBe(true);
    expect(oldTask.completedAt).toBeDefined();
  });

  it("rejects empty payload", async () => {
    const res = await authRequest("/import/things3", token, {
      method: "POST",
      body: JSON.stringify(null),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated request", async () => {
    const res = await authRequest("/import/things3", "bad-token", {
      method: "POST",
      body: JSON.stringify({ lists: [], tasks: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("deduplicates list names by appending a number", async () => {
    const res = await authRequest("/import/things3", token, {
      method: "POST",
      body: JSON.stringify({
        lists: [{ name: "Work", thingsUuid: "proj-dup" }],
        tasks: [],
      }),
    });
    expect(res.status).toBe(201);

    const listsRes = await authRequest("/lists", token);
    const lists = (await listsRes.json()) as any[];
    const workLists = lists.filter((l: any) => l.name.startsWith("Work"));
    expect(workLists.length).toBe(2);
    expect(workLists.some((l: any) => l.name === "Work (2)")).toBe(true);
  });

  it("handles tasks with no project (inbox items)", async () => {
    const res = await authRequest("/things?source=Things%203", token);
    const tasks = (await res.json()) as any[];
    const inboxTask = tasks.find((t: any) => t.title === "Buy milk");
    expect(inboxTask).toBeDefined();
    expect(inboxTask.listId).toBeNull();
  });
});
