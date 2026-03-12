import { describe, it, expect } from "vitest";
import { app } from "../app.js";

// These tests require a running Postgres instance.
// Run `pnpm db:up` and `pnpm db:migrate` before running tests.

describe("Auth routes", () => {
  it("POST /api/auth/sign-up/email creates a user and returns a bearer token", async () => {
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `test-${Date.now()}@example.com`,
        password: "password123",
        name: "Test User",
      }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.user).toBeDefined();
    expect(body.user.name).toBe("Test User");
    expect(body.token).toBeDefined();
  });

  it("POST /api/auth/sign-in/email signs in and returns a bearer token", async () => {
    const email = `signin-${Date.now()}@example.com`;

    // Sign up first
    await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "password123",
        name: "Sign In User",
      }),
    });

    // Then sign in
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.user).toBeDefined();
    expect(body.user.email).toBe(email);
    expect(body.token).toBeDefined();
  });

  it("POST /api/auth/sign-in/email rejects wrong password", async () => {
    const email = `wrongpw-${Date.now()}@example.com`;

    // Sign up first
    await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "password123",
        name: "Wrong PW User",
      }),
    });

    // Try with wrong password
    const res = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "wrongpassword" }),
    });

    expect(res.status).not.toBe(200);
  });

  it("GET /users/me returns 401 without token", async () => {
    const res = await app.request("/users/me");
    expect(res.status).toBe(401);
  });

  it("GET /users/me returns user with valid bearer token", async () => {
    const email = `me-${Date.now()}@example.com`;

    // Sign up to get a token
    const signUpRes = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: "password123",
        name: "Me User",
      }),
    });

    const { token } = (await signUpRes.json()) as any;
    expect(token).toBeDefined();

    // Use the bearer token to get /users/me
    const res = await app.request("/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.email).toBe(email);
    expect(body.name).toBe("Me User");
  });
});
