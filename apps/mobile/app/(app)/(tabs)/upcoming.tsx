import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LivingBackground } from '../../../src/components/LivingBackground';
import { GlassCard } from '../../../src/components/GlassCard';
import { SectionHeader } from '../../../src/components/SectionHeader';
import { TaskRow } from '../../../src/components/TaskRow';
import { EmptyState } from '../../../src/components/EmptyState';
import { Omnibar } from '../../../src/components/Omnibar';
import { useMockItems, type MockItem } from '../../../src/mock/hooks';
import { colors, typography } from '../../../src/theme/tokens';
import { getListForItem } from '../../../src/mock/data';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isTomorrow(dateStr: string): boolean {
  const date = new Date(dateStr);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  );
}

function formatSectionDate(dateStr: string): string {
  if (isTomorrow(dateStr)) return 'Tomorrow';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function normalizeDateKey(dateStr: string): string {
  const date = new Date(dateStr);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

interface DateGroup {
  dateKey: string;
  label: string;
  items: MockItem[];
}

function groupByDate(items: MockItem[]): DateGroup[] {
  const map = new Map<string, MockItem[]>();
  for (const item of items) {
    if (!item.dueDate) continue;
    const key = normalizeDateKey(item.dueDate);
    const existing = map.get(key) ?? [];
    existing.push(item);
    map.set(key, existing);
  }

  const groups: DateGroup[] = [];
  for (const [dateKey, groupItems] of map.entries()) {
    groups.push({
      dateKey,
      label: formatSectionDate(groupItems[0].dueDate!),
      items: groupItems,
    });
  }

  // Sort groups ascending by date key
  groups.sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  return groups;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function UpcomingScreen() {
  const router = useRouter();
  const { upcomingItems, toggleItem, createItem } = useMockItems();

  const groups = groupByDate(upcomingItems);

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <LivingBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.pageHeader}>Upcoming</Text>
        </View>

        {/* Content */}
        {groups.length === 0 ? (
          <View style={{ flex: 1 }}>
            <EmptyState variant="upcoming-empty" />
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.gold}
              />
            }
          >
            <GlassCard variant="primary" style={{ padding: 8 }}>
              {groups.map((group) => (
                <View key={group.dateKey}>
                  <SectionHeader label={group.label} />
                  {group.items.map((item) => (
                    <TaskRow
                      key={item.id}
                      id={item.id}
                      title={item.title}
                      isDone={false}
                      listName={getListForItem(item)?.name}
                      onToggle={() => toggleItem(item.id)}
                      onPress={() => router.push(`/task/${item.id}?from=Upcoming` as never)}
                    />
                  ))}
                </View>
              ))}
            </GlassCard>
          </ScrollView>
        )}

        {/* Omnibar */}
        <View style={styles.omnibarContainer}>
          <Omnibar
            onSubmit={(text) => createItem(text, null, null)}
          />
        </View>
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
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  omnibarContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
});
