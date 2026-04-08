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

/** Compute a human-readable "time until" label */
function computeTimeUntil(startTime: string, endTime: string): string {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (now >= start && now < end) {
    return 'Now';
  }

  const diffMs = start - now;
  if (diffMs <= 0) return 'Now';

  const totalMinutes = Math.round(diffMs / 60_000);
  if (totalMinutes < 60) {
    return `In ${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `In ${hours}h ${minutes}m` : `In ${hours}h`;
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
  const timeUntil = computeTimeUntil(event.startTime, event.endTime);
  const duration = computeDuration(event.startTime, event.endTime);

  let detail: string;
  if (event.location) {
    detail = `${event.location} · ${duration}`;
  } else if (event.meetingLink) {
    detail = `${meetingPlatformLabel(event.meetingLink)} · ${duration}`;
  } else {
    detail = duration;
  }

  return (
    <Pressable
      style={styles.wrapper}
      onPress={onPress}
      accessibilityLabel={`Next up: ${event.title}`}
    >
      {/* Left: time until */}
      <View style={styles.timeUntilContainer}>
        <Text style={styles.timeUntil}>{timeUntil}</Text>
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
    backgroundColor: 'rgba(232, 185, 49, 0.05)',
    borderColor: 'rgba(232, 185, 49, 0.12)',
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
    color: 'rgba(232, 185, 49, 0.7)',
  },
  infoContainer: {
    flex: 1,
    gap: 3,
  },
  title: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  detail: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.3)',
  },
});
