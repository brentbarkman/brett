import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LivingBackground } from '../../../src/components/LivingBackground';
import { GlassCard } from '../../../src/components/GlassCard';
import { useMockScouts } from '../../../src/mock/hooks';
import type { MockScoutFinding } from '../../../src/mock/hooks';
import { colors, radii, spacing, typography } from '../../../src/theme/tokens';

// ── Finding type badge ────────────────────────────────────────────────────────

const BADGE_BG: Record<MockScoutFinding['type'], string> = {
  insight: 'rgba(232, 185, 49, 0.18)',
  article: 'rgba(70, 130, 195, 0.18)',
  task: 'rgba(72, 187, 160, 0.18)',
};

const BADGE_COLOR: Record<MockScoutFinding['type'], string> = {
  insight: colors.gold,
  article: colors.cerulean,
  task: colors.teal,
};

const BADGE_LABEL: Record<MockScoutFinding['type'], string> = {
  insight: 'Insight',
  article: 'Article',
  task: 'Task',
};

interface TypeBadgeProps {
  type: MockScoutFinding['type'];
}

function TypeBadge({ type }: TypeBadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: BADGE_BG[type] }]}>
      <Text style={[styles.badgeText, { color: BADGE_COLOR[type] }]}>
        {BADGE_LABEL[type]}
      </Text>
    </View>
  );
}

// ── Finding card ──────────────────────────────────────────────────────────────

interface FindingCardProps {
  finding: MockScoutFinding;
}

function FindingCard({ finding }: FindingCardProps) {
  return (
    <GlassCard style={styles.findingCard}>
      {/* Type badge + title */}
      <View style={styles.findingHeader}>
        <TypeBadge type={finding.type} />
      </View>
      <Text style={styles.findingTitle}>{finding.title}</Text>
      <Text style={styles.findingSummary}>{finding.summary}</Text>

      {/* Relevance bar */}
      <View style={styles.relevanceContainer}>
        <View
          style={[
            styles.relevanceFill,
            { width: `${finding.relevanceScore * 100}%` },
          ]}
        />
      </View>

      {/* Source URL */}
      {finding.sourceUrl && (
        <Text style={styles.sourceUrl} numberOfLines={1}>
          {finding.sourceUrl}
        </Text>
      )}
    </GlassCard>
  );
}

// ── Source tag ────────────────────────────────────────────────────────────────

function SourceTag({ label }: { label: string }) {
  return (
    <View style={styles.sourceTag}>
      <Text style={styles.sourceTagText}>{label}</Text>
    </View>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ScoutDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getScout, getFindings } = useMockScouts();

  const scout = getScout(id);
  const findings = getFindings(id);

  if (!scout) {
    return (
      <View style={styles.root}>
        <LivingBackground />
        <SafeAreaView edges={['top']} style={styles.safeArea}>
          <Pressable onPress={() => router.back()} style={styles.breadcrumb}>
            <Text style={styles.breadcrumbText}>‹ Scouts</Text>
          </Pressable>
          <View style={styles.notFound}>
            <Text style={styles.notFoundText}>Scout not found</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LivingBackground />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        {/* Back breadcrumb */}
        <Pressable onPress={() => router.back()} style={styles.breadcrumb}>
          <Text style={styles.breadcrumbText}>‹ Scouts</Text>
        </Pressable>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <Text style={styles.pageHeader}>{scout.name}</Text>

          {/* Goal card */}
          <GlassCard style={styles.card}>
            <SectionLabel>Goal</SectionLabel>
            <Text style={styles.goalText}>{scout.goal}</Text>
          </GlassCard>

          {/* Sources card */}
          <GlassCard style={styles.card}>
            <SectionLabel>Sources</SectionLabel>
            <View style={styles.tagsRow}>
              {scout.sources.map((source) => (
                <SourceTag key={source} label={source} />
              ))}
            </View>
          </GlassCard>

          {/* Findings */}
          {findings.length > 0 && (
            <>
              <SectionLabel>Findings</SectionLabel>
              <View style={styles.findingsList}>
                {findings.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} />
                ))}
              </View>
            </>
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

  // Section label
  sectionLabel: {
    ...typography.sectionLabel,
    color: colors.text.tertiary,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },

  // Cards
  card: {
    padding: 14,
    marginBottom: spacing.md,
  },
  goalText: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.text.primary,
    lineHeight: 22,
  },

  // Source tags
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  sourceTag: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sourceTagText: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.text.secondary,
  },

  // Findings
  findingsList: {
    marginTop: spacing.xs,
  },
  findingCard: {
    padding: 14,
    marginBottom: 8,
  },
  findingHeader: {
    marginBottom: spacing.xs,
  },
  findingTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text.primary,
    marginBottom: spacing.xs,
    lineHeight: 21,
  },
  findingSummary: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.text.secondary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },

  // Relevance bar
  relevanceContainer: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    width: '100%',
    marginBottom: spacing.xs,
    overflow: 'hidden',
  },
  relevanceFill: {
    height: 3,
    backgroundColor: colors.gold,
    borderRadius: 2,
  },

  // Source URL
  sourceUrl: {
    fontSize: 11,
    fontWeight: '400',
    color: 'rgba(70,130,195,0.5)',
    marginTop: 2,
  },

  // Type badge
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.full,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '500',
  },

  // Not found
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notFoundText: {
    ...typography.body,
    color: colors.text.secondary,
  },
});
