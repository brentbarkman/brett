import { describe, it, expect } from "vitest";
import {
  findBestMatch,
  type MatchCandidate,
} from "../services/meeting-matcher.js";

const baseMeeting = {
  title: "Weekly Standup",
  startTime: new Date("2026-03-27T14:00:00Z"),
  endTime: new Date("2026-03-27T14:30:00Z"),
  attendees: [
    { email: "alice@example.com" },
    { email: "bob@example.com" },
  ],
};

describe("findBestMatch", () => {
  it("returns null when no candidates", () => {
    expect(findBestMatch(baseMeeting, [])).toBeNull();
  });

  it("matches exact title and time overlap", () => {
    const candidates: MatchCandidate[] = [
      {
        id: "event-1",
        title: "Weekly Standup",
        startTime: new Date("2026-03-27T14:00:00Z"),
        endTime: new Date("2026-03-27T14:30:00Z"),
        attendees: [
          { email: "alice@example.com" },
          { email: "bob@example.com" },
        ],
      },
    ];
    const result = findBestMatch(baseMeeting, candidates);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("event-1");
    expect(result!.score).toBeGreaterThan(0.8);
  });

  it("rejects candidates with no time overlap", () => {
    const candidates: MatchCandidate[] = [
      {
        id: "event-2",
        title: "Weekly Standup",
        startTime: new Date("2026-03-27T16:00:00Z"),
        endTime: new Date("2026-03-27T16:30:00Z"),
        attendees: [{ email: "alice@example.com" }],
      },
    ];
    expect(findBestMatch(baseMeeting, candidates)).toBeNull();
  });

  it("allows time overlap within 15-minute tolerance", () => {
    const candidates: MatchCandidate[] = [
      {
        id: "event-3",
        title: "Weekly Standup",
        startTime: new Date("2026-03-27T14:10:00Z"),
        endTime: new Date("2026-03-27T14:40:00Z"),
        attendees: [],
      },
    ];
    const result = findBestMatch(baseMeeting, candidates);
    expect(result).not.toBeNull();
  });

  it("picks the best match when multiple candidates overlap", () => {
    const candidates: MatchCandidate[] = [
      {
        id: "event-a",
        title: "Team Sync",
        startTime: new Date("2026-03-27T14:00:00Z"),
        endTime: new Date("2026-03-27T14:30:00Z"),
        attendees: [],
      },
      {
        id: "event-b",
        title: "Weekly Standup",
        startTime: new Date("2026-03-27T14:00:00Z"),
        endTime: new Date("2026-03-27T14:30:00Z"),
        attendees: [
          { email: "alice@example.com" },
          { email: "bob@example.com" },
        ],
      },
    ];
    const result = findBestMatch(baseMeeting, candidates);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("event-b");
  });

  it("returns null when best score is below threshold", () => {
    const candidates: MatchCandidate[] = [
      {
        id: "event-c",
        title: "Completely Different Meeting",
        startTime: new Date("2026-03-27T13:50:00Z"),
        endTime: new Date("2026-03-27T14:05:00Z"),
        attendees: [{ email: "charlie@example.com" }],
      },
    ];
    const result = findBestMatch(baseMeeting, candidates);
    expect(result).toBeNull();
  });
});
