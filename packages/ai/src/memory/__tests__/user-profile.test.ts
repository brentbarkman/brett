import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildUserProfile,
  getCachedUserProfile,
  invalidateProfileCache,
  formatProfileForPrompt,
} from "../user-profile.js";

function createMockPrisma(facts: Array<{ category: string; key: string; value: string }>) {
  return {
    userFact: {
      findMany: vi.fn().mockResolvedValue(facts),
    },
  };
}

describe("buildUserProfile", () => {
  it("groups facts by category", async () => {
    const prisma = createMockPrisma([
      { category: "preference", key: "comm_style", value: "Prefers async communication" },
      { category: "context", key: "job_role", value: "Senior Engineer at Acme" },
      { category: "relationship", key: "manager_jordan", value: "Jordan is the user's manager" },
      { category: "habit", key: "morning_reviews", value: "Reviews PRs first thing each morning" },
    ]);

    const profile = await buildUserProfile("user-1", prisma);

    expect(profile.preferences["comm_style"]).toBe("Prefers async communication");
    expect(profile.context["job_role"]).toBe("Senior Engineer at Acme");
    expect(profile.relationships["manager_jordan"]).toBe("Jordan is the user's manager");
    expect(profile.habits["morning_reviews"]).toBe("Reviews PRs first thing each morning");
    expect(profile.generatedAt).toBeTruthy();
  });

  it("returns empty profile for user with no facts", async () => {
    const prisma = createMockPrisma([]);

    const profile = await buildUserProfile("user-1", prisma);

    expect(Object.keys(profile.preferences)).toHaveLength(0);
    expect(Object.keys(profile.context)).toHaveLength(0);
    expect(Object.keys(profile.relationships)).toHaveLength(0);
    expect(Object.keys(profile.habits)).toHaveLength(0);
  });

  it("deduplicates keys (first value wins since ordered by updatedAt desc)", async () => {
    // Prisma returns facts ordered by updatedAt desc, so first occurrence = most recent
    const prisma = createMockPrisma([
      { category: "preference", key: "comm_style", value: "Prefers Slack (updated)" },
      { category: "preference", key: "comm_style", value: "Prefers email (older)" },
    ]);

    const profile = await buildUserProfile("user-1", prisma);

    expect(profile.preferences["comm_style"]).toBe("Prefers Slack (updated)");
    expect(Object.keys(profile.preferences)).toHaveLength(1);
  });

  it("queries with correct where clause (userId + validUntil: null)", async () => {
    const prisma = createMockPrisma([]);

    await buildUserProfile("user-42", prisma);

    expect(prisma.userFact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-42", validUntil: null },
      }),
    );
  });

  it("ignores facts with unknown categories", async () => {
    const prisma = createMockPrisma([
      { category: "unknown_cat", key: "some_key", value: "some value" },
      { category: "preference", key: "valid_pref", value: "A valid preference" },
    ]);

    const profile = await buildUserProfile("user-1", prisma);

    expect(Object.keys(profile.preferences)).toHaveLength(1);
    expect(profile.preferences["valid_pref"]).toBe("A valid preference");
  });
});

describe("getCachedUserProfile", () => {
  beforeEach(() => {
    // Clear the cache between tests by invalidating a range of possible test user IDs
    invalidateProfileCache("user-cache-1");
    invalidateProfileCache("user-cache-2");
    invalidateProfileCache("user-no-facts");
  });

  it("returns null when user has no facts", async () => {
    const prisma = createMockPrisma([]);

    const result = await getCachedUserProfile("user-no-facts", prisma);

    expect(result).toBeNull();
  });

  it("caches profile within TTL (does not re-query prisma on second call)", async () => {
    const prisma = createMockPrisma([
      { category: "preference", key: "comm_style", value: "Prefers Slack" },
    ]);

    const first = await getCachedUserProfile("user-cache-1", prisma);
    const second = await getCachedUserProfile("user-cache-1", prisma);

    // Same object reference (or at least same content)
    expect(second).toEqual(first);
    // findMany should only have been called once
    expect(prisma.userFact.findMany).toHaveBeenCalledTimes(1);
  });

  it("rebuilds after invalidation", async () => {
    const prisma = createMockPrisma([
      { category: "preference", key: "comm_style", value: "Prefers Slack" },
    ]);

    await getCachedUserProfile("user-cache-2", prisma);
    invalidateProfileCache("user-cache-2");
    await getCachedUserProfile("user-cache-2", prisma);

    // Should have re-queried after invalidation
    expect(prisma.userFact.findMany).toHaveBeenCalledTimes(2);
  });

  it("returns profile with content when facts exist", async () => {
    const prisma = createMockPrisma([
      { category: "context", key: "job_role", value: "Staff Engineer" },
    ]);

    const profile = await getCachedUserProfile("user-cache-1", prisma);

    expect(profile).not.toBeNull();
    expect(profile!.context["job_role"]).toBe("Staff Engineer");
  });
});

describe("formatProfileForPrompt", () => {
  it("formats sections with human-readable keys (underscores to spaces)", () => {
    const profile = {
      preferences: { comm_style: "Prefers Slack" },
      context: {},
      relationships: {},
      habits: {},
      generatedAt: new Date().toISOString(),
    };

    const result = formatProfileForPrompt(profile);

    expect(result).toContain("Preferences:");
    expect(result).toContain("- comm style: Prefers Slack");
    expect(result).not.toContain("comm_style");
  });

  it("omits empty sections", () => {
    const profile = {
      preferences: { comm_style: "Prefers Slack" },
      context: {},
      relationships: {},
      habits: {},
      generatedAt: new Date().toISOString(),
    };

    const result = formatProfileForPrompt(profile);

    expect(result).toContain("Preferences:");
    expect(result).not.toContain("Context:");
    expect(result).not.toContain("Relationships:");
    expect(result).not.toContain("Habits:");
  });

  it("returns empty string for empty profile", () => {
    const profile = {
      preferences: {},
      context: {},
      relationships: {},
      habits: {},
      generatedAt: new Date().toISOString(),
    };

    const result = formatProfileForPrompt(profile);

    expect(result).toBe("");
  });

  it("includes all non-empty sections when populated", () => {
    const profile = {
      preferences: { pref_key: "pref value" },
      context: { ctx_key: "ctx value" },
      relationships: { rel_key: "rel value" },
      habits: { hab_key: "hab value" },
      generatedAt: new Date().toISOString(),
    };

    const result = formatProfileForPrompt(profile);

    expect(result).toContain("Preferences:");
    expect(result).toContain("Context:");
    expect(result).toContain("Relationships:");
    expect(result).toContain("Habits:");
  });

  it("separates sections with double newlines", () => {
    const profile = {
      preferences: { pref_key: "pref value" },
      context: { ctx_key: "ctx value" },
      relationships: {},
      habits: {},
      generatedAt: new Date().toISOString(),
    };

    const result = formatProfileForPrompt(profile);

    expect(result).toContain("\n\n");
  });
});
