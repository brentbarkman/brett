import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, radii, spacing, touchTargetMin, typography } from '../theme/tokens';
import { haptics } from '../theme/haptics';

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
  onToggle: () => void;
  onPress: () => void;
}

const CHECKBOX_SIZE = 20;
const GOLD = colors.gold;
const GOLD_BORDER = 'rgba(232, 185, 49, 0.4)';
const TRANSPARENT = 'transparent';

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
  onToggle,
  onPress,
}: TaskRowProps) {
  const isContent = Boolean(contentType);
  const fillProgress = useSharedValue(isDone ? 1 : 0);

  useEffect(() => {
    fillProgress.value = withTiming(isDone ? 1 : 0, { duration: 150 });
  }, [isDone]);

  const animatedCheckboxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      fillProgress.value,
      [0, 1],
      [TRANSPARENT, GOLD],
    ),
  }));

  const handleToggle = () => {
    haptics.completion();
    onToggle();
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
  ];

  return (
    <Pressable style={rowStyle} onPress={onPress}>
      {/* Checkbox or content indicator */}
      {isContent ? (
        <View style={styles.contentIndicator} />
      ) : (
        <Pressable
          style={styles.checkboxTapArea}
          onPress={handleToggle}
          hitSlop={0}
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
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
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
});
