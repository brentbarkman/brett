import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "../lib/prisma.js";
import { decryptToken, encryptToken } from "../lib/encryption.js";
import {
  ensureClientRegistered,
  __resetCachedClientForTests,
} from "../routes/granola-auth.js";

const GRANOLA_REGISTER_URL = "https://mcp-auth.granola.ai/oauth2/register";

function mockRegisterResponse(client_id: string, client_secret?: string): Response {
  return new Response(
    JSON.stringify({ client_id, ...(client_secret ? { client_secret } : {}) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function clearOAuthClientRow(): Promise<void> {
  await prisma.oAuthClient.deleteMany({ where: { provider: "granola" } });
}

describe("Granola DCR client persistence", () => {
  beforeEach(async () => {
    __resetCachedClientForTests();
    await clearOAuthClientRow();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    __resetCachedClientForTests();
    await clearOAuthClientRow();
  });

  it("registers on first cold call and persists the client to the DB", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url === GRANOLA_REGISTER_URL) {
          return mockRegisterResponse("client_FIRST_BOOT", "secret_one");
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      });

    const client = await ensureClientRegistered();

    expect(client.client_id).toBe("client_FIRST_BOOT");
    expect(client.client_secret).toBe("secret_one");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const row = await prisma.oAuthClient.findUniqueOrThrow({
      where: { provider: "granola" },
    });
    expect(row.clientId).toBe("client_FIRST_BOOT");
    // Secret is stored encrypted, not plaintext.
    expect(row.clientSecret).not.toBe("secret_one");
    expect(row.clientSecret).not.toBeNull();
    expect(decryptToken(row.clientSecret!)).toBe("secret_one");
  });

  it("reads the persisted client from the DB on subsequent boots without a network call", async () => {
    // Simulate a previous boot having persisted a client.
    await prisma.oAuthClient.create({
      data: {
        provider: "granola",
        clientId: "client_FROM_PRIOR_BOOT",
        clientSecret: encryptToken("secret_from_prior_boot"),
      },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error(
        "ensureClientRegistered must not call fetch when a persisted client exists",
      );
    });

    const client = await ensureClientRegistered();

    expect(client.client_id).toBe("client_FROM_PRIOR_BOOT");
    expect(client.client_secret).toBe("secret_from_prior_boot");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("survives a concurrent first-boot race: both callers see the same client_id and exactly one DB row remains", async () => {
    // Granola DCR is not idempotent — every POST returns a new client_id.
    // Mock that: each fetch call returns a fresh id so the loser's id is
    // distinguishable from the winner's. The unique constraint on
    // OAuthClient.provider must collapse both callers onto the same row.
    let counter = 0;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : (input as Request).url;
        if (url === GRANOLA_REGISTER_URL) {
          counter += 1;
          return mockRegisterResponse(`client_RACE_${counter}`, `secret_${counter}`);
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      });

    const [a, b] = await Promise.all([
      ensureClientRegistered(),
      ensureClientRegistered(),
    ]);

    expect(a.client_id).toBe(b.client_id);
    expect(a.client_secret).toBe(b.client_secret);

    const rows = await prisma.oAuthClient.findMany({
      where: { provider: "granola" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].clientId).toBe(a.client_id);

    // Both callers raced past the SELECT and both issued DCR posts; the
    // unique constraint funneled them onto one row. We don't assert the
    // exact fetch count because the in-memory cache may short-circuit one
    // call if the timing is right — but it must have hit Granola at least
    // once.
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
