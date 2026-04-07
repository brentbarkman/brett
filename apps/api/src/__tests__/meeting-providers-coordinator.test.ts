import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CalendarEvent } from "@prisma/client";
import type { MeetingNoteProvider, ProviderMeetingData } from "../services/meeting-providers/types.js";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    meetingNoteSource: {
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    meetingNote: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../lib/sse.js", () => ({
  publishSSE: vi.fn(),
}));

vi.mock("@brett/ai", () => ({
  enqueueEmbed: vi.fn(),
}));

vi.mock("../services/granola-action-items.js", () => ({
  processActionItems: vi.fn().mockResolvedValue(undefined),
}));

// Mock the registry so we control which providers are returned
vi.mock("../services/meeting-providers/registry.js", () => ({
  providerRegistry: {
    getAvailable: vi.fn(),
    getAll: vi.fn(),
  },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { prisma } from "../lib/prisma.js";
import { publishSSE } from "../lib/sse.js";
import { enqueueEmbed } from "@brett/ai";
import { syncForEvent, syncRecent } from "../services/meeting-providers/coordinator.js";
import { providerRegistry } from "../services/meeting-providers/registry.js";
import { processActionItems } from "../services/granola-action-items.js";

// ── Test helpers ───────────────────────────────────────────────────────────

const mockPrisma = prisma as unknown as {
  meetingNoteSource: { findUnique: ReturnType<typeof vi.fn> };
  meetingNote: { findUnique: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const mockPublishSSE = publishSSE as ReturnType<typeof vi.fn>;
const mockEnqueueEmbed = enqueueEmbed as ReturnType<typeof vi.fn>;
const mockGetAvailable = providerRegistry.getAvailable as ReturnType<typeof vi.fn>;
const mockProcessActionItems = processActionItems as ReturnType<typeof vi.fn>;

function makeCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "cal-event-1",
    userId: "user-1",
    googleAccountId: "acc-1",
    calendarListId: "cal-1",
    googleEventId: "ext-cal-1",
    title: "Team Standup",
    description: null,
    startTime: new Date("2026-03-27T14:00:00Z"),
    endTime: new Date("2026-03-27T14:30:00Z"),
    isAllDay: false,
    status: "confirmed",
    myResponseStatus: "needsAction",
    recurrence: null,
    recurringEventId: null,
    meetingLink: null,
    conferenceId: null,
    googleColorId: null,
    organizer: null,
    attendees: [],
    attachments: null,
    rawGoogleEvent: null,
    brettObservation: null,
    brettObservationAt: null,
    brettObservationHash: null,
    location: null,
    syncedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeProviderData(overrides: Partial<ProviderMeetingData> = {}): ProviderMeetingData {
  return {
    provider: "granola",
    externalId: "granola-note-1",
    accountId: "granola-acc-1",
    calendarEventId: "cal-event-1",
    title: "Team Standup",
    summary: "Discussed roadmap priorities.",
    transcript: null,
    attendees: [{ name: "Alice", email: "alice@example.com" }],
    meetingStartedAt: new Date("2026-03-27T14:00:00Z"),
    meetingEndedAt: new Date("2026-03-27T14:30:00Z"),
    rawData: { doc_id: "granola-doc-1" },
    ...overrides,
  };
}

function makeMockProvider(
  providerName: string,
  data: ProviderMeetingData | null = null,
): MeetingNoteProvider {
  return {
    provider: providerName,
    fetchForEvent: vi.fn().mockResolvedValue(data),
    fetchRecent: vi.fn().mockResolvedValue(data ? [data] : []),
    isAvailable: vi.fn().mockResolvedValue(true),
  };
}

const MOCK_NOTE = {
  id: "note-1",
  userId: "user-1",
  calendarEventId: "cal-event-1",
  provider: "granola",
  title: "Team Standup",
  summary: "Discussed roadmap priorities.",
  transcript: null,
  attendees: [{ name: "Alice", email: "alice@example.com" }],
  sources: ["granola"],
  meetingStartedAt: new Date("2026-03-27T14:00:00Z"),
  meetingEndedAt: new Date("2026-03-27T14:30:00Z"),
  rawData: null,
  syncedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  granolaAccountId: null,
  googleAccountId: null,
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("syncForEvent (coordinator)", () => {
  const userId = "user-1";
  const calendarEvent = makeCalendarEvent();

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no existing source, no existing note, transaction returns the new note
    mockPrisma.meetingNoteSource.findUnique.mockResolvedValue(null);
    mockPrisma.meetingNote.findUnique.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Provide a minimal tx that mimics the real transaction
      const tx = {
        meetingNote: {
          upsert: vi.fn().mockResolvedValue(MOCK_NOTE),
        },
        meetingNoteSource: {
          create: vi.fn().mockResolvedValue({}),
          count: vi.fn().mockResolvedValue(1), // first source
        },
      };
      return fn(tx);
    });
  });

  it("skips when no providers are available", async () => {
    mockGetAvailable.mockResolvedValue([]);

    await syncForEvent(userId, calendarEvent);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockEnqueueEmbed).not.toHaveBeenCalled();
    expect(mockPublishSSE).not.toHaveBeenCalled();
  });

  it("creates a MeetingNote from the first provider source and triggers enqueueEmbed + publishSSE", async () => {
    const providerData = makeProviderData();
    const provider = makeMockProvider("granola", providerData);
    mockGetAvailable.mockResolvedValue([provider]);

    await syncForEvent(userId, calendarEvent);

    // Provider was called with the right args
    expect(provider.fetchForEvent).toHaveBeenCalledWith(userId, calendarEvent);

    // Transaction ran — note was upserted
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // Embed was enqueued
    expect(mockEnqueueEmbed).toHaveBeenCalledWith({
      entityType: "meeting_note",
      entityId: MOCK_NOTE.id,
      userId,
    });

    // SSE was published
    expect(mockPublishSSE).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        type: "meeting.note.synced",
        payload: expect.objectContaining({
          meetingNoteId: MOCK_NOTE.id,
          calendarEventId: calendarEvent.id,
          provider: "granola",
          isFirstSource: true,
        }),
      }),
    );
  });

  it("handles a provider fetch failure gracefully — other providers still succeed", async () => {
    const goodData = makeProviderData({ provider: "google_meet", externalId: "gm-note-1" });
    const failingProvider = makeMockProvider("granola", null);
    (failingProvider.fetchForEvent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Granola API unavailable"),
    );
    const successProvider = makeMockProvider("google_meet", goodData);
    mockGetAvailable.mockResolvedValue([failingProvider, successProvider]);

    // Should not throw
    await expect(syncForEvent(userId, calendarEvent)).resolves.toBeUndefined();

    // The failing provider was attempted
    expect(failingProvider.fetchForEvent).toHaveBeenCalledWith(userId, calendarEvent);

    // The good provider was attempted and processed
    expect(successProvider.fetchForEvent).toHaveBeenCalledWith(userId, calendarEvent);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockEnqueueEmbed).toHaveBeenCalledTimes(1);
    expect(mockPublishSSE).toHaveBeenCalledTimes(1);
  });

  it("P2002 unique constraint error is caught gracefully — no SSE or embed", async () => {
    const providerData = makeProviderData();
    const provider = makeMockProvider("granola", providerData);
    mockGetAvailable.mockResolvedValue([provider]);

    // Simulate a P2002 unique constraint violation from $transaction
    const p2002 = new Error("unique constraint") as any;
    p2002.code = "P2002";
    p2002.name = "PrismaClientKnownRequestError";
    // Make it look like a PrismaClientKnownRequestError by matching the instanceof check
    Object.setPrototypeOf(p2002, {
      constructor: { name: "PrismaClientKnownRequestError" },
    });

    // The coordinator catches Prisma.PrismaClientKnownRequestError — import it directly
    const { Prisma } = await import("@prisma/client");
    const prismaError = new Prisma.PrismaClientKnownRequestError("unique constraint", {
      code: "P2002",
      clientVersion: "5.0.0",
    });
    mockPrisma.$transaction.mockRejectedValue(prismaError);

    // Should resolve without throwing
    await expect(syncForEvent(userId, calendarEvent)).resolves.toBeUndefined();

    // SSE and embed must NOT be called
    expect(mockPublishSSE).not.toHaveBeenCalled();
    expect(mockEnqueueEmbed).not.toHaveBeenCalled();
  });

  it("non-P2002 errors propagate out of syncForEvent", async () => {
    const providerData = makeProviderData();
    const provider = makeMockProvider("granola", providerData);
    mockGetAvailable.mockResolvedValue([provider]);

    mockPrisma.$transaction.mockRejectedValue(new Error("database is on fire"));

    await expect(syncForEvent(userId, calendarEvent)).rejects.toThrow("database is on fire");
  });

  it("provider returning null data skips transaction, SSE, and embed", async () => {
    // fetchForEvent returns null — coordinator should skip entirely
    const provider = makeMockProvider("granola", null);
    mockGetAvailable.mockResolvedValue([provider]);

    await syncForEvent(userId, calendarEvent);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockEnqueueEmbed).not.toHaveBeenCalled();
    expect(mockPublishSSE).not.toHaveBeenCalled();
  });

  it("isFirstSource=false on update path — processActionItems is NOT called", async () => {
    const providerData = makeProviderData();
    const provider = makeMockProvider("granola", providerData);
    mockGetAvailable.mockResolvedValue([provider]);

    // Return a note that already has sources — isFirstSource should be false
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        meetingNote: {
          upsert: vi.fn().mockResolvedValue(MOCK_NOTE),
        },
        meetingNoteSource: {
          create: vi.fn().mockResolvedValue({}),
          count: vi.fn().mockResolvedValue(2), // not the first source
        },
      };
      return fn(tx);
    });

    await syncForEvent(userId, calendarEvent);

    // isFirstSource=false — processActionItems must NOT be called
    expect(mockProcessActionItems).not.toHaveBeenCalled();

    // Embed and SSE still fire (they always run regardless of isFirstSource)
    expect(mockEnqueueEmbed).toHaveBeenCalledTimes(1);
    expect(mockPublishSSE).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        type: "meeting.note.synced",
        payload: expect.objectContaining({ isFirstSource: false }),
      }),
    );
  });
});

describe("syncRecent (coordinator)", () => {
  const userId = "user-1";
  const since = new Date("2026-03-01T00:00:00Z");
  const until = new Date("2026-03-31T23:59:59Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncRecent with no providers makes no DB calls", async () => {
    mockGetAvailable.mockResolvedValue([]);

    await syncRecent(userId, since, until);

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockEnqueueEmbed).not.toHaveBeenCalled();
    expect(mockPublishSSE).not.toHaveBeenCalled();
  });
});
