export interface UserProfile {
  preferences: Record<string, string>; // key -> value for preference facts
  context: Record<string, string>; // current role, company, projects
  relationships: Record<string, string>; // known people and relationships
  habits: Record<string, string>; // behavioral patterns
  generatedAt: string; // ISO timestamp
}

// In-memory cache: userId -> { profile, cachedAt }
const profileCache = new Map<string, { profile: UserProfile; cachedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Build a structured UserProfile from the user's active facts.
 * Groups facts by category into a structured object.
 */
export async function buildUserProfile(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
): Promise<UserProfile> {
  const facts = await prisma.userFact.findMany({
    where: { userId, validUntil: null },
    select: { category: true, key: true, value: true },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const profile: UserProfile = {
    preferences: {},
    context: {},
    relationships: {},
    habits: {},
    generatedAt: new Date().toISOString(),
  };

  for (const fact of facts) {
    switch (fact.category) {
      case "preference":
        if (!(fact.key in profile.preferences)) {
          profile.preferences[fact.key] = fact.value;
        }
        break;
      case "context":
        if (!(fact.key in profile.context)) {
          profile.context[fact.key] = fact.value;
        }
        break;
      case "relationship":
        if (!(fact.key in profile.relationships)) {
          profile.relationships[fact.key] = fact.value;
        }
        break;
      case "habit":
        if (!(fact.key in profile.habits)) {
          profile.habits[fact.key] = fact.value;
        }
        break;
    }
  }

  return profile;
}

/**
 * Get the user's profile, with in-memory caching.
 * Returns cached profile if within TTL, otherwise rebuilds.
 * Returns null if the profile has no content (user has no facts yet).
 */
export async function getCachedUserProfile(
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
): Promise<UserProfile | null> {
  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.profile;
  }

  const profile = await buildUserProfile(userId, prisma);

  // Only cache if the profile has content
  const hasContent =
    Object.keys(profile.preferences).length > 0 ||
    Object.keys(profile.context).length > 0 ||
    Object.keys(profile.relationships).length > 0 ||
    Object.keys(profile.habits).length > 0;

  if (!hasContent) return null;

  profileCache.set(userId, { profile, cachedAt: Date.now() });
  return profile;
}

/**
 * Invalidate the cached profile for a user.
 * Call after consolidation or fact changes.
 */
export function invalidateProfileCache(userId: string): void {
  profileCache.delete(userId);
}

/**
 * Format a UserProfile as a string block for system prompt injection.
 */
export function formatProfileForPrompt(profile: UserProfile): string {
  const sections: string[] = [];

  if (Object.keys(profile.preferences).length > 0) {
    sections.push(
      "Preferences:\n" +
        Object.entries(profile.preferences)
          .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`)
          .join("\n"),
    );
  }
  if (Object.keys(profile.context).length > 0) {
    sections.push(
      "Context:\n" +
        Object.entries(profile.context)
          .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`)
          .join("\n"),
    );
  }
  if (Object.keys(profile.relationships).length > 0) {
    sections.push(
      "Relationships:\n" +
        Object.entries(profile.relationships)
          .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`)
          .join("\n"),
    );
  }
  if (Object.keys(profile.habits).length > 0) {
    sections.push(
      "Habits:\n" +
        Object.entries(profile.habits)
          .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`)
          .join("\n"),
    );
  }

  return sections.join("\n\n");
}
