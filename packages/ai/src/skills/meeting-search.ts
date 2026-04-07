import type { PrismaClient } from "@brett/api-core";

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
 * Search for a Granola meeting by title, attendee name, or linked calendar event.
 * Tries multiple strategies in order:
 * 1. Direct title contains
 * 2. Title contains with filler words stripped
 * 3. Calendar event title search (follows link to meeting)
 * 4. Attendee name search (in-memory filter on recent meetings)
 * 5. Individual word search on title
 */
export async function findMeetingByQuery(
  prisma: PrismaClient,
  userId: string,
  query: string,
): Promise<MeetingSearchResult | null> {
  console.log("[meeting-search] query:", JSON.stringify(query));

  // 1. Direct title contains
  const exact = await prisma.meetingNote.findFirst({
    where: { userId, title: { contains: query, mode: "insensitive" } },
    orderBy: { meetingStartedAt: "desc" },
  });
  if (exact) { console.log("[meeting-search] found via direct title:", exact.title); return exact; }

  // 2. Strip filler words and retry
  const cleaned = cleanQuery(query);
  console.log("[meeting-search] cleaned query:", JSON.stringify(cleaned));
  if (cleaned && cleaned !== query) {
    const fuzzy = await prisma.meetingNote.findFirst({
      where: { userId, title: { contains: cleaned, mode: "insensitive" } },
      orderBy: { meetingStartedAt: "desc" },
    });
    if (fuzzy) return fuzzy;
  }

  const searchTerms = cleaned || query;

  // 3. Search calendar events by title, then follow the link to meeting
  const calendarEvent = await prisma.calendarEvent.findFirst({
    where: { userId, title: { contains: searchTerms, mode: "insensitive" } },
    orderBy: { startTime: "desc" },
    select: { id: true },
  });
  if (calendarEvent) {
    const linked = await prisma.meetingNote.findFirst({
      where: { userId, calendarEventId: calendarEvent.id },
    });
    if (linked) return linked;
  }

  // 4. Attendee name search — fetch recent meetings and filter by attendee names
  const recent = await prisma.meetingNote.findMany({
    where: { userId },
    orderBy: { meetingStartedAt: "desc" },
    take: 50,
  });
  const lowerSearch = searchTerms.toLowerCase();
  const byAttendee = recent.find((m) => {
    if (!Array.isArray(m.attendees)) return false;
    return (m.attendees as { name: string; email: string }[]).some(
      (a) =>
        a.name.toLowerCase().includes(lowerSearch) ||
        a.email.toLowerCase().includes(lowerSearch),
    );
  });
  if (byAttendee) return byAttendee;

  // 5. Individual significant words on title
  const words = searchTerms.split(" ").filter((w) => w.length > 2);
  for (const word of words) {
    const byWord = await prisma.meetingNote.findFirst({
      where: { userId, title: { contains: word, mode: "insensitive" } },
      orderBy: { meetingStartedAt: "desc" },
    });
    if (byWord) return byWord;
  }

  return null;
}

/**
 * Search for multiple meetings matching a query.
 * Same strategy cascade as findMeetingByQuery but returns up to `take` results.
 */
export async function findMeetingsByQuery(
  prisma: PrismaClient,
  userId: string,
  query: string,
  take = 5,
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

  // 3. Calendar event title search
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
    });
    if (meetings.length > 0) return meetings;
  }

  // 4. Attendee name search
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

  // 5. Individual words on title
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
