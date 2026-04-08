import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LivingBackground } from '../../../src/components/LivingBackground';
import { WeekStrip } from '../../../src/components/WeekStrip';
import { TimelineEvent } from '../../../src/components/TimelineEvent';
import { EmptyState } from '../../../src/components/EmptyState';
import { useMockCalendarEvents, type MockCalendarEvent } from '../../../src/mock/hooks';
import { colors, typography } from '../../../src/theme/tokens';

// ── Constants ─────────────────────────────────────────────────────────────────

const HOUR_HEIGHT = 56; // height of each 1-hour slot
const START_HOUR = 7;   // 7 AM
const END_HOUR = 20;    // 8 PM
const TIME_LABEL_WIDTH = 40;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

/** Returns Monday-first index (0=Mon…6=Sun) for the day of a given ISO date string. */
function mondayIdxForDate(isoString: string): number {
  const jsDay = new Date(isoString).getDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1;
}

/** Returns the hour (0–23) when an event starts. */
function startHourOf(event: MockCalendarEvent): number {
  return new Date(event.startTime).getHours();
}

/** Returns true if a date is today. */
function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

// ── Current Time Indicator ────────────────────────────────────────────────────

function CurrentTimeIndicator() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Only render if within the visible hour range
  if (currentHour < START_HOUR || currentHour >= END_HOUR) return null;

  const top = (currentHour - START_HOUR) * HOUR_HEIGHT + (currentMinute / 60) * HOUR_HEIGHT;

  return (
    <View style={[styles.currentTimeRow, { top }]} pointerEvents="none">
      <View style={styles.currentTimeDot} />
      <View style={styles.currentTimeLine} />
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const { todayEvents } = useMockCalendarEvents();
  const scrollRef = useRef<ScrollView>(null);

  const today = new Date();
  const monthYear = formatMonthYear(today);
  const showIndicator = isToday(today);

  // Build a set of Monday-indexed days that have events (for WeekStrip dots)
  const daysWithEvents = new Set<number>(
    todayEvents.map((e) => mondayIdxForDate(e.startTime)),
  );

  // Build hour → events map
  const eventsByHour = new Map<number, MockCalendarEvent[]>();
  for (const event of todayEvents) {
    const hour = startHourOf(event);
    const existing = eventsByHour.get(hour) ?? [];
    existing.push(event);
    eventsByHour.set(hour, existing);
  }

  const hours = Array.from(
    { length: END_HOUR - START_HOUR },
    (_, i) => START_HOUR + i,
  );

  return (
    <View style={{ flex: 1 }}>
      <LivingBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.pageHeader}>{monthYear}</Text>
        </View>

        {/* Week strip */}
        <WeekStrip daysWithEvents={daysWithEvents} />

        {/* Day timeline */}
        {todayEvents.length === 0 ? (
          <View style={{ flex: 1 }}>
            <EmptyState variant="no-events" />
          </View>
        ) : (
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={styles.timelineContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Timeline container — relative so the indicator can be positioned within it */}
            <View style={styles.timelineInner}>
              {hours.map((hour) => {
                const slotEvents = eventsByHour.get(hour) ?? [];
                return (
                  <View key={hour} style={styles.hourRow}>
                    {/* Time label */}
                    <View style={styles.timeLabelContainer}>
                      <Text style={styles.timeLabel}>{formatHourLabel(hour)}</Text>
                    </View>

                    {/* Event block or empty space */}
                    <View style={styles.eventContainer}>
                      {slotEvents.length > 0 ? (
                        slotEvents.map((event) => (
                          <TimelineEvent key={event.id} event={event} />
                        ))
                      ) : (
                        <View style={styles.emptySlot} />
                      )}
                    </View>
                  </View>
                );
              })}

              {/* Current-time indicator — overlays the timeline when viewing today */}
              {showIndicator && <CurrentTimeIndicator />}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  pageHeader: {
    ...typography.pageHeader,
    color: colors.text.primary,
  },
  timelineContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  timelineInner: {
    position: 'relative',
  },
  hourRow: {
    flexDirection: 'row',
    minHeight: HOUR_HEIGHT,
    alignItems: 'flex-start',
    paddingTop: 4,
  },
  timeLabelContainer: {
    width: TIME_LABEL_WIDTH,
    paddingTop: 2,
  },
  timeLabel: {
    fontSize: 10,
    color: colors.text.tertiary,
    lineHeight: 14,
  },
  eventContainer: {
    flex: 1,
    gap: 4,
  },
  emptySlot: {
    height: HOUR_HEIGHT - 8,
  },
  // Current-time indicator
  currentTimeRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
    // Offset left by TIME_LABEL_WIDTH so the dot aligns with the event column
    paddingLeft: TIME_LABEL_WIDTH - 4,
  },
  currentTimeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E6554B',
  },
  currentTimeLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(230, 85, 75, 0.5)',
  },
});
