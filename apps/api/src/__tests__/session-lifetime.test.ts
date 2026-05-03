import { describe, it, expect } from "vitest";
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
    // Assert "more than 1 year out" — clearly non-expiring by intent.
    // Below the 400-day cookie-spec ceiling so the test still passes,
    // and well above the 7-day default so any accidental revert is caught.
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    const diff = session!.expiresAt.getTime() - before;
    expect(diff).toBeGreaterThan(oneYearMs);
  });
});
