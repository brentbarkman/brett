import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/tokens';
import type { MockCalendarEvent } from '../mock/hooks';

const HOUR_HEIGHT = 56; // pixels per hour
const MIN_HEIGHT = 40;

interface TimelineEventProps {
  event: MockCalendarEvent;
}

function formatDuration(startTime: string, endTime: string): string {
  const diffMs = new Date(endTime).getTime() - new Date(startTime).getTime();
  const totalMinutes = Math.round(diffMs / 60_000);
  return `${totalMinutes}min`;
}

function getMeetingPlatform(meetingLink: string | null): string | null {
  if (!meetingLink) return null;
  if (meetingLink.includes('zoom')) return 'Zoom';
  if (meetingLink.includes('meet.google')) return 'Google Meet';
  if (meetingLink.includes('teams')) return 'Teams';
  return 'Video call';
}

export function TimelineEvent({ event }: TimelineEventProps) {
  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);
  const durationMs = endDate.getTime() - startDate.getTime();
  const durationMins = Math.round(durationMs / 60_000);
  const heightFromDuration = Math.max((durationMins / 60) * HOUR_HEIGHT, MIN_HEIGHT);

  const platform = getMeetingPlatform(event.meetingLink);
  const detail = event.location
    ? `${event.location} · ${formatDuration(event.startTime, event.endTime)}`
    : platform
    ? `${platform} · ${formatDuration(event.startTime, event.endTime)}`
    : formatDuration(event.startTime, event.endTime);

  const bgColor = hexToRgba(event.calendarColor, 0.06);

  return (
    <View
      style={[
        styles.block,
        {
          height: heightFromDuration,
          borderLeftColor: event.calendarColor,
          backgroundColor: bgColor,
        },
      ]}
    >
      <Text style={styles.title} numberOfLines={2}>
        {event.title}
      </Text>
      <Text style={styles.detail} numberOfLines={1}>
        {detail}
      </Text>
    </View>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  block: {
    borderLeftWidth: 2,
    borderRadius: 0,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.text.primary,
    marginBottom: 2,
  },
  detail: {
    fontSize: 11,
    color: colors.text.secondary,
  },
});
