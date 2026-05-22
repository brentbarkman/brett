/**
 * Regression guard for the multi-user cache-leak bug surfaced in the
 * review of PR #189. The explicit AuthContext.signOut() path always
 * cleared the React Query cache and the diagnostics ring buffer, but the
 * automatic `handleUnauthorized()` path (fired on any 401 from the API)
 * cleared only the bearer token — leaving user A's `["things", ...]` /
 * `["inbox"]` / `["briefing", ...]` entries in the global QueryClient.
 * If user A's session was revoked server-side and user B then signed in
 * on the same desktop install, user B's first render would briefly read
 * user A's cached data via key match.
 *
 * The fix routes both paths through a shared `wipeUserState()` helper
 * that clears the registered QueryClient and the diagnostics buffer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";

// Stub better-auth so importing auth-client doesn't construct a real
// network client. The `signOut` mock resolves immediately so
// handleUnauthorized's `await authClient.signOut()` completes.
vi.mock("better-auth/react", () => ({
  createAuthClient: vi.fn(() => ({
    signOut: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("@better-auth/passkey/client", () => ({
  passkeyClient: vi.fn(() => ({})),
}));

vi.mock("../../lib/diagnostics", () => ({
  diagnostics: {
    clear: vi.fn(),
  },
}));

import { handleUnauthorized, setQueryClient, wipeUserState } from "../auth-client";
import { diagnostics } from "../../lib/diagnostics";

describe("auth-client cleanup wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the registered ref between tests by replacing with a fresh client.
    setQueryClient(new QueryClient());
  });

  it("wipeUserState clears the registered React Query cache", () => {
    const qc = new QueryClient();
    qc.setQueryData(["things"], [{ id: "leak" }]);
    setQueryClient(qc);

    expect(qc.getQueryData(["things"])).toEqual([{ id: "leak" }]);
    wipeUserState();
    expect(qc.getQueryData(["things"])).toBeUndefined();
  });

  it("wipeUserState clears the diagnostics ring buffer", () => {
    wipeUserState();
    expect(diagnostics.clear).toHaveBeenCalledTimes(1);
  });

  // The bug. Before the fix, handleUnauthorized cleared the bearer token
  // only — leaving cached per-user data in the QueryClient that the next
  // user's first render would read.
  it("handleUnauthorized clears the registered React Query cache so a re-sign-in can't read the prior session's data", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["things"], [{ id: "user-a-thing" }]);
    qc.setQueryData(["inbox"], { visible: [{ id: "user-a-inbox" }] });
    setQueryClient(qc);

    await handleUnauthorized();

    expect(qc.getQueryData(["things"])).toBeUndefined();
    expect(qc.getQueryData(["inbox"])).toBeUndefined();
  });

  it("handleUnauthorized also clears the diagnostics buffer", async () => {
    await handleUnauthorized();
    expect(diagnostics.clear).toHaveBeenCalled();
  });
});
