import { describe, it, expect } from "vitest";
import { extractMeetingLink } from "../meeting-link.js";

describe("extractMeetingLink", () => {
  it("extracts from conferenceData (Google Meet)", () => {
    const event = {
      conferenceData: {
        entryPoints: [
          { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
        ],
      },
    };
    expect(extractMeetingLink(event)).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("extracts Zoom from location", () => {
    const event = { location: "https://zoom.us/j/123456789" };
    expect(extractMeetingLink(event)).toBe("https://zoom.us/j/123456789");
  });

  it("extracts Teams from description", () => {
    const event = {
      description: "Join here: https://teams.microsoft.com/l/meetup-join/abc123 see you",
    };
    expect(extractMeetingLink(event)).toContain("teams.microsoft.com");
  });

  it("prioritizes conferenceData over location", () => {
    const event = {
      conferenceData: {
        entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/xxx" }],
      },
      location: "https://zoom.us/j/999",
    };
    expect(extractMeetingLink(event)).toBe("https://meet.google.com/xxx");
  });

  it("returns null when no meeting link found", () => {
    const event = { location: "Conference Room A", description: "Agenda: ..." };
    expect(extractMeetingLink(event)).toBeNull();
  });
});
