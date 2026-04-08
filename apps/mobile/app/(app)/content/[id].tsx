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
import { useMockItems } from '../../../src/mock/hooks';
import { colors, radii, spacing, typography } from '../../../src/theme/tokens';
import { haptics } from '../../../src/theme/haptics';

// ── Content type label ────────────────────────────────────────────────────────

const CONTENT_TYPE_LABEL: Record<string, string> = {
  newsletter: 'Newsletter',
  web_page: 'Article',
  article: 'Article',
  rss: 'Feed',
};

function getContentTypeLabel(contentType: string | null): string {
  if (!contentType) return 'Content';
  return CONTENT_TYPE_LABEL[contentType.toLowerCase()] ?? contentType.toUpperCase();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ContentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getItem } = useMockItems();

  const item = getItem(id);

  if (!item || item.type !== 'content') {
    return (
      <View style={styles.root}>
        <LivingBackground />
        <SafeAreaView edges={['top']} style={styles.safeArea}>
          <Pressable
            onPress={() => router.back()}
            style={styles.breadcrumb}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <Text style={styles.breadcrumbText}>‹ Back</Text>
          </Pressable>
          <View style={styles.notFound}>
            <Text style={styles.notFoundText}>Content not found</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const typeLabel = getContentTypeLabel(item.contentType);

  const handleSaveAsTask = () => {
    haptics.medium();
    // No-op in prototype
  };

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
          {/* Content type label */}
          <Text style={styles.contentTypeLabel}>
            {typeLabel.toUpperCase()}
          </Text>

          {/* Title */}
          <Text style={styles.pageHeader}>{item.title}</Text>

          {/* Source metadata */}
          <Text style={styles.metadata}>
            {[item.contentDomain, formatDate(item.createdAt)]
              .filter(Boolean)
              .join(' · ')}
          </Text>

          {/* Content body */}
          <View style={styles.bodyArea}>
            {item.contentDescription ? (
              <Text style={styles.bodyText}>{item.contentDescription}</Text>
            ) : (
              <Text style={styles.bodyPlaceholder}>
                Content extraction not available in prototype
              </Text>
            )}
          </View>
        </ScrollView>

        {/* Save as task button */}
        <View style={styles.footer}>
          <Pressable style={styles.saveButton} onPress={handleSaveAsTask} accessibilityLabel="Save as task" accessibilityRole="button">
            <Text style={styles.saveButtonText}>Save as task</Text>
          </Pressable>
        </View>
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
    paddingBottom: spacing.xl,
  },

  // Content type label
  contentTypeLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: colors.cerulean,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },

  // Header
  pageHeader: {
    ...typography.pageHeader,
    color: colors.text.primary,
    marginBottom: spacing.sm,
    lineHeight: 30,
  },

  // Metadata
  metadata: {
    ...typography.metadata,
    color: colors.text.tertiary,
    marginBottom: spacing.xxl,
  },

  // Body
  bodyArea: {
    marginBottom: spacing.xl,
  },
  bodyText: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.text.primary,
    lineHeight: 24,
  },
  bodyPlaceholder: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.text.tertiary,
    textAlign: 'center',
    paddingVertical: spacing.xxxl,
  },

  // Footer
  footer: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  saveButton: {
    backgroundColor: colors.gold,
    borderRadius: radii.button,
    padding: 14,
    alignItems: 'center',
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1A1200',
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
