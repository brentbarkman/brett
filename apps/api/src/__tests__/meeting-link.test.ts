import { describe, it, expect } from "vitest";
import { extractMeetingLink } from "../services/meeting-link.js";

describe("extractMeetingLink", () => {
  describe("priority 1: conferenceData.entryPoints", () => {
    it("extracts video entry point URI", () => {
      const result = extractMeetingLink({
        conferenceData: {
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+1234567890" },
            { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
          ],
        },
      });
      expect(result).toBe("https://meet.google.com/abc-defg-hij");
    });

    it("prefers conferenceData over location", () => {
      const result = extractMeetingLink({
        conferenceData: {
          entryPoints: [
            { entryPointType: "video", uri: "https://meet.google.com/from-conf" },
          ],
        },
        location: "https://zoom.us/j/123456789",
      });
      expect(result).toBe("https://meet.google.com/from-conf");
    });

    it("skips non-video entry points", () => {
      const result = extractMeetingLink({
        conferenceData: {
          entryPoints: [
            { entryPointType: "phone", uri: "tel:+1234567890" },
            { entryPointType: "sip", uri: "sip:meeting@google.com" },
          ],
        },
      });
      expect(result).toBeNull();
    });
  });

  describe("priority 2: location field", () => {
    it("extracts Google Meet link from location", () => {
      const result = extractMeetingLink({
        location: "https://meet.google.com/abc-defg-hij",
      });
      expect(result).toBe("https://meet.google.com/abc-defg-hij");
    });

    it("extracts Zoom link from location", () => {
      const result = extractMeetingLink({
        location: "Join: https://zoom.us/j/123456789?pwd=abc",
      });
      expect(result).toBe("https://zoom.us/j/123456789?pwd=abc");
    });

    it("extracts Teams link from location", () => {
      const result = extractMeetingLink({
        location: "https://teams.microsoft.com/l/meetup-join/abc123",
      });
      expect(result).toBe("https://teams.microsoft.com/l/meetup-join/abc123");
    });

    it("extracts Webex link from location", () => {
      const result = extractMeetingLink({
        location: "https://company.webex.com/meet/john",
      });
      expect(result).toBe("https://company.webex.com/meet/john");
    });
  });

  describe("priority 3: description field", () => {
    it("extracts Meet link from description when location has no link", () => {
      const result = extractMeetingLink({
        location: "Conference Room B",
        description: "Join at https://meet.google.com/xyz-abcd-efg",
      });
      expect(result).toBe("https://meet.google.com/xyz-abcd-efg");
    });

    it("extracts Zoom link from description", () => {
      const result = extractMeetingLink({
        description: "Meeting details:\nhttps://zoom.us/j/987654321\nPlease join on time.",
      });
      expect(result).toBe("https://zoom.us/j/987654321");
    });
  });

  describe("no match", () => {
    it("returns null when no meeting link found", () => {
      const result = extractMeetingLink({
        location: "Conference Room A",
        description: "Discuss Q2 roadmap",
      });
      expect(result).toBeNull();
    });

    it("returns null for empty event", () => {
      expect(extractMeetingLink({})).toBeNull();
    });

    it("returns null when all fields are undefined", () => {
      const result = extractMeetingLink({
        conferenceData: undefined,
        location: undefined,
        description: undefined,
      });
      expect(result).toBeNull();
    });
  });
});
