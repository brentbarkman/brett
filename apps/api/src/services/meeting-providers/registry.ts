import type { MeetingNoteProvider } from "./types.js";

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
