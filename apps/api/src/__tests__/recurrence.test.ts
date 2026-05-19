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

  it("setting recurrence on an already-completed task spawns next occurrence", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Retroactive recurrence" }),
    });
    const task = (await createRes.json()) as any;

    // Complete it first (no recurrence)
    await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });

    // Now set recurrence on the completed task
    await authRequest(`/things/${task.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ recurrence: "weekly" }),
    });

    // A new active task should have been spawned
    const allRes = await authRequest("/things?status=active", token);
    const all = (await allRes.json()) as any[];
    const newTask = all.find((t: any) => t.title === "Retroactive recurrence" && t.id !== task.id);
    expect(newTask).toBeTruthy();
    expect(newTask.isCompleted).toBe(false);
  });

  it("setting recurrence on an already-recurring completed task does NOT double-spawn", async () => {
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Already recurring" }),
    });
    const task = (await createRes.json()) as any;

    // Set recurrence, then complete (spawns one)
    await authRequest(`/things/${task.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ recurrence: "daily" }),
    });
    await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });

    // Change recurrence type on the completed task — should NOT spawn again
    await authRequest(`/things/${task.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ recurrence: "weekly" }),
    });

    const allRes = await authRequest("/things", token);
    const all = (await allRes.json()) as any[];
    const matches = all.filter((t: any) => t.title === "Already recurring");
    expect(matches.length).toBe(2); // original + 1 from toggle, NOT 3
  });

  it("completing a recurring task with tonight=true spawns next occurrence with tonight=true", async () => {
    // Recurring evening tasks (e.g. "take medication tonight", "review tomorrow's
    // calendar tonight") are the whole point of the Tonight bucket — the flag
    // MUST carry across spawns. Resetting it would silently change behavior.
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Tonight recurring" }),
    });
    const task = (await createRes.json()) as any;

    // Set tonight + recurrence on the original (tonight is only mutable via PATCH).
    await authRequest(`/things/${task.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ recurrence: "daily", tonight: true }),
    });

    await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });

    const allRes = await authRequest("/things?status=active", token);
    const all = (await allRes.json()) as any[];
    const newTask = all.find(
      (t: any) => t.title === "Tonight recurring" && t.id !== task.id,
    );
    expect(newTask).toBeTruthy();
    expect(newTask.tonight).toBe(true);
  });

  it("completing a recurring task with tonight=false spawns next occurrence with tonight=false", async () => {
    // Sanity check: when the source isn't a Tonight task, the spawn must NOT
    // suddenly opt-in to the Tonight bucket. Default flag stays default.
    const createRes = await authRequest("/things", token, {
      method: "POST",
      body: JSON.stringify({ type: "task", title: "Non-tonight recurring" }),
    });
    const task = (await createRes.json()) as any;
    expect(task.tonight).toBe(false);

    await authRequest(`/things/${task.id}`, token, {
      method: "PATCH",
      body: JSON.stringify({ recurrence: "daily" }),
    });

    await authRequest(`/things/${task.id}/toggle`, token, { method: "PATCH" });

    const allRes = await authRequest("/things?status=active", token);
    const all = (await allRes.json()) as any[];
    const newTask = all.find(
      (t: any) => t.title === "Non-tonight recurring" && t.id !== task.id,
    );
    expect(newTask).toBeTruthy();
    expect(newTask.tonight).toBe(false);
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
