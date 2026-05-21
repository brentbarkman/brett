import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { prisma } from "../lib/prisma.js";
import { createRelinkTask } from "../lib/connection-health.js";
import { createTestUser, authRequest } from "./helpers.js";
import { fetchGranolaEmail } from "../routes/granola-auth.js";

describe("Granola Auth routes", () => {
  describe("GET /granola/auth", () => {
    it("returns connected=false and accounts=[] for a user with no accounts", async () => {
      const user = await createTestUser("Granola GET empty");
      const res = await authRequest("/granola/auth", user.token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { connected: boolean; accounts: unknown[] };
      expect(body.connected).toBe(false);
      expect(body.accounts).toEqual([]);
    });

    it("returns connected=true with all of the user's accounts in the array", async () => {
      const user = await createTestUser("Granola GET multi");
      await prisma.granolaAccount.create({
        data: {
          userId: user.userId,
          email: `get-a-${Date.now()}@example.com`,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });
      await prisma.granolaAccount.create({
        data: {
          userId: user.userId,
          email: `get-b-${Date.now()}@example.com`,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });

      const res = await authRequest("/granola/auth", user.token);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        connected: boolean;
        accounts: { id: string; email: string }[];
      };
      expect(body.connected).toBe(true);
      expect(body.accounts).toHaveLength(2);
      // Both accounts should be present; order is by createdAt asc
      expect(body.accounts.every((a) => typeof a.id === "string")).toBe(true);
      expect(body.accounts.every((a) => typeof a.email === "string")).toBe(true);
    });
  });

  describe("DELETE /granola/auth/:accountId", () => {
    it("deletes the specified account and resolves its re-link task", async () => {
      const user = await createTestUser("Granola DELETE id");
      const account = await prisma.granolaAccount.create({
        data: {
          userId: user.userId,
          email: `del-${Date.now()}@example.com`,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });
      await createRelinkTask(user.userId, "granola", account.id, "Token expired");

      const activeBefore = await prisma.item.findFirst({
        where: {
          userId: user.userId,
          source: "system",
          sourceId: { startsWith: "relink:granola:" },
          status: "active",
        },
      });
      expect(activeBefore).not.toBeNull();

      const res = await authRequest(`/granola/auth/${account.id}`, user.token, {
        method: "DELETE",
      });
      expect(res.status).toBe(200);

      const remaining = await prisma.granolaAccount.findUnique({
        where: { id: account.id },
      });
      expect(remaining).toBeNull();

      const activeAfter = await prisma.item.findFirst({
        where: {
          userId: user.userId,
          source: "system",
          sourceId: { startsWith: "relink:granola:" },
          status: "active",
        },
      });
      expect(activeAfter).toBeNull();
    });

    it("returns 404 when the accountId belongs to a different user", async () => {
      const owner = await createTestUser("Granola DELETE owner");
      const attacker = await createTestUser("Granola DELETE attacker");
      const account = await prisma.granolaAccount.create({
        data: {
          userId: owner.userId,
          email: `owned-${Date.now()}@example.com`,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });

      const res = await authRequest(`/granola/auth/${account.id}`, attacker.token, {
        method: "DELETE",
      });
      expect(res.status).toBe(404);

      // Account must still exist
      const stillThere = await prisma.granolaAccount.findUnique({
        where: { id: account.id },
      });
      expect(stillThere).not.toBeNull();
    });

    it("only resolves the deleted account's re-link task, not other accounts'", async () => {
      // Regression guard for the multi-account re-link bug: the provider-wide
      // resolveRelinkTask used to dismiss every Granola re-link task for the
      // user — so disconnecting a healthy account would silently clear a
      // broken account's prompt. We now scope the resolve by accountId.
      const user = await createTestUser("Granola DELETE scoped relink");

      const brokenAccount = await prisma.granolaAccount.create({
        data: {
          userId: user.userId,
          email: `broken-${Date.now()}@example.com`,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });
      const healthyAccount = await prisma.granolaAccount.create({
        data: {
          userId: user.userId,
          email: `healthy-${Date.now()}@example.com`,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });

      // Both accounts have re-link tasks (e.g. both failed at some point)
      await createRelinkTask(user.userId, "granola", brokenAccount.id, "broken");
      await createRelinkTask(user.userId, "granola", healthyAccount.id, "healthy was once broken");

      const res = await authRequest(
        `/granola/auth/${healthyAccount.id}`,
        user.token,
        { method: "DELETE" },
      );
      expect(res.status).toBe(200);

      // The broken account's re-link task must still be active.
      const brokenTaskAfter = await prisma.item.findFirst({
        where: {
          userId: user.userId,
          source: "system",
          sourceId: `relink:granola:${brokenAccount.id}`,
          status: "active",
        },
      });
      expect(brokenTaskAfter).not.toBeNull();

      // The deleted (healthy) account's re-link task should be resolved.
      const healthyTaskAfter = await prisma.item.findFirst({
        where: {
          userId: user.userId,
          source: "system",
          sourceId: `relink:granola:${healthyAccount.id}`,
          status: "active",
        },
      });
      expect(healthyTaskAfter).toBeNull();
    });

    it("returns 404 when the accountId does not exist", async () => {
      const user = await createTestUser("Granola DELETE nonexistent");
      const res = await authRequest(
        `/granola/auth/00000000-0000-0000-0000-000000000000`,
        user.token,
        { method: "DELETE" },
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /granola/auth/connect (per-user cap)", () => {
    it("rejects /connect with 400 when the user is already at the account cap", async () => {
      // Abuse-prevention guard. The route enforces a per-user cap on
      // GranolaAccount rows so a malicious or buggy client can't accumulate
      // unbounded accounts (each new account fans out into every cron tick).
      const user = await createTestUser("Granola cap");

      // Seed up to the cap (currently 5). Use distinct emails so the
      // (userId, email) unique constraint doesn't fight us.
      for (let i = 0; i < 5; i++) {
        await prisma.granolaAccount.create({
          data: {
            userId: user.userId,
            email: `cap-${i}-${Date.now()}@example.com`,
            accessToken: "encrypted:fake",
            refreshToken: "encrypted:fake",
            tokenExpiresAt: new Date(Date.now() + 3600_000),
          },
        });
      }

      const res = await authRequest("/granola/auth/connect", user.token, {
        method: "POST",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/Disconnect one before adding another/);
    });
  });

  describe("PATCH /granola/auth/:accountId/preferences", () => {
    it("updates per-account preferences with ownership check", async () => {
      const user = await createTestUser("Granola PATCH prefs");
      const account = await prisma.granolaAccount.create({
        data: {
          userId: user.userId,
          email: `prefs-${Date.now()}@example.com`,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });

      const res = await authRequest(
        `/granola/auth/${account.id}/preferences`,
        user.token,
        {
          method: "PATCH",
          body: JSON.stringify({ autoCreateMyTasks: false }),
        },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        autoCreateMyTasks: boolean;
        autoCreateFollowUps: boolean;
      };
      expect(body.autoCreateMyTasks).toBe(false);

      const updated = await prisma.granolaAccount.findUnique({
        where: { id: account.id },
      });
      expect(updated?.autoCreateMyTasks).toBe(false);
      // The other pref is untouched
      expect(updated?.autoCreateFollowUps).toBe(true);
    });

    it("returns 404 when the accountId belongs to a different user", async () => {
      const owner = await createTestUser("Granola PATCH owner");
      const attacker = await createTestUser("Granola PATCH attacker");
      const account = await prisma.granolaAccount.create({
        data: {
          userId: owner.userId,
          email: `prefs-owned-${Date.now()}@example.com`,
          accessToken: "encrypted:fake",
          refreshToken: "encrypted:fake",
          tokenExpiresAt: new Date(Date.now() + 3600_000),
        },
      });

      const res = await authRequest(
        `/granola/auth/${account.id}/preferences`,
        attacker.token,
        {
          method: "PATCH",
          body: JSON.stringify({ autoCreateMyTasks: false }),
        },
      );
      expect(res.status).toBe(404);

      // Ownership-check failure must not mutate state
      const unchanged = await prisma.granolaAccount.findUnique({
        where: { id: account.id },
      });
      expect(unchanged?.autoCreateMyTasks).toBe(true);
    });
  });

  describe("fetchGranolaEmail (userinfo lookup)", () => {
    // The OAuth callback can't trust `tokens.email` (Granola does not return a
    // top-level email claim on the token endpoint) and explicitly refuses to
    // trust an unverified id_token. The fix is to fetch the email from the
    // userinfo endpoint with the access token. These tests pin that behavior.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("returns the email claim from the userinfo response", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ sub: "user-1", email: "work@example.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const email = await fetchGranolaEmail("access-token-1");
      expect(email).toBe("work@example.com");

      // Must hit the userinfo endpoint with a Bearer auth header.
      const [url, init] = fetchSpy.mock.calls[0]!;
      expect(String(url)).toBe("https://mcp-auth.granola.ai/oauth2/userinfo");
      expect((init as RequestInit | undefined)?.headers).toMatchObject({
        Authorization: "Bearer access-token-1",
      });
    });

    it("normalizes the email to lowercase and trims whitespace", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ email: "  Brent@Example.COM  " }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      expect(await fetchGranolaEmail("token")).toBe("brent@example.com");
    });

    it("throws when userinfo returns a non-2xx response", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("forbidden", { status: 403 }),
      );
      await expect(fetchGranolaEmail("expired-token")).rejects.toThrow(/userinfo/i);
    });

    it("throws when the userinfo response has no email claim", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ sub: "user-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await expect(fetchGranolaEmail("token")).rejects.toThrow(/email/i);
    });

    it("throws when the userinfo response email is not a syntactically valid email", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ email: "not-an-email" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      await expect(fetchGranolaEmail("token")).rejects.toThrow(/email/i);
    });

    it("throws when userinfo returns invalid JSON", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("<html>not json</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      );
      await expect(fetchGranolaEmail("token")).rejects.toThrow();
    });

    it("never logs the access token in thrown error messages", async () => {
      vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("forbidden", { status: 403 }),
      );
      const accessToken = "super-secret-access-token-xyz";
      try {
        await fetchGranolaEmail(accessToken);
        throw new Error("expected fetchGranolaEmail to throw");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).not.toContain(accessToken);
      }
    });
  });

  describe("OAuth callback re-link scoping (source regression)", () => {
    // Granola was the FIRST place we hit the multi-account re-link bug —
    // the provider-wide resolveRelinkTask silently cleared every Granola
    // re-link task when ANY account reconnected. The fix is to call the
    // per-account resolver everywhere this route file resolves tasks.
    // This source-level test catches a regression at the call site directly
    // (the full OAuth callback chain is too heavy to mock end-to-end).
    it("granola-auth.ts uses the per-account resolver, never the provider-wide one", () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const source = readFileSync(
        resolve(here, "../routes/granola-auth.ts"),
        "utf8",
      );
      const callSites = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .filter((line) => !line.includes("import"))
        .join("\n");
      // `\b` ensures we don't match `resolveRelinkTaskForAccount`.
      expect(callSites).not.toMatch(/\bresolveRelinkTask\s*\(/);
      expect(callSites).toMatch(/resolveRelinkTaskForAccount\s*\(/);
    });
  });

  describe("OAuth callback email resolution (source regression)", () => {
    // Multi-account regression: the original code keyed every connect on
    // `tokens.email ?? user.email`, which silently overwrote the previous
    // GranolaAccount when Granola didn't return a top-level email claim
    // (which is always — it doesn't). The fix routes email resolution
    // through fetchGranolaEmail (which hits /userinfo).
    it("granola-auth.ts uses fetchGranolaEmail and does not fall back to the Brett user email", () => {
      const here = dirname(fileURLToPath(import.meta.url));
      const source = readFileSync(
        resolve(here, "../routes/granola-auth.ts"),
        "utf8",
      );
      const codeOnly = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .filter((line) => !line.includes("import"))
        .join("\n");
      // Positive: must call the userinfo helper somewhere in the route.
      expect(codeOnly).toMatch(/fetchGranolaEmail\s*\(/);
      // Negative: no email-resolution fallback through Brett's user.email
      // or the unsigned tokens.email field. (The helper's own definition
      // is at the top of the file; `user.email` and `tokens.email` are
      // only meaningful as right-hand-side reads — we forbid both.)
      expect(codeOnly).not.toMatch(/\buser\.email\b/);
      expect(codeOnly).not.toMatch(/\btokens\.email\b/);
    });
  });
});
