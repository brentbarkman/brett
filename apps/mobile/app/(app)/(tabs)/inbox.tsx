import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LivingBackground } from '../../../src/components/LivingBackground';
import { TaskRow } from '../../../src/components/TaskRow';
import { EmptyState } from '../../../src/components/EmptyState';
import { Omnibar } from '../../../src/components/Omnibar';
import { useMockItems, type MockItem } from '../../../src/mock/hooks';
import { colors, typography } from '../../../src/theme/tokens';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCapturedLabel(createdAt: string): string {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffHours < 1) return 'Captured just now';
  if (diffHours < 24) return `Captured ${diffHours}h ago`;

  // Check if it was yesterday
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (created >= startOfYesterday && created < startOfToday) {
    return 'Captured yesterday';
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return `Captured ${diffDays}d ago`;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function InboxScreen() {
  const router = useRouter();
  const { inboxItems, toggleItem, createItem } = useMockItems();

  const itemCount = inboxItems.length;

  return (
    <View style={{ flex: 1 }}>
      <LivingBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.pageHeader}>Inbox</Text>
          <Text style={styles.metadataText}>
            {itemCount === 0 ? 'Nothing to triage' : `${itemCount} item${itemCount === 1 ? '' : 's'} to triage`}
          </Text>
        </View>

        {/* Content */}
        {itemCount === 0 ? (
          <View style={{ flex: 1 }}>
            <EmptyState variant="inbox-empty" />
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
          >
            {inboxItems.map((item: MockItem) => (
              <TaskRow
                key={item.id}
                id={item.id}
                title={item.title}
                isDone={false}
                dueLabel={formatCapturedLabel(item.createdAt)}
                contentType={item.type === 'content' ? item.contentType : null}
                contentDomain={item.type === 'content' ? item.contentDomain : null}
                onToggle={() => toggleItem(item.id)}
                onPress={() => {
                  if (item.type === 'content') {
                    router.push(`/content/${item.id}` as never);
                  } else {
                    router.push(`/task/${item.id}` as never);
                  }
                }}
              />
            ))}
          </ScrollView>
        )}

        {/* Omnibar */}
        <View style={styles.omnibarContainer}>
          <Omnibar
            placeholder="Capture something..."
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
  metadataText: {
    ...typography.metadata,
    color: colors.text.tertiary,
    marginTop: 3,
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
