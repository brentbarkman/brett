import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("AI Config routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("AI Config User");
    token = user.token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/ai/config");
    expect(res.status).toBe(401);
  });

  it("GET /ai/config returns provider config", async () => {
    const res = await authRequest("/ai/config", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });
});
