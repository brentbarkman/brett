import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("Suggestions routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Suggestions User");
    token = user.token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/api/things/nonexistent/suggestions");
    expect(res.status).toBe(401);
  });

  it("GET /api/things/:id/suggestions returns 404 for unknown item", async () => {
    const res = await authRequest("/api/things/nonexistent/suggestions", token);
    expect(res.status).toBe(404);
  });
});
