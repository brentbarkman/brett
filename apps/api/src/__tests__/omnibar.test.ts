import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { createTestUser, authRequest } from "./helpers.js";

describe("Brett Omnibar routes", () => {
  let token: string;

  beforeAll(async () => {
    const user = await createTestUser("Omnibar User");
    token = user.token;
  });

  it("rejects unauthenticated requests", async () => {
    const res = await app.request("/brett/omnibar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /brett/omnibar with valid query does not return 401", async () => {
    const res = await authRequest("/brett/omnibar", token, {
      method: "POST",
      body: JSON.stringify({ query: "test search" }),
    });
    // May return 200 (results) or 500 (no AI provider configured in test env)
    // but must NOT return 401 — auth is valid
    expect(res.status).not.toBe(401);
  });
});
