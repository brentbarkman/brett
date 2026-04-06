/**
 * Scrub PII from provider raw data before storage.
 * Follows the same pattern as scrubRawEvent() in calendar-sync.ts.
 */
export function scrubProviderRawData(provider: string, rawData: unknown): unknown {
  if (!rawData || typeof rawData !== "object") return rawData;

  switch (provider) {
    case "granola":
      return scrubGranolaRawData(rawData as Record<string, unknown>);
    case "google_meet":
      return scrubGoogleMeetRawData(rawData as Record<string, unknown>);
    default:
      return rawData;
  }
}

function scrubGranolaRawData(data: Record<string, unknown>): Record<string, unknown> {
  const { attendees, participants, known_participants, ...safe } = data;
  return {
    ...safe,
    attendeeCount: Array.isArray(attendees) ? attendees.length : undefined,
  };
}

function scrubGoogleMeetRawData(data: Record<string, unknown>): Record<string, unknown> {
  const { suggestionsViewMode, namedStyles, suggestedInsertions, suggestedDeletions, ...safe } = data;
  return safe;
}
