import { describe, it, expect, beforeAll } from "vitest";
import { app } from "../app.js";
import { prisma } from "../lib/prisma.js";

describe("better-auth session lifetime", () => {
  it("issues effectively-non-expiring sessions for email/password sign-up", async () => {
    const email = `lifetime-test-${Date.now()}@example.com`;
    const before = Date.now();
    const res = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "Test-Password-1234",
        name: "Lifetime Test",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const session = await prisma.session.findUnique({
      where: { token: body.token },
      select: { expiresAt: true },
    });
    expect(session).not.toBeNull();
    // Assert "more than 300 days out" — well above the 7-day default, and
    // flexible enough to survive future tweaks as long as the intent of
    // "effectively non-expiring" is preserved. The current config sets 400 days
    // (the browser cookie spec maximum enforced by better-auth's serializer).
    const threeHundredDaysMs = 300 * 24 * 60 * 60 * 1000;
    const diff = session!.expiresAt.getTime() - before;
    expect(diff).toBeGreaterThan(threeHundredDaysMs);
  });
});
