import { Hono } from "hono";
import { authMiddleware, type AuthEnv } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { getCalendarClient, updateRsvp } from "../lib/google-calendar.js";
import { onDemandFetch } from "../services/calendar-sync.js";
import {
  validateRsvpInput,
  validateCalendarNoteInput,
  validateCreateBrettMessage,
} from "@brett/business";
import { generateId } from "@brett/utils";

const calendar = new Hono<AuthEnv>();

// All routes require auth
calendar.use("*", authMiddleware);

// GET /events — List events for date range
// Accepts `date` (single day) OR `startDate` + `endDate` (range)
// Filters by visible calendars only
calendar.get("/events", async (c) => {
  const user = c.get("user");
  const { date, startDate, endDate } = c.req.query();

  let start: Date;
  let end: Date;

  if (date) {
    start = new Date(date);
    start.setUTCHours(0, 0, 0, 0);
    end = new Date(date);
    end.setUTCHours(23, 59, 59, 999);
  } else if (startDate && endDate) {
    start = new Date(startDate);
    end = new Date(endDate);
  } else {
    return c.json({ error: "Provide date or startDate+endDate" }, 400);
  }

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return c.json({ error: "Invalid date format" }, 400);
  }

  // Get visible calendar IDs for this user
  const visibleCalendars = await prisma.calendarList.findMany({
    where: {
      googleAccount: { userId: user.id },
      isVisible: true,
    },
    select: { id: true },
  });

  const calendarListIds = visibleCalendars.map((cal) => cal.id);
  if (calendarListIds.length === 0) {
    return c.json([]);
  }

  const events = await prisma.calendarEvent.findMany({
    where: {
      userId: user.id,
      calendarListId: { in: calendarListIds },
      startTime: { lte: end },
      endTime: { gte: start },
    },
    include: {
      calendarList: { select: { name: true, color: true } },
    },
    orderBy: { startTime: "asc" },
  });

  return c.json(
    events.map((e) => ({
      id: e.id,
      googleEventId: e.googleEventId,
      title: e.title,
      description: e.description,
      location: e.location,
      startTime: e.startTime.toISOString(),
      endTime: e.endTime.toISOString(),
      isAllDay: e.isAllDay,
      status: e.status,
      myResponseStatus: e.myResponseStatus,
      meetingLink: e.meetingLink,
      calendarName: e.calendarList.name,
      calendarColor: e.calendarList.color,
      googleColorId: e.googleColorId,
      organizer: e.organizer,
      attendees: e.attendees,
      recurrence: e.recurrence,
      recurringEventId: e.recurringEventId,
    })),
  );
});

// GET /events/:id — Single event with detail
calendar.get("/events/:id", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
    include: {
      calendarList: { select: { name: true, color: true } },
      notes: { where: { userId: user.id }, take: 1 },
      brettMessages: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!event) return c.json({ error: "Not found" }, 404);

  return c.json({
    id: event.id,
    googleEventId: event.googleEventId,
    title: event.title,
    description: event.description,
    location: event.location,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    isAllDay: event.isAllDay,
    status: event.status,
    myResponseStatus: event.myResponseStatus,
    meetingLink: event.meetingLink,
    calendarName: event.calendarList.name,
    calendarColor: event.calendarList.color,
    googleColorId: event.googleColorId,
    organizer: event.organizer,
    attendees: event.attendees,
    attachments: event.attachments,
    recurrence: event.recurrence,
    recurringEventId: event.recurringEventId,
    notes: event.notes[0]?.content ?? null,
    brettMessages: event.brettMessages
      .slice(0, 20)
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
  });
});

// PATCH /events/:id/rsvp — Update RSVP status
calendar.patch("/events/:id/rsvp", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
    include: {
      calendarList: true,
      googleAccount: true,
    },
  });

  if (!event) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const validation = validateRsvpInput(body);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  // Update on Google Calendar
  const client = await getCalendarClient(event.googleAccountId);
  await updateRsvp(
    client,
    event.calendarList.googleCalendarId,
    event.googleEventId,
    event.googleAccount.googleEmail,
    validation.data.status as "accepted" | "declined" | "tentative",
    validation.data.comment,
  );

  // Update local cache
  const updated = await prisma.calendarEvent.update({
    where: { id: event.id },
    data: { myResponseStatus: validation.data.status },
  });

  return c.json({
    id: updated.id,
    myResponseStatus: updated.myResponseStatus,
  });
});

// GET /events/:id/notes — Get private notes
calendar.get("/events/:id/notes", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });
  if (!event) return c.json({ error: "Not found" }, 404);

  const note = await prisma.calendarEventNote.findUnique({
    where: {
      calendarEventId_userId: {
        calendarEventId: eventId,
        userId: user.id,
      },
    },
  });

  return c.json({
    content: note?.content ?? null,
    updatedAt: note?.updatedAt.toISOString() ?? null,
  });
});

// PUT /events/:id/notes — Upsert private notes
calendar.put("/events/:id/notes", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });
  if (!event) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const noteValidation = validateCalendarNoteInput(body);
  if (!noteValidation.ok) return c.json({ error: noteValidation.error }, 400);

  const note = await prisma.calendarEventNote.upsert({
    where: {
      calendarEventId_userId: {
        calendarEventId: eventId,
        userId: user.id,
      },
    },
    create: {
      calendarEventId: eventId,
      userId: user.id,
      content: noteValidation.data.content,
    },
    update: {
      content: noteValidation.data.content,
    },
  });

  return c.json({
    content: note.content,
    updatedAt: note.updatedAt.toISOString(),
  });
});

// GET /events/:id/brett — Brett messages (paginated, cursor-based)
calendar.get("/events/:id/brett", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });
  if (!event) return c.json({ error: "Not found" }, 404);

  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);
  const cursor = c.req.query("cursor");

  if (cursor && isNaN(new Date(cursor).getTime())) {
    return c.json({ error: "Invalid cursor" }, 400);
  }

  const [messages, totalCount] = await Promise.all([
    prisma.brettMessage.findMany({
      where: {
        calendarEventId: eventId,
        ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    }),
    prisma.brettMessage.count({ where: { calendarEventId: eventId } }),
  ]);

  const hasMore = messages.length > limit;
  const page = hasMore ? messages.slice(0, limit) : messages;

  return c.json({
    messages: page.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    hasMore,
    cursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    totalCount,
  });
});

// POST /events/:id/brett — Send Brett message
calendar.post("/events/:id/brett", async (c) => {
  const user = c.get("user");
  const eventId = c.req.param("id");

  const event = await prisma.calendarEvent.findFirst({
    where: { id: eventId, userId: user.id },
  });
  if (!event) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json();
  const validation = validateCreateBrettMessage(body);
  if (!validation.ok) return c.json({ error: validation.error }, 400);

  const userMessage = await prisma.brettMessage.create({
    data: {
      id: generateId(),
      calendarEventId: eventId,
      userId: user.id,
      role: "user",
      content: validation.data.content,
    },
  });

  const stubResponse = "I'll think about that and get back to you. (AI responses coming soon)";
  const brettMessage = await prisma.brettMessage.create({
    data: {
      id: generateId(),
      calendarEventId: eventId,
      userId: user.id,
      role: "brett",
      content: stubResponse,
    },
  });

  return c.json(
    {
      userMessage: {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt.toISOString(),
      },
      brettMessage: {
        id: brettMessage.id,
        role: brettMessage.role,
        content: brettMessage.content,
        createdAt: brettMessage.createdAt.toISOString(),
      },
    },
    201,
  );
});

// POST /events/fetch-range — On-demand fetch for date ranges outside sync window
calendar.post("/events/fetch-range", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { startDate, endDate } = body;

  if (!startDate || !endDate) {
    return c.json({ error: "startDate and endDate are required" }, 400);
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return c.json({ error: "Invalid date format" }, 400);
  }

  // Fetch from Google for all connected accounts
  const accounts = await prisma.googleAccount.findMany({
    where: { userId: user.id },
    select: { id: true },
  });

  for (const account of accounts) {
    try {
      await onDemandFetch(account.id, start.toISOString(), end.toISOString());
    } catch (err) {
      console.error(
        `[calendar] On-demand fetch failed for account ${account.id}:`,
        err,
      );
    }
  }

  return c.json({ ok: true });
});

export default calendar;
