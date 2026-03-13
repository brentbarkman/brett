import { describe, it, expect, beforeAll } from "vitest";
import { createTestUser, authRequest } from "./helpers.js";
import { app } from "../app.js";

describe("Lists routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Lists User");
    token = user.token;
  });

  it("GET /lists returns empty array initially", async () => {
    const res = await authRequest("/lists", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it("POST /lists creates a list", async () => {
    const res = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Work", colorClass: "bg-blue-500" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Work");
    expect(body.colorClass).toBe("bg-blue-500");
    expect(body.count).toBe(0);
  });

  it("POST /lists rejects duplicate name", async () => {
    const res = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Work" }),
    });
    expect(res.status).toBe(409);
  });

  it("POST /lists rejects empty name", async () => {
    const res = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /lists returns created lists with counts", async () => {
    const res = await authRequest("/lists", token);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(1);
    expect(body[0].name).toBe("Work");
  });

  it("PATCH /lists/:id updates a list", async () => {
    // Get list id
    const getRes = await authRequest("/lists", token);
    const lists = (await getRes.json()) as any[];
    const listId = lists[0].id;

    const res = await authRequest(`/lists/${listId}`, token, {
      method: "PATCH",
      body: JSON.stringify({ name: "Work Updated" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.name).toBe("Work Updated");
  });

  it("DELETE /lists/:id deletes a list", async () => {
    // Create a list to delete
    const createRes = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "To Delete" }),
    });
    const { id } = (await createRes.json()) as any;

    const res = await authRequest(`/lists/${id}`, token, { method: "DELETE" });
    expect(res.status).toBe(200);

    // Verify gone
    const getRes = await authRequest("/lists", token);
    const lists = (await getRes.json()) as any[];
    expect(lists.find((l: any) => l.id === id)).toBeUndefined();
  });

  it("GET /lists returns 401 without auth", async () => {
    const res = await app.request("/lists");
    expect(res.status).toBe(401);
  });

  it("lists are isolated between users", async () => {
    const otherUser = await createTestUser("Other User");
    const res = await authRequest("/lists", otherUser.token);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(0);
  });
});
