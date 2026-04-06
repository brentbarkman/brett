import type { MeetingNoteProvider } from "./types.js";
import { GranolaProvider } from "./granola-provider.js";
import { GoogleMeetProvider } from "./google-meet-provider.js";
import { syncForEvent, syncRecent, initialSync } from "./coordinator.js";

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

export const providerRegistry = new MeetingProviderRegistry();

// Register providers
providerRegistry.register(new GranolaProvider());
providerRegistry.register(new GoogleMeetProvider());

// Coordinator singleton — wraps the standalone coordinator functions
export const meetingCoordinator = { syncForEvent, syncRecent, initialSync };
