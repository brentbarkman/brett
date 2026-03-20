import type { calendar_v3 } from "googleapis";

const MEETING_URL_PATTERNS = [
  /https?:\/\/meet\.google\.com\/[a-z\-]+/i,
  /https?:\/\/[\w.]*zoom\.us\/j\/\d+[^\s"]*/i,
  /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"]*/i,
  /https?:\/\/[\w.]*webex\.com\/[^\s"]*/i,
];

export function extractMeetingLink(event: Partial<calendar_v3.Schema$Event>): string | null {
  // Priority 1: conferenceData
  if (event.conferenceData?.entryPoints) {
    const video = event.conferenceData.entryPoints.find(
      (ep) => ep.entryPointType === "video",
    );
    if (video?.uri) return video.uri;
  }

  // Priority 2: location
  if (event.location) {
    for (const pattern of MEETING_URL_PATTERNS) {
      const match = event.location.match(pattern);
      if (match) return match[0];
    }
  }

  // Priority 3: description
  if (event.description) {
    for (const pattern of MEETING_URL_PATTERNS) {
      const match = event.description.match(pattern);
      if (match) return match[0];
    }
  }

  return null;
}
