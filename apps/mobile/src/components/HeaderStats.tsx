import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, spacing, typography } from '../theme/tokens';

interface HeaderStatsProps {
  date: string;
  doneCount: number;
  totalCount: number;
  meetingCount: number;
  meetingDuration: string;
}

const TEXT_SECONDARY = colors.text.secondary;
const GOLD_FLASH = 'rgba(232, 185, 49, 0.8)';

export function HeaderStats({
  date,
  doneCount,
  totalCount,
  meetingCount,
  meetingDuration,
}: HeaderStatsProps) {
  const statsFlash = useSharedValue(0);

  useEffect(() => {
    if (doneCount > 0) {
      statsFlash.value = withTiming(1, { duration: 100 }, () => {
        statsFlash.value = withTiming(0, { duration: 400 });
      });
    }
  }, [doneCount]);

  const animatedStatsStyle = useAnimatedStyle(() => ({
    color: interpolateColor(statsFlash.value, [0, 1], [TEXT_SECONDARY, GOLD_FLASH]),
  }));

  const meetingWord = meetingCount === 1 ? 'meeting' : 'meetings';
  const statsText = `${doneCount} of ${totalCount} done · ${meetingCount} ${meetingWord} (${meetingDuration})`;

  return (
    <View style={styles.container}>
      <Text style={styles.date}>{date}</Text>
      <Animated.Text style={[styles.stats, animatedStatsStyle]}>
        {statsText}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  date: {
    ...typography.pageHeader,
    color: colors.text.primary,
  },
  stats: {
    ...typography.body,
    color: TEXT_SECONDARY,
    marginTop: 2,
  },
});
