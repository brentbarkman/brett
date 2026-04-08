import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LivingBackground } from '../../../src/components/LivingBackground';
import { GlassCard } from '../../../src/components/GlassCard';
import { EmptyState } from '../../../src/components/EmptyState';
import { useMockScouts } from '../../../src/mock/hooks';
import type { MockScout } from '../../../src/mock/hooks';
import { colors, radii, spacing, typography } from '../../../src/theme/tokens';
import { haptics } from '../../../src/theme/haptics';

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_BG: Record<MockScout['status'], string> = {
  active: 'rgba(72, 187, 160, 0.18)',
  paused: 'rgba(232, 185, 49, 0.18)',
  error: 'rgba(230, 85, 75, 0.18)',
};

const STATUS_COLOR: Record<MockScout['status'], string> = {
  active: colors.teal,
  paused: colors.gold,
  error: colors.red,
};

const STATUS_LABEL: Record<MockScout['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  error: 'Error',
};

interface StatusPillProps {
  status: MockScout['status'];
}

function StatusPill({ status }: StatusPillProps) {
  return (
    <View style={[styles.pill, { backgroundColor: STATUS_BG[status] }]}>
      <Text style={[styles.pillText, { color: STATUS_COLOR[status] }]}>
        {STATUS_LABEL[status]}
      </Text>
    </View>
  );
}

// ── Scout card ────────────────────────────────────────────────────────────────

interface ScoutCardProps {
  scout: MockScout;
  onPress: () => void;
}

function ScoutCard({ scout, onPress }: ScoutCardProps) {
  const lastFinding = scout.lastFindingAt
    ? formatRelativeTime(scout.lastFindingAt)
    : 'Never';

  return (
    <Pressable
      onPress={onPress}
      style={styles.cardWrapper}
    >
      <GlassCard style={styles.card}>
        {/* Top row: name + status */}
        <View style={styles.cardTopRow}>
          <Text style={styles.scoutName} numberOfLines={1}>
            {scout.name}
          </Text>
          <StatusPill status={scout.status} />
        </View>

        {/* Goal */}
        <Text style={styles.scoutGoal} numberOfLines={2}>
          {scout.goal}
        </Text>

        {/* Bottom row: finding stats */}
        <Text style={styles.scoutMeta}>
          {scout.findingCount} findings · Last: {lastFinding}
        </Text>
      </GlassCard>
    </Pressable>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ScoutsRosterScreen() {
  const router = useRouter();
  const { scouts } = useMockScouts();

  return (
    <View style={styles.root}>
      <LivingBackground />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        {/* Back breadcrumb */}
        <Pressable onPress={() => router.back()} style={styles.breadcrumb}>
          <Text style={styles.breadcrumbText}>‹ Back</Text>
        </Pressable>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Text style={styles.pageHeader}>Scouts</Text>

          {/* List */}
          {scouts.length === 0 ? (
            <EmptyState variant="scouts-empty" />
          ) : (
            scouts.map((scout) => (
              <ScoutCard
                key={scout.id}
                scout={scout}
                onPress={() => {
                  haptics.light();
                  router.push(`/scouts/${scout.id}`);
                }}
              />
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  breadcrumb: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    alignSelf: 'flex-start',
  },
  breadcrumbText: {
    fontSize: 14,
    color: colors.gold,
    fontWeight: '500',
  },
  scroll: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  pageHeader: {
    ...typography.pageHeader,
    color: colors.text.primary,
    marginBottom: spacing.xxl,
    marginTop: spacing.sm,
  },

  // Cards
  cardWrapper: {
    marginBottom: 10,
  },
  card: {
    padding: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  scoutName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
    flex: 1,
    marginRight: spacing.sm,
  },
  scoutGoal: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.text.secondary,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  scoutMeta: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.text.tertiary,
  },

  // Status pill
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.full,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '500',
  },
});
