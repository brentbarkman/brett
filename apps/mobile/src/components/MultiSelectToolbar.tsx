import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, FolderInput, Trash2 } from 'lucide-react-native';
import { colors, spacing, typography } from '../theme/tokens';

interface MultiSelectToolbarProps {
  selectedCount: number;
  onSchedule: () => void;
  onMoveToList: () => void;
  onDelete: () => void;
  onDone: () => void;
  visible: boolean;
}

const TOOLBAR_HEIGHT = 60;

export function MultiSelectToolbar({
  selectedCount,
  onSchedule,
  onMoveToList,
  onDelete,
  onDone,
  visible,
}: MultiSelectToolbarProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(TOOLBAR_HEIGHT + insets.bottom + 20);

  useEffect(() => {
    translateY.value = withSpring(visible ? 0 : TOOLBAR_HEIGHT + insets.bottom + 20, {
      damping: 20,
      stiffness: 250,
      mass: 0.8,
    });
  }, [visible, insets.bottom]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      style={[
        styles.container,
        { paddingBottom: insets.bottom + spacing.sm },
        animatedStyle,
      ]}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <View style={styles.content}>
        {/* Left: action buttons */}
        <View style={styles.actions}>
          <Pressable style={styles.actionButton} onPress={onSchedule} accessibilityLabel="Schedule selected tasks">
            <CalendarDays size={20} color={colors.gold} />
            <Text style={[styles.actionLabel, { color: colors.gold }]}>Schedule</Text>
          </Pressable>

          <Pressable style={styles.actionButton} onPress={onMoveToList} accessibilityLabel="Move selected tasks to list">
            <FolderInput size={20} color={colors.cerulean} />
            <Text style={[styles.actionLabel, { color: colors.cerulean }]}>Move</Text>
          </Pressable>

          <Pressable style={styles.actionButton} onPress={onDelete} accessibilityLabel="Delete selected tasks">
            <Trash2 size={20} color={colors.red} />
            <Text style={[styles.actionLabel, { color: colors.red }]}>Delete</Text>
          </Pressable>
        </View>

        {/* Right: count + done */}
        <View style={styles.right}>
          <Text style={styles.countText}>
            {selectedCount} selected
          </Text>
          <Pressable style={styles.doneButton} onPress={onDone} accessibilityLabel="Exit selection mode">
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255, 255, 255, 0.10)',
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TOOLBAR_HEIGHT,
  },
  actions: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xl,
  },
  actionButton: {
    alignItems: 'center',
    gap: 3,
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  countText: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  doneButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 6,
  },
  doneText: {
    ...typography.body,
    color: colors.text.primary,
    fontWeight: '600',
  },
});
