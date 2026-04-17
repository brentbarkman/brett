import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { app } from "../app.js";

/**
 * Apple fetches `/.well-known/apple-app-site-association` directly from the
 * RP domain to verify the `webcredentials:` associated-domain declared in
 * the iOS app's entitlements. If this route regresses, passkey registration
 * silently fails on device with an obscure "authorization-services" error.
 *
 * The checks here mirror what Apple's validator looks for:
 *  - HTTPS path, no redirect, content-type application/json
 *  - `webcredentials.apps` is an array of `<TeamID>.<BundleID>` strings
 *  - 200 status (not 301/302 — Apple rejects redirects)
 */
describe("/.well-known/apple-app-site-association", () => {
  const originalTeamId = process.env.APPLE_TEAM_ID;
  const originalBundleId = process.env.APPLE_BUNDLE_ID;

  beforeEach(() => {
    delete process.env.APPLE_TEAM_ID;
    delete process.env.APPLE_BUNDLE_ID;
  });

  afterEach(() => {
    if (originalTeamId !== undefined) process.env.APPLE_TEAM_ID = originalTeamId;
    else delete process.env.APPLE_TEAM_ID;
    if (originalBundleId !== undefined) process.env.APPLE_BUNDLE_ID = originalBundleId;
    else delete process.env.APPLE_BUNDLE_ID;
  });

  it("returns 200 with application/json content type", async () => {
    process.env.APPLE_TEAM_ID = "ABCDEF1234";

    const res = await app.request("/.well-known/apple-app-site-association");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("includes webcredentials.apps with <TeamID>.<BundleID> when both env vars are set", async () => {
    process.env.APPLE_TEAM_ID = "ABCDEF1234";
    process.env.APPLE_BUNDLE_ID = "com.brett.app";

    const res = await app.request("/.well-known/apple-app-site-association");
    const body = (await res.json()) as {
      webcredentials: { apps: string[] };
    };

    expect(body.webcredentials.apps).toEqual(["ABCDEF1234.com.brett.app"]);
  });

  it("defaults bundle ID to com.brett.app when APPLE_BUNDLE_ID is unset", async () => {
    process.env.APPLE_TEAM_ID = "ABCDEF1234";

    const res = await app.request("/.well-known/apple-app-site-association");
    const body = (await res.json()) as {
      webcredentials: { apps: string[] };
    };

    expect(body.webcredentials.apps).toEqual(["ABCDEF1234.com.brett.app"]);
  });

  it("returns empty apps array when APPLE_TEAM_ID is unset (config-missing signal, not 404)", async () => {
    // No team id — passkeys won't work, but the route stays syntactically
    // valid so operators can diagnose via curl instead of hitting a 404.
    const res = await app.request("/.well-known/apple-app-site-association");
    const body = (await res.json()) as {
      webcredentials: { apps: string[] };
    };

    expect(res.status).toBe(200);
    expect(body.webcredentials.apps).toEqual([]);
  });

  it("includes applinks stub for future Universal Links support", async () => {
    process.env.APPLE_TEAM_ID = "ABCDEF1234";

    const res = await app.request("/.well-known/apple-app-site-association");
    const body = (await res.json()) as {
      applinks: { apps: string[]; details: Array<{ appIDs: string[] }> };
    };

    expect(body.applinks).toBeDefined();
    expect(Array.isArray(body.applinks.apps)).toBe(true);
    expect(body.applinks.details[0]?.appIDs).toEqual(["ABCDEF1234.com.brett.app"]);
  });

  it("sets a short cache-control so operators can iterate on setup", async () => {
    process.env.APPLE_TEAM_ID = "ABCDEF1234";

    const res = await app.request("/.well-known/apple-app-site-association");

    expect(res.headers.get("cache-control")).toMatch(/max-age=\d+/);
  });

  it("trims whitespace around env values", async () => {
    process.env.APPLE_TEAM_ID = "  ABCDEF1234  ";
    process.env.APPLE_BUNDLE_ID = "  com.brett.app  ";

    const res = await app.request("/.well-known/apple-app-site-association");
    const body = (await res.json()) as {
      webcredentials: { apps: string[] };
    };

    expect(body.webcredentials.apps).toEqual(["ABCDEF1234.com.brett.app"]);
  });
});
