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
import { TaskRow } from '../../../src/components/TaskRow';
import { EmptyState } from '../../../src/components/EmptyState';
import { useMockItems, useMockLists } from '../../../src/mock/hooks';
import { colors, spacing, typography } from '../../../src/theme/tokens';

export default function ListDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getListItems, toggleItem } = useMockItems();
  const { getList } = useMockLists();

  const list = getList(id);
  const items = getListItems(id);

  return (
    <View style={styles.root}>
      <LivingBackground />
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        {/* Back breadcrumb */}
        <Pressable
          onPress={() => router.back()}
          style={styles.breadcrumb}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={styles.breadcrumbText}>‹ Back</Text>
        </Pressable>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.pageHeader}>
              {list?.name ?? 'List'}
            </Text>
            {items.length > 0 && (
              <Text style={styles.itemCount}>{items.length}</Text>
            )}
          </View>

          {/* Items */}
          {items.length === 0 ? (
            <EmptyState variant="list-empty" />
          ) : (
            <GlassCard variant="primary" style={{ padding: 8 }}>
              {items.map((item) => (
                <TaskRow
                  key={item.id}
                  id={item.id}
                  title={item.title}
                  isDone={item.status === 'done'}
                  contentType={item.contentType}
                  contentDomain={item.contentDomain}
                  onToggle={() => toggleItem(item.id)}
                  onPress={() => router.push(`/task/${item.id}`)}
                />
              ))}
            </GlassCard>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginBottom: spacing.xxl,
    marginTop: spacing.sm,
  },
  pageHeader: {
    ...typography.pageHeader,
    color: colors.text.primary,
  },
  itemCount: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.text.secondary,
  },
});
