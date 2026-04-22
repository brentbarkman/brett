import type { ExtendedPrismaClient } from "@brett/api-core";

const FILLER_WORDS = /\b(meeting|call|chat|sync|standup|check-in|catch-?up|session|with|my|the|from|about)\b/gi;

function cleanQuery(query: string): string {
  return query.replace(FILLER_WORDS, "").replace(/\s+/g, " ").trim();
}

export interface MeetingSearchResult {
  id: string;
  calendarEventId: string | null;
  title: string;
  summary: string | null;
  actionItems: unknown;
  meetingStartedAt: Date;
}

/**
 * Shared strategy cascade that returns up to `take` meetings matching the
 * query. Tries in order:
 *  1. Direct title contains the query
 *  2. Title contains the query with filler words stripped
 *  3. Follow a calendar event title search to linked meetings
 *  4. Attendee name/email match across the 50 most recent meetings
 *  5. Individual significant words from the cleaned query
 *
 * The singular and plural public helpers are thin wrappers on this cascade
 * so a fix to any strategy lands in both places (previously they drifted —
 * the singular version fell back to the raw `query` for calendar events
 * while the plural used `searchTerms`).
 */
async function searchMeetings(
  prisma: ExtendedPrismaClient,
  userId: string,
  query: string,
  take: number,
): Promise<MeetingSearchResult[]> {
  // 1. Direct title contains
  let meetings = await prisma.meetingNote.findMany({
    where: { userId, title: { contains: query, mode: "insensitive" } },
    orderBy: { meetingStartedAt: "desc" },
    take,
  });
  if (meetings.length > 0) return meetings;

  // 2. Strip filler words
  const cleaned = cleanQuery(query);
  if (cleaned && cleaned !== query) {
    meetings = await prisma.meetingNote.findMany({
      where: { userId, title: { contains: cleaned, mode: "insensitive" } },
      orderBy: { meetingStartedAt: "desc" },
      take,
    });
    if (meetings.length > 0) return meetings;
  }

  const searchTerms = cleaned || query;

  // 3. Calendar event title search → linked meetings
  const calendarEvents = await prisma.calendarEvent.findMany({
    where: { userId, title: { contains: searchTerms, mode: "insensitive" } },
    orderBy: { startTime: "desc" },
    take,
    select: { id: true },
  });
  if (calendarEvents.length > 0) {
    meetings = await prisma.meetingNote.findMany({
      where: { userId, calendarEventId: { in: calendarEvents.map((e) => e.id) } },
      orderBy: { meetingStartedAt: "desc" },
      take,
    });
    if (meetings.length > 0) return meetings;
  }

  // 4. Attendee name/email match across recent meetings
  const recent = await prisma.meetingNote.findMany({
    where: { userId },
    orderBy: { meetingStartedAt: "desc" },
    take: 50,
  });
  const lowerSearch = searchTerms.toLowerCase();
  const byAttendee = recent.filter((m) => {
    if (!Array.isArray(m.attendees)) return false;
    return (m.attendees as { name: string; email: string }[]).some(
      (a) =>
        a.name.toLowerCase().includes(lowerSearch) ||
        a.email.toLowerCase().includes(lowerSearch),
    );
  });
  if (byAttendee.length > 0) return byAttendee.slice(0, take);

  // 5. Individual significant words from the cleaned query
  const words = searchTerms.split(" ").filter((w) => w.length > 2);
  for (const word of words) {
    meetings = await prisma.meetingNote.findMany({
      where: { userId, title: { contains: word, mode: "insensitive" } },
      orderBy: { meetingStartedAt: "desc" },
      take,
    });
    if (meetings.length > 0) return meetings;
  }

  return [];
}

/**
 * Find a single meeting matching the query. See `searchMeetings` for the
 * strategy cascade.
 */
export async function findMeetingByQuery(
  prisma: ExtendedPrismaClient,
  userId: string,
  query: string,
): Promise<MeetingSearchResult | null> {
  const [match] = await searchMeetings(prisma, userId, query, 1);
  return match ?? null;
}

/**
 * Find multiple meetings matching the query. See `searchMeetings` for the
 * strategy cascade.
 */
export async function findMeetingsByQuery(
  prisma: ExtendedPrismaClient,
  userId: string,
  query: string,
  take = 5,
): Promise<MeetingSearchResult[]> {
  return searchMeetings(prisma, userId, query, take);
}
