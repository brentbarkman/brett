import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/tokens';

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Map JS day-of-week (0=Sun) to Mon-first index (0=Mon…6=Sun). */
function todayMondayIndex(): number {
  const jsDay = new Date().getDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1;
}

interface WeekStripProps {
  /** Set of Monday-indexed day indices (0–6) that have events. */
  daysWithEvents?: Set<number>;
}

export function WeekStrip({ daysWithEvents = new Set() }: WeekStripProps) {
  const todayIdx = todayMondayIndex();

  return (
    <View style={styles.row}>
      {DAY_LABELS.map((label, idx) => {
        const isToday = idx === todayIdx;
        const hasEvent = daysWithEvents.has(idx);

        return (
          <View key={idx} style={styles.dayColumn}>
            <Text style={styles.dayLabel}>{label}</Text>
            <View style={[styles.dayCircle, isToday && styles.dayCircleToday]}>
              <Text style={[styles.dayNumber, isToday && styles.dayNumberToday]}>
                {getDayNumber(idx)}
              </Text>
            </View>
            {hasEvent ? <View style={styles.dot} /> : <View style={styles.dotPlaceholder} />}
          </View>
        );
      })}
    </View>
  );
}

/** Returns the calendar date number for a given Monday-first week index. */
function getDayNumber(mondayIdx: number): string {
  const now = new Date();
  const jsDay = now.getDay(); // 0=Sun
  const currentMondayIdx = jsDay === 0 ? 6 : jsDay - 1;
  const diff = mondayIdx - currentMondayIdx;
  const date = new Date(now);
  date.setDate(now.getDate() + diff);
  return String(date.getDate());
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  dayColumn: {
    alignItems: 'center',
    gap: 4,
  },
  dayLabel: {
    fontSize: 10,
    color: colors.text.tertiary,
    fontWeight: '500',
  },
  dayCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  dayCircleToday: {
    backgroundColor: colors.gold,
  },
  dayNumber: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  dayNumberToday: {
    color: '#000000',
    fontWeight: '700',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.gold,
  },
  dotPlaceholder: {
    width: 3,
    height: 3,
  },
});
