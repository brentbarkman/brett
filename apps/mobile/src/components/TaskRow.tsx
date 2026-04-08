import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Swipeable } from 'react-native-gesture-handler';
import { CalendarDays, CheckSquare } from 'lucide-react-native';
import { colors, radii, spacing, touchTargetMin, typography } from '../theme/tokens';
import { haptics } from '../theme/haptics';
import { useReduceMotion } from '../hooks/use-reduce-motion';

interface TaskRowProps {
  id: string;
  title: string;
  isDone: boolean;
  isOverdue?: boolean;
  dueLabel?: string;
  listName?: string;
  listColor?: string;
  contentType?: string | null;
  contentDomain?: string | null;
  isSelected?: boolean;
  onToggle: () => void;
  onPress: () => void;
  onSchedule?: () => void;
  onSelect?: () => void;
}

const CHECKBOX_SIZE = 20;
const GOLD = colors.gold;
const GOLD_BORDER = 'rgba(232, 185, 49, 0.4)';
const TRANSPARENT = 'transparent';

const SCHEDULE_BG = 'rgba(232, 185, 49, 0.15)';
const SELECT_BG = 'rgba(70, 130, 195, 0.12)';
const ACTION_WIDTH = 80;

function ScheduleAction() {
  return (
    <View style={styles.scheduleAction}>
      <CalendarDays size={22} color={colors.gold} />
    </View>
  );
}

function SelectAction() {
  return (
    <View style={styles.selectAction}>
      <CheckSquare size={22} color={colors.cerulean} />
    </View>
  );
}

export function TaskRow({
  id,
  title,
  isDone,
  isOverdue,
  dueLabel,
  listName,
  listColor,
  contentType,
  contentDomain,
  isSelected,
  onToggle,
  onPress,
  onSchedule,
  onSelect,
}: TaskRowProps) {
  const reduceMotion = useReduceMotion();
  const isContent = Boolean(contentType);
  const fillProgress = useSharedValue(isDone ? 1 : 0);
  const swipeableRef = useRef<Swipeable>(null);
  const scheduledHapticFired = useRef(false);
  const selectHapticFired = useRef(false);

  // Lift animation for long-press drag hint
  const isLifted = useSharedValue(0);
  // Checkbox scale pulse for completion animation
  const checkboxScale = useSharedValue(1);
  // Gold shadow glow intensity
  const checkboxGlow = useSharedValue(0);

  useEffect(() => {
    if (isDone) {
      if (reduceMotion) {
        // Instant fill, no scale pulse or glow
        fillProgress.value = withTiming(1, { duration: 0 });
      } else {
        // togglePulse: scale 1 → 1.15 → 1 with spring, glow expands then fades
        checkboxScale.value = withSequence(
          withSpring(1.15, { damping: 8, stiffness: 200 }),
          withSpring(1, { damping: 12, stiffness: 180 }),
        );
        checkboxGlow.value = withSequence(
          withTiming(1, { duration: 150 }),
          withTiming(0, { duration: 450 }),
        );
        fillProgress.value = withTiming(1, { duration: 150 });
      }
    } else {
      fillProgress.value = withTiming(0, { duration: reduceMotion ? 0 : 150 });
    }
  }, [isDone, reduceMotion]);

  const animatedCheckboxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      fillProgress.value,
      [0, 1],
      [TRANSPARENT, GOLD],
    ),
    transform: [{ scale: checkboxScale.value }],
    shadowColor: GOLD,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: interpolate(checkboxGlow.value, [0, 1], [0, 0.7]),
    shadowRadius: interpolate(checkboxGlow.value, [0, 1], [0, 8]),
  }));

  // Selection indicator animation
  const selectedScale = useSharedValue(isSelected ? 1 : 0);
  useEffect(() => {
    selectedScale.value = withTiming(isSelected ? 1 : 0, { duration: 150 });
  }, [isSelected]);

  const animatedSelectionStyle = useAnimatedStyle(() => ({
    transform: [{ scale: selectedScale.value }],
    opacity: selectedScale.value,
  }));

  // Lift style for long-press
  const animatedLiftStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(isLifted.value, [0, 1], [1, 1.03]) }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: interpolate(isLifted.value, [0, 1], [0, 8]) },
    shadowOpacity: interpolate(isLifted.value, [0, 1], [0, 0.3]),
    shadowRadius: interpolate(isLifted.value, [0, 1], [0, 12]),
    elevation: interpolate(isLifted.value, [0, 1], [0, 8]),
    zIndex: isLifted.value > 0.5 ? 10 : 0,
  }));

  const handleToggle = () => {
    haptics.completion();
    onToggle();
    AccessibilityInfo.announceForAccessibility(
      isDone ? `Marked ${title} incomplete` : `Completed: ${title}`,
    );
  };

  const handleLongPress = () => {
    haptics.rigid();
    if (!reduceMotion) {
      isLifted.value = withTiming(1, { duration: 100 });
    }
  };

  const handlePressOut = () => {
    if (isLifted.value > 0) {
      isLifted.value = withSpring(0);
    }
  };

  const handleSwipeOpen = (direction: 'left' | 'right') => {
    if (direction === 'right') {
      // Swiped right — schedule action revealed
      haptics.medium();
      swipeableRef.current?.close();
      onSchedule?.();
    } else {
      // Swiped left — select action revealed
      haptics.medium();
      swipeableRef.current?.close();
      onSelect?.();
    }
    scheduledHapticFired.current = false;
    selectHapticFired.current = false;
  };

  const metadataParts: string[] = [];
  if (isContent && contentDomain) {
    metadataParts.push(contentDomain);
  } else if (dueLabel) {
    metadataParts.push(dueLabel);
  }
  if (listName) {
    metadataParts.push(listName);
  }
  const metadataText = metadataParts.join(' · ');

  const rowStyle = [
    styles.row,
    isOverdue && !isContent && styles.rowOverdue,
    isContent && styles.rowContent,
    isSelected && styles.rowSelected,
  ];

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={() => <ScheduleAction />}
      renderRightActions={() => <SelectAction />}
      onSwipeableOpen={handleSwipeOpen}
      friction={2}
      leftThreshold={ACTION_WIDTH * 0.6}
      rightThreshold={ACTION_WIDTH * 0.6}
      overshootLeft={false}
      overshootRight={false}
    >
      <Animated.View style={animatedLiftStyle}>
        <Pressable
          style={rowStyle}
          onPress={onPress}
          onLongPress={handleLongPress}
          onPressOut={handlePressOut}
          delayLongPress={500}
          accessibilityLabel={title}
          accessibilityHint="Double-tap for details"
          accessibilityActions={[
            { name: 'schedule', label: 'Schedule' },
            { name: 'select', label: 'Select' },
          ]}
          onAccessibilityAction={(event) => {
            switch (event.nativeEvent.actionName) {
              case 'schedule':
                onSchedule?.();
                break;
              case 'select':
                onSelect?.();
                break;
            }
          }}
        >
          {/* Selection indicator dot */}
          <Animated.View style={[styles.selectionDot, animatedSelectionStyle]} />

          {/* Checkbox or content indicator */}
          {isContent ? (
            <View style={styles.contentIndicator} />
          ) : (
            <Pressable
              style={styles.checkboxTapArea}
              onPress={handleToggle}
              hitSlop={0}
              accessibilityLabel={isDone ? `Mark ${title} incomplete` : `Complete ${title}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isDone }}
            >
              <Animated.View style={[styles.checkbox, animatedCheckboxStyle]} />
            </Pressable>
          )}

          {/* Text content */}
          <View style={styles.textContainer}>
            <Text
              style={[
                styles.title,
                isDone && styles.titleDone,
              ]}
              numberOfLines={2}
            >
              {title}
            </Text>
            {metadataText.length > 0 && (
              <Text style={styles.metadata} numberOfLines={1}>
                {metadataText}
              </Text>
            )}
          </View>
        </Pressable>
      </Animated.View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radii.taskRow,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: 5,
  },
  rowOverdue: {
    borderLeftWidth: 2,
    borderLeftColor: colors.red,
  },
  rowContent: {
    borderLeftWidth: 2,
    borderLeftColor: colors.cerulean,
  },
  rowSelected: {
    backgroundColor: 'rgba(70, 130, 195, 0.10)',
  },
  selectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.cerulean,
    marginRight: 6,
    marginLeft: -2,
  },
  checkboxTapArea: {
    width: touchTargetMin,
    height: touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -spacing.sm,
    marginRight: spacing.xs,
  },
  checkbox: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: CHECKBOX_SIZE / 2,
    borderWidth: 1.5,
    borderColor: GOLD_BORDER,
  },
  contentIndicator: {
    width: spacing.sm,
    marginRight: spacing.sm,
  },
  textContainer: {
    flex: 1,
    gap: 3,
  },
  title: {
    ...typography.taskTitle,
    color: colors.text.primary,
  },
  titleDone: {
    textDecorationLine: 'line-through',
    opacity: 0.35,
  },
  metadata: {
    ...typography.metadata,
    color: 'rgba(232, 185, 49, 0.5)',
  },
  scheduleAction: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SCHEDULE_BG,
    borderRadius: radii.taskRow,
    marginBottom: 5,
  },
  selectAction: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SELECT_BG,
    borderRadius: radii.taskRow,
    marginBottom: 5,
  },
});
