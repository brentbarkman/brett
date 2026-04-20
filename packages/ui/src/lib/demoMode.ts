import { useSyncExternalStore } from "react";

const STORAGE_KEY = "brett:demoMode";

type Listener = () => void;

let enabled = readPersisted();
const listeners = new Set<Listener>();

function readPersisted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePersisted(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage quota / private-mode etc. — demo mode still works in-memory.
  }
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return enabled;
}

function getServerSnapshot(): boolean {
  return false;
}

export const demoMode = {
  isEnabled(): boolean {
    return enabled;
  },
  set(value: boolean) {
    if (enabled === value) return;
    enabled = value;
    writePersisted(value);
    listeners.forEach((l) => l());
  },
  toggle() {
    demoMode.set(!enabled);
  },
  subscribe,
};

export function useDemoMode(): { enabled: boolean; toggle: () => void } {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { enabled: value, toggle: demoMode.toggle };
}

export type DemoTitleKind = "thing" | "calendar";

/**
 * Synchronous read. Does NOT subscribe a component to re-render. Use in
 * non-rendering contexts (filters, handlers). In render paths, prefer
 * `useDisplayTitle` so the component re-renders when demo mode flips.
 */
export function displayTitle(
  id: string | undefined | null,
  realTitle: string,
  kind: DemoTitleKind,
): string {
  if (!enabled) return realTitle;
  if (!id) return realTitle;
  const pool = kind === "thing" ? THING_POOL : CALENDAR_POOL;
  return pool[hashFnv1a(id) % pool.length];
}

/**
 * Render-path variant: subscribes to the demo mode store so the component
 * re-renders when it flips, then returns the displayed title.
 *
 * Uses the `enabled` value from useDemoMode() directly (rather than delegating
 * to displayTitle() which reads module state). React Compiler memoizes based
 * on tracked data flow — if the return value didn't visibly depend on the
 * subscription, the compiler could cache a stale title after the store flipped.
 */
export function useDisplayTitle(
  id: string | undefined | null,
  realTitle: string,
  kind: DemoTitleKind,
): string {
  const { enabled } = useDemoMode();
  if (!enabled) return realTitle;
  if (!id) return realTitle;
  const pool = kind === "thing" ? THING_POOL : CALENDAR_POOL;
  return pool[hashFnv1a(id) % pool.length];
}

function hashFnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply: h * 16777619
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h;
}

const THING_POOL: readonly string[] = [
  "Negotiate truce with the office plant",
  "Email the dragon about escrow",
  "Ransom back the stapler",
  "File taxes for the rubber duck",
  "Apologize to the printer",
  "Wrangle the printer cartel",
  "Teach the toaster some manners",
  "Decode the pigeon's memo",
  "Update the quarterly snack forecast",
  "Book therapy for the router",
  "Return library book from 2007",
  "Invoice Santa (attempt three)",
  "Reconcile the coffee budget",
  "Audit the snack drawer",
  "Finalize the banana strategy",
  "Schedule a summit with the cat",
  "Recaulk the dream",
  "Debrief the houseplants",
  "Follow up with the squirrel",
  "Draft manifesto re: yogurt",
  "Brief the interns on vibes",
  "Pitch memoir to the mailman",
  "Rewrite life story, act II",
  "Replace the sad lightbulb",
  "Finish novel about spreadsheets",
  "Befriend the neighbor's dog",
  "Return the borrowed hat",
  "Mail postcard to past self",
  "Reassemble the blender",
  "Host summit with the worm bin",
  "Alert HR re: the ghost",
  "Submit expense: one (1) vibe",
  "Prepare lore for Monday",
  "Deliver eulogy for the fern",
  "Log grievance with the wind",
  "Buy glitter for the rebrand",
  "Retrieve the sacred hoodie",
  "Defrag the junk drawer",
  "Whisper apology to the WiFi",
  "Mend the beanbag",
  "Commission portrait of the dog",
  "Refund the unread book",
  "Water the imaginary cactus",
  "Bribe the scanner",
  "Schedule a vibe check",
  "Recover the lost sock",
  "Appease the parking meter",
  "Edit the group chat lore",
  "Ghostwrite LinkedIn for the cat",
  "Audit the tupperware situation",
  "Haggle with the self-checkout",
  "Embiggen the garden gnome",
  "Renew vows with the couch",
  "Translate the dishwasher's demands",
  "Pen apology letter to the car",
  "Steam the ceremonial dumplings",
  "Calendar a chat with the fog",
  "Dust off the motivational crystals",
  "Overthrow the junk mail regime",
  "Invite the moon to coffee",
];

const CALENDAR_POOL: readonly string[] = [
  "Tactical nap sync",
  "Vibes quarterly",
  "Stakeholder beef",
  "Alignment grooming",
  "Standup about the standup",
  "Retro: feelings edition",
  "1:1 with the void",
  "Pre-meeting meeting",
  "Post-meeting meeting",
  "All-hands séance",
  "Coffee chat (scheduled spontaneity)",
  "Quarterly crisis review",
  "Ideation rave",
  "Kickoff for the kickoff",
  "Roadmap poetry slam",
  "Brainstorm dump",
  "Steering committee brunch",
  "KPI group therapy",
  "OKR bake-off",
  "Sprint planning ritual",
  "Strategy cosplay",
  "Feedback confessional",
  "Leadership huddle (emotional)",
  "Demo rehearsal rehearsal",
  "Budget wake",
  "Cross-functional vibes check",
  "Roadmap tarot reading",
  "Pricing séance",
  "Launch postmortem pre-mortem",
  "Deep work hour (theoretical)",
  "Customer escalation opera",
  "Quarterly metaphor review",
  "AMA with the algorithm",
  "Retention ritual",
  "Onboarding scavenger hunt",
  "Innovation open mic",
  "Security drill, kind of",
  "Offsite (indoor)",
  "Mandatory fun block",
  "Syncsync",
];
