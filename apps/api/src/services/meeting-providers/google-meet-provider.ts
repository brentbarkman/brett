import type { CalendarEvent } from "@brett/api-core";
import type { MeetingNoteProvider, ProviderMeetingData } from "./types.js";
import type { MeetingNoteAttendee } from "@brett/types";
import { prisma } from "../../lib/prisma.js";
import {
  getDriveClient,
  getDocsClient,
  findMeetArtifacts,
  readDocContent,
  parseTranscriptDoc,
  parseMeetingNotesDoc,
} from "../../lib/google-drive.js";

export class GoogleMeetProvider implements MeetingNoteProvider {
  readonly provider = "google_meet";

  async isAvailable(userId: string): Promise<boolean> {
    const account = await prisma.googleAccount.findFirst({
      where: { userId, hasDriveScope: true, meetingNotesEnabled: true },
      orderBy: { connectedAt: "desc" },
      select: { id: true },
    });
    return !!account;
  }

  async fetchForEvent(
    userId: string,
    calendarEvent: CalendarEvent,
  ): Promise<ProviderMeetingData | null> {
    // Security: always include userId in account lookup
    const account = await prisma.googleAccount.findFirst({
      where: { userId, hasDriveScope: true, meetingNotesEnabled: true },
      orderBy: { connectedAt: "desc" },
    });
    if (!account) return null;

    // Only process events with a Google Meet link
    if (!calendarEvent.meetingLink?.includes("meet.google.com")) return null;

    const driveClient = getDriveClient(account);
    const docsClient = getDocsClient(account);

    // CalendarEvent.attachments is Json? — validate before casting
    const attachments = Array.isArray(calendarEvent.attachments)
      ? calendarEvent.attachments as unknown as Array<{ fileId?: string; title?: string; mimeType?: string }>
      : null;

    const { transcriptFileId, notesFileId } = await findMeetArtifacts(
      driveClient,
      attachments,
      calendarEvent.title,
      calendarEvent.startTime,
      calendarEvent.endTime,
    );

    if (!transcriptFileId && !notesFileId) return null;

    let transcript = null;
    let summary = null;
    const rawData: Record<string, unknown> = {};

    if (transcriptFileId) {
      try {
        const content = await readDocContent(docsClient, transcriptFileId);
        transcript = parseTranscriptDoc(content);
        rawData.transcriptFileId = transcriptFileId;
      } catch (err) {
        console.warn(
          `[google-meet] Failed to parse transcript ${transcriptFileId}:`,
          err,
        );
      }
    }

    if (notesFileId) {
      try {
        const content = await readDocContent(docsClient, notesFileId);
        summary = parseMeetingNotesDoc(content);
        rawData.notesFileId = notesFileId;
      } catch (err) {
        console.warn(
          `[google-meet] Failed to parse notes ${notesFileId}:`,
          err,
        );
      }
    }

    if (!transcript && !summary) return null;

    const externalId = transcriptFileId ?? notesFileId!;

    return {
      provider: "google_meet",
      externalId,
      accountId: account.id,
      calendarEventId: calendarEvent.id,
      title: calendarEvent.title,
      summary,
      transcript,
      attendees: Array.isArray(calendarEvent.attendees)
        ? calendarEvent.attendees as unknown as MeetingNoteAttendee[]
        : null,
      meetingStartedAt: calendarEvent.startTime,
      meetingEndedAt: calendarEvent.endTime,
      rawData,
    };
  }

  async fetchRecent(
    userId: string,
    since: Date,
    until: Date,
  ): Promise<ProviderMeetingData[]> {
    const account = await prisma.googleAccount.findFirst({
      where: { userId, hasDriveScope: true, meetingNotesEnabled: true },
      orderBy: { connectedAt: "desc" },
    });
    if (!account) return [];

    const events = await prisma.calendarEvent.findMany({
      where: {
        userId,
        startTime: { gte: since },
        endTime: { lte: until },
        meetingLink: { contains: "meet.google.com" },
        isAllDay: false,
      },
    });

    const results: ProviderMeetingData[] = [];
    for (const event of events) {
      try {
        const data = await this.fetchForEvent(userId, event);
        if (data) results.push(data);
      } catch (err) {
        console.warn(
          `[google-meet] Failed to fetch for event ${event.id}:`,
          err,
        );
      }
    }

    return results;
  }
}
