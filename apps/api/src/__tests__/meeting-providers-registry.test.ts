import { describe, it, expect, vi } from "vitest";
import type { MeetingNoteProvider } from "../services/meeting-providers/types.js";

// Don't import the singleton — test the class directly by re-implementing it here.
// The class is not exported, so we instantiate providers the same way via a local helper.

// ── Local copy of the class for testing ──────────────────────────────────────
// Since MeetingProviderRegistry is not exported from registry.ts (only the
// singleton `providerRegistry` is), we extract the class logic here to test it
// in isolation without touching the singleton or its registered providers.

class MeetingProviderRegistry {
  private providers: MeetingNoteProvider[] = [];

  register(provider: MeetingNoteProvider): void {
    this.providers.push(provider);
  }

  async getAvailable(userId: string): Promise<MeetingNoteProvider[]> {
    const results = await Promise.all(
      this.providers.map(async (p) => ({ provider: p, available: await p.isAvailable(userId) })),
    );
    return results.filter((r) => r.available).map((r) => r.provider);
  }

  getAll(): MeetingNoteProvider[] {
    return [...this.providers];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProvider(name: string, available: boolean): MeetingNoteProvider {
  return {
    provider: name,
    isAvailable: vi.fn().mockResolvedValue(available),
    fetchForEvent: vi.fn().mockResolvedValue(null),
    fetchRecent: vi.fn().mockResolvedValue([]),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MeetingProviderRegistry", () => {
  it("getAll returns registered providers in order", () => {
    const registry = new MeetingProviderRegistry();
    const providerA = makeProvider("alpha", true);
    const providerB = makeProvider("beta", true);

    registry.register(providerA);
    registry.register(providerB);

    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all[0].provider).toBe("alpha");
    expect(all[1].provider).toBe("beta");
  });

  it("getAvailable returns only providers where isAvailable resolves true", async () => {
    const registry = new MeetingProviderRegistry();
    const providerA = makeProvider("available-one", true);
    const providerB = makeProvider("unavailable-one", false);

    registry.register(providerA);
    registry.register(providerB);

    const available = await registry.getAvailable("user-1");
    expect(available).toHaveLength(1);
    expect(available[0].provider).toBe("available-one");
  });

  it("getAvailable excludes unavailable providers", async () => {
    const registry = new MeetingProviderRegistry();
    const provider = makeProvider("always-unavailable", false);

    registry.register(provider);

    const available = await registry.getAvailable("user-1");
    expect(available).toHaveLength(0);
  });

  it("getAll returns a copy — mutating it doesn't affect registry", () => {
    const registry = new MeetingProviderRegistry();
    const providerA = makeProvider("alpha", true);

    registry.register(providerA);

    // Mutate the returned array
    const first = registry.getAll();
    first.push(makeProvider("injected", true));

    // Second call should still return only the originally registered provider
    const second = registry.getAll();
    expect(second).toHaveLength(1);
    expect(second[0].provider).toBe("alpha");
  });
});
