import React, { useEffect } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LivingBackground } from '../../../src/components/LivingBackground';
import { GlassCard } from '../../../src/components/GlassCard';
import {
  useMockItems,
  useMockLists,
  useMockSubtasks,
} from '../../../src/mock/hooks';
import { colors, radii, spacing, typography, touchTargetMin } from '../../../src/theme/tokens';
import { haptics } from '../../../src/theme/haptics';
import type { MockItem } from '../../../src/mock/hooks';

// ── Formatting helpers ────────────────────────────────────────────────────────

function formatReminder(reminder: string | null): string {
  if (!reminder) return 'None';
  switch (reminder) {
    case 'morning_of': return 'Morning of';
    case '1_hour_before': return '1 hour before';
    case 'day_before': return 'Day before';
    default: return reminder;
  }
}

function formatRecurrence(recurrence: string | null): string {
  if (!recurrence) return 'None';
  switch (recurrence) {
    case 'daily': return 'Daily';
    case 'weekly': return 'Weekly';
    case 'monthly': return 'Monthly';
    case 'yearly': return 'Yearly';
    default: return recurrence.charAt(0).toUpperCase() + recurrence.slice(1);
  }
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return 'Not set';
  const d = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(dueDate);
  target.setHours(0, 0, 0, 0);
  if (target.getTime() === today.getTime()) return 'Today';
  if (target.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Checkbox ──────────────────────────────────────────────────────────────────

const CHECKBOX_SIZE = 24;
const GOLD = colors.gold;
const GOLD_BORDER = 'rgba(232, 185, 49, 0.4)';

interface CheckboxProps {
  isDone: boolean;
  onToggle: () => void;
}

function Checkbox({ isDone, onToggle }: CheckboxProps) {
  const fillProgress = useSharedValue(isDone ? 1 : 0);

  useEffect(() => {
    fillProgress.value = withTiming(isDone ? 1 : 0, { duration: 150 });
  }, [isDone]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      fillProgress.value,
      [0, 1],
      ['transparent', GOLD],
    ),
  }));

  const handleToggle = () => {
    haptics.completion();
    onToggle();
  };

  return (
    <Pressable style={styles.checkboxTapArea} onPress={handleToggle} hitSlop={0}>
      <Animated.View style={[styles.checkbox, animatedStyle]} />
    </Pressable>
  );
}

// ── Detail row ────────────────────────────────────────────────────────────────

interface DetailRowProps {
  label: string;
  value: string;
  valueColor?: string;
  isLast?: boolean;
}

function DetailRow({ label, value, valueColor, isLast }: DetailRowProps) {
  return (
    <View style={[styles.detailRow, !isLast && styles.detailRowBorder]}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, valueColor ? { color: valueColor } : undefined]}>
        {value}
      </Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getItem, toggleItem } = useMockItems();
  const { getList } = useMockLists();
  const { subtasks, toggleSubtask } = useMockSubtasks(id);

  const item = getItem(id);
  const list = item?.listId ? getList(item.listId) : undefined;

  if (!item) {
    return (
      <View style={styles.root}>
        <LivingBackground />
        <SafeAreaView edges={['top']} style={styles.safeArea}>
          <View style={styles.notFoundContainer}>
            <Text style={styles.notFoundText}>Task not found</Text>
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backButtonText}>‹ Go back</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const isDone = item.status === 'done';
  const dueDateValue = item.dueDate ? formatDueDate(item.dueDate) : 'Not set';
  const reminderValue = formatReminder(item.reminder);
  const recurrenceValue = formatRecurrence(item.recurrence);

  return (
    <View style={styles.root}>
      <LivingBackground />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Back breadcrumb */}
          <Pressable onPress={() => router.back()} style={styles.breadcrumb}>
            <Text style={styles.breadcrumbText}>‹ Today</Text>
          </Pressable>

          {/* Title row */}
          <View style={styles.titleRow}>
            <Checkbox isDone={isDone} onToggle={() => toggleItem(item.id)} />
            <Text
              style={[styles.taskTitle, isDone && styles.taskTitleDone]}
              numberOfLines={3}
            >
              {item.title}
            </Text>
          </View>

          {/* Details card */}
          <GlassCard style={styles.card}>
            <Text style={styles.cardSectionLabel}>Details</Text>
            <DetailRow
              label="Due"
              value={dueDateValue}
              valueColor={item.dueDate ? colors.text.primary : colors.text.tertiary}
            />
            <DetailRow
              label="List"
              value={list ? list.name : 'None'}
              valueColor={list ? colors.gold : colors.text.tertiary}
            />
            <DetailRow
              label="Reminder"
              value={reminderValue}
              valueColor={item.reminder ? colors.text.primary : colors.text.tertiary}
            />
            <DetailRow
              label="Recurrence"
              value={recurrenceValue}
              valueColor={item.recurrence ? colors.text.primary : colors.text.tertiary}
              isLast
            />
          </GlassCard>

          {/* Notes card */}
          <GlassCard style={styles.card}>
            <Text style={styles.cardSectionLabel}>Notes</Text>
            <Text style={[styles.noteText, !item.notes && styles.notePlaceholder]}>
              {item.notes ?? 'Add notes...'}
            </Text>
          </GlassCard>

          {/* Subtasks card — only if subtasks exist */}
          {subtasks.length > 0 && (
            <GlassCard style={styles.card}>
              <Text style={styles.cardSectionLabel}>Subtasks</Text>
              {subtasks.map((sub) => (
                <SubtaskRow
                  key={sub.id}
                  title={sub.title}
                  done={sub.done}
                  onToggle={() => toggleSubtask(sub.id)}
                />
              ))}
            </GlassCard>
          )}

          {/* Brett chat card */}
          <Pressable>
            <View style={styles.brettCard}>
              <View style={styles.brettDot} />
              <Text style={styles.brettPrompt}>Ask Brett about this task...</Text>
            </View>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Subtask row ───────────────────────────────────────────────────────────────

interface SubtaskRowProps {
  title: string;
  done: boolean;
  onToggle: () => void;
}

function SubtaskRow({ title, done, onToggle }: SubtaskRowProps) {
  const fillProgress = useSharedValue(done ? 1 : 0);

  useEffect(() => {
    fillProgress.value = withTiming(done ? 1 : 0, { duration: 150 });
  }, [done]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      fillProgress.value,
      [0, 1],
      ['transparent', GOLD],
    ),
  }));

  const handleToggle = () => {
    haptics.light();
    onToggle();
  };

  return (
    <View style={styles.subtaskRow}>
      <Pressable onPress={handleToggle} style={styles.subtaskCheckboxArea} hitSlop={0}>
        <Animated.View style={[styles.subtaskCheckbox, animatedStyle]} />
      </Pressable>
      <Text style={[styles.subtaskTitle, done && styles.subtaskTitleDone]}>
        {title}
      </Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const SUBTASK_CHECKBOX = 14;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },

  // Not found
  notFoundContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  notFoundText: {
    ...typography.body,
    color: colors.text.secondary,
  },
  backButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  backButtonText: {
    ...typography.body,
    color: GOLD,
  },

  // Breadcrumb
  breadcrumb: {
    marginBottom: spacing.lg,
    alignSelf: 'flex-start',
  },
  breadcrumbText: {
    fontSize: 13,
    color: 'rgba(232,185,49,0.6)',
  },

  // Title row
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  checkboxTapArea: {
    width: touchTargetMin,
    height: touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -((touchTargetMin - CHECKBOX_SIZE) / 2),
  },
  checkbox: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: CHECKBOX_SIZE / 2,
    borderWidth: 1.5,
    borderColor: GOLD_BORDER,
  },
  taskTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '600',
    color: colors.text.primary,
    paddingTop: 2,
    lineHeight: 26,
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    opacity: 0.4,
  },

  // Cards
  card: {
    marginBottom: spacing.md,
    padding: 14,
  },
  cardSectionLabel: {
    ...typography.sectionLabel,
    color: colors.text.tertiary,
    marginBottom: 10,
  },

  // Detail rows
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  detailRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  detailLabel: {
    ...typography.body,
    color: colors.text.secondary,
  },
  detailValue: {
    ...typography.body,
    color: colors.text.primary,
    textAlign: 'right',
    maxWidth: '60%',
  },

  // Notes
  noteText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 22,
  },
  notePlaceholder: {
    color: colors.text.tertiary,
  },

  // Subtasks
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: spacing.sm,
  },
  subtaskCheckboxArea: {
    width: touchTargetMin,
    height: touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -(touchTargetMin - SUBTASK_CHECKBOX) / 2,
  },
  subtaskCheckbox: {
    width: SUBTASK_CHECKBOX,
    height: SUBTASK_CHECKBOX,
    borderRadius: SUBTASK_CHECKBOX / 2,
    borderWidth: 1.5,
    borderColor: GOLD_BORDER,
  },
  subtaskTitle: {
    flex: 1,
    fontSize: 14,
    color: colors.text.primary,
  },
  subtaskTitleDone: {
    textDecorationLine: 'line-through',
    color: 'rgba(255,255,255,0.4)',
  },

  // Brett chat card
  brettCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(70,130,195,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(70,130,195,0.12)',
    borderRadius: radii.card,
    padding: 14,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  brettDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.cerulean,
  },
  brettPrompt: {
    ...typography.body,
    color: colors.text.tertiary,
  },
});
