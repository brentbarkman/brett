import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("AI Usage routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("AI Usage User");
    token = user.token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/ai/usage/summary");
    expect(res.status).toBe(401);
  });

  it("GET /ai/usage/summary returns usage data", async () => {
    const res = await authRequest("/ai/usage/summary", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });
});
