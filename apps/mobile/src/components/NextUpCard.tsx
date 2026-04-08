import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii } from '../theme/tokens';

interface NextUpEvent {
  title: string;
  startTime: string;
  endTime: string;
  location: string | null;
  meetingLink: string | null;
}

interface NextUpCardProps {
  event: NextUpEvent;
  onPress: () => void;
}

// Amber (upcoming) and emerald (now happening) — matches desktop
const AMBER_BG = 'rgba(245, 158, 11, 0.05)';
const AMBER_BORDER = 'rgba(245, 158, 11, 0.25)';
const AMBER_BORDER_URGENT = 'rgba(245, 158, 11, 0.35)';
const AMBER_TEXT = 'rgba(245, 158, 11, 0.9)';

const EMERALD_BG = 'rgba(16, 185, 129, 0.05)';
const EMERALD_BORDER = 'rgba(16, 185, 129, 0.25)';
const EMERALD_TEXT = 'rgba(16, 185, 129, 0.9)';

/** Compute a human-readable "time until" label and state */
function computeEventState(startTime: string, endTime: string): {
  label: string;
  isNow: boolean;
  isUrgent: boolean;
} {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (now >= start && now < end) {
    return { label: 'Now', isNow: true, isUrgent: false };
  }

  const diffMs = start - now;
  if (diffMs <= 0) return { label: 'Now', isNow: true, isUrgent: false };

  const totalMinutes = Math.round(diffMs / 60_000);
  const isUrgent = totalMinutes <= 10;

  let label: string;
  if (totalMinutes < 60) {
    label = `In ${totalMinutes}m`;
  } else {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    label = minutes > 0 ? `In ${hours}h ${minutes}m` : `In ${hours}h`;
  }

  return { label, isNow: false, isUrgent };
}

/** Compute duration label from two ISO strings */
function computeDuration(startTime: string, endTime: string): string {
  const diffMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  const minutes = Math.round(diffMs / 60_000);
  return `${minutes} min`;
}

/** Derive a short platform label from a meeting link */
function meetingPlatformLabel(link: string): string {
  if (/zoom\.us/i.test(link)) return 'Zoom';
  if (/meet\.google\.com/i.test(link)) return 'Google Meet';
  if (/teams\.microsoft\.com/i.test(link)) return 'Teams';
  return 'Link';
}

export function NextUpCard({ event, onPress }: NextUpCardProps) {
  const { label: timeUntil, isNow, isUrgent } = computeEventState(event.startTime, event.endTime);
  const duration = computeDuration(event.startTime, event.endTime);

  let detail: string;
  if (event.location) {
    detail = `${event.location} · ${duration}`;
  } else if (event.meetingLink) {
    detail = `${meetingPlatformLabel(event.meetingLink)} · ${duration}`;
  } else {
    detail = duration;
  }

  const backgroundColor = isNow ? EMERALD_BG : AMBER_BG;
  const borderColor = isNow
    ? EMERALD_BORDER
    : isUrgent
    ? AMBER_BORDER_URGENT
    : AMBER_BORDER;
  const timeColor = isNow ? EMERALD_TEXT : AMBER_TEXT;

  // Subtle glow shadow for urgent upcoming (≤10 min)
  const shadowStyle = isUrgent && !isNow
    ? {
        shadowColor: 'rgba(245, 158, 11, 1)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.15,
        shadowRadius: 8,
      }
    : {};

  return (
    <Pressable
      style={[styles.wrapper, { backgroundColor, borderColor }, shadowStyle]}
      onPress={onPress}
      accessibilityLabel={`Next up: ${event.title}`}
    >
      {/* Left: time until */}
      <View style={styles.timeUntilContainer}>
        <Text style={[styles.timeUntil, { color: timeColor }]}>{timeUntil}</Text>
      </View>

      {/* Right: title + detail */}
      <View style={styles.infoContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {event.title}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.omnibar,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: 10,
  },
  timeUntilContainer: {
    marginRight: 12,
    minWidth: 48,
    alignItems: 'flex-start',
  },
  timeUntil: {
    fontSize: 11,
    fontWeight: '600',
  },
  infoContainer: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.80)',
  },
  detail: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.40)',
  },
});
