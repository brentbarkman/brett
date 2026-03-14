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
    expect(body.completedCount).toBe(0);
    expect(body.sortOrder).toBe(0);
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

  it("POST /lists auto-assigns incrementing sortOrder", async () => {
    const res = await authRequest("/lists", token, {
      method: "POST",
      body: JSON.stringify({ name: "Personal" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.sortOrder).toBe(1);
  });

  it("GET /lists returns lists ordered by sortOrder", async () => {
    const res = await authRequest("/lists", token);
    const body = (await res.json()) as any[];
    expect(body.length).toBe(2);
    expect(body[0].name).toBe("Work");
    expect(body[0].sortOrder).toBe(0);
    expect(body[1].name).toBe("Personal");
    expect(body[1].sortOrder).toBe(1);
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
    expect(body.sortOrder).toBe(0);
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

  describe("PUT /lists/reorder", () => {
    let reorderToken: string;
    let listIds: string[];

    beforeAll(async () => {
      const user = await createTestUser("Reorder User");
      reorderToken = user.token;

      // Create 3 lists
      const names = ["Alpha", "Beta", "Gamma"];
      listIds = [];
      for (const name of names) {
        const res = await authRequest("/lists", reorderToken, {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        const body = (await res.json()) as any;
        listIds.push(body.id);
      }
    });

    it("reorders lists", async () => {
      // Reverse the order
      const reversed = [...listIds].reverse();
      const res = await authRequest("/lists/reorder", reorderToken, {
        method: "PUT",
        body: JSON.stringify({ ids: reversed }),
      });
      expect(res.status).toBe(200);

      // Verify new order
      const getRes = await authRequest("/lists", reorderToken);
      const lists = (await getRes.json()) as any[];
      expect(lists[0].name).toBe("Gamma");
      expect(lists[1].name).toBe("Beta");
      expect(lists[2].name).toBe("Alpha");
    });

    it("rejects empty ids array", async () => {
      const res = await authRequest("/lists/reorder", reorderToken, {
        method: "PUT",
        body: JSON.stringify({ ids: [] }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid list IDs", async () => {
      const res = await authRequest("/lists/reorder", reorderToken, {
        method: "PUT",
        body: JSON.stringify({ ids: ["fake-id-1", "fake-id-2", "fake-id-3"] }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects partial list IDs", async () => {
      const res = await authRequest("/lists/reorder", reorderToken, {
        method: "PUT",
        body: JSON.stringify({ ids: [listIds[0]] }),
      });
      expect(res.status).toBe(400);
    });
  });
});
