import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";

describe("Recurring task toggle", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Recurrence User");
    token = user.token;
  });

  it("completing a recurring task creates a new task", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Daily standup" }),
    });
    const task = (await createRes.json()) as any;

    await authRequest(`/things/${task.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ recurrence: "daily", notes: "Check in with team" }),
    });

    const toggleRes = await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });
    const toggled = (await toggleRes.json()) as any;
    expect(toggled.isCompleted).toBe(true);

    const allRes = await authRequest("/things?status=active", token);
    const all = (await allRes.json()) as any[];
    const newTask = all.find((t: any) => t.title === "Daily standup" && t.id !== task.id);
    expect(newTask).toBeTruthy();
    expect(newTask.isCompleted).toBe(false);
  });

  it("completing a non-recurring task does NOT create a new task", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "One-off task" }),
    });
    const task = (await createRes.json()) as any;

    await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });

    const allRes = await authRequest("/things", token);
    const all = (await allRes.json()) as any[];
    const matches = all.filter((t: any) => t.title === "One-off task");
    expect(matches.length).toBe(1);
  });

  it("completing a recurring task without dueDate creates new task with null dueDate", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "No date recurring" }),
    });
    const task = (await createRes.json()) as any;

    await authRequest(`/things/${task.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ recurrence: "daily" }),
    });

    await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });

    const allRes = await authRequest("/things?status=active", token);
    const all = (await allRes.json()) as any[];
    const newTask = all.find((t: any) => t.title === "No date recurring" && t.id !== task.id);
    expect(newTask).toBeTruthy();
    // No dueDate on original → no dueDate on new task
    expect(newTask.dueDate).toBeUndefined();
  });

  it("uncompleting a task does NOT create a new task", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Toggle back" }),
    });
    const task = (await createRes.json()) as any;

    await authRequest(`/things/${task.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ recurrence: "weekly" }),
    });
    await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });
    await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });

    const allRes = await authRequest("/things", token);
    const all = (await allRes.json()) as any[];
    const matches = all.filter((t: any) => t.title === "Toggle back");
    expect(matches.length).toBe(2); // original + 1 from first completion
  });
});
