import { describe, it, expect } from "vitest";
import { prisma } from "../lib/prisma.js";
import { createTestUser } from "./helpers.js";
import { GranolaProvider } from "../services/meeting-providers/granola-provider.js";

describe("GranolaProvider multi-account", () => {
  it("isAvailable returns true when at least one account exists", async () => {
    const user = await createTestUser("Multi-Granola isAvail true");
    await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `multi-isavail-${Date.now()}@example.com`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    const provider = new GranolaProvider();
    expect(await provider.isAvailable(user.userId)).toBe(true);
  });

  it("isAvailable returns false when the user has zero accounts", async () => {
    const user = await createTestUser("Multi-Granola isAvail false");
    const provider = new GranolaProvider();
    expect(await provider.isAvailable(user.userId)).toBe(false);
  });

  it("allows two GranolaAccount rows for the same user with different emails", async () => {
    // Schema-level regression guard for the @@unique([userId, email]) constraint.
    const user = await createTestUser("Multi-Granola schema");

    const a = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `schema-a-${Date.now()}@example.com`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    const b = await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email: `schema-b-${Date.now()}@example.com`,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    expect(a.id).not.toBe(b.id);

    const all = await prisma.granolaAccount.findMany({
      where: { userId: user.userId },
    });
    expect(all).toHaveLength(2);
  });

  it("rejects two GranolaAccount rows with the same (userId, email)", async () => {
    const user = await createTestUser("Multi-Granola dup-email");
    const email = `dup-${Date.now()}@example.com`;

    await prisma.granolaAccount.create({
      data: {
        userId: user.userId,
        email,
        accessToken: "encrypted:fake",
        refreshToken: "encrypted:fake",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });

    await expect(
      prisma.granolaAccount.create({
        data: {
          userId: user.userId,
          email,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      }),
    ).rejects.toThrow();
  });
});
