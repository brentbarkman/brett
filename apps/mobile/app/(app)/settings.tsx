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
import { LivingBackground } from '../../src/components/LivingBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { colors, spacing, typography } from '../../src/theme/tokens';
import { haptics } from '../../src/theme/haptics';

// ── Setting row ───────────────────────────────────────────────────────────────

interface SettingRowProps {
  label: string;
  value?: string;
  valueColor?: string;
  isLast?: boolean;
  isDestructive?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'none' | 'menuitem' | 'summary' | 'image' | 'imagebutton' | 'keyboardkey' | 'text' | 'adjustable' | 'spinbutton' | 'combobox' | 'radiogroup' | 'scrollbar' | 'tab' | 'tablist' | 'timer' | 'toolbar' | 'checkbox' | 'radio' | 'switch' | 'header' | 'search' | 'list';
}

function SettingRow({ label, value, valueColor, isLast, isDestructive, onPress, accessibilityLabel, accessibilityRole }: SettingRowProps) {
  const content = (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <Text style={[styles.label, isDestructive && styles.labelDestructive]}>
        {label}
      </Text>
      {value !== undefined && (
        <Text style={[styles.value, valueColor ? { color: valueColor } : undefined]}>
          {value}
        </Text>
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        android_ripple={{ color: 'rgba(255,255,255,0.05)' }}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

// ── Section group ─────────────────────────────────────────────────────────────

interface SectionGroupProps {
  children: React.ReactNode;
}

function SectionGroup({ children }: SectionGroupProps) {
  return <GlassCard style={styles.sectionCard}>{children}</GlassCard>;
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const router = useRouter();

  const handleSignOut = () => {
    haptics.medium();
    // No-op in prototype
  };

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
          {/* Page header */}
          <Text style={styles.pageHeader}>Settings</Text>

          {/* Group 1 — Profile */}
          <SectionGroup>
            <SettingRow label="Name" value="Brent Barkman" />
            <SettingRow label="Email" value="brent@example.com" isLast />
          </SectionGroup>

          {/* Group 2 — Security */}
          <SectionGroup>
            <SettingRow label="Password" value="••••••••" />
            <SettingRow label="Connected Accounts" value="Google, Apple" isLast />
          </SectionGroup>

          {/* Group 3 — Calendar */}
          <SectionGroup>
            <SettingRow
              label="Google Calendar"
              value="Connected"
              valueColor={colors.teal}
              isLast
            />
          </SectionGroup>

          {/* Group 4 — AI Providers */}
          <SectionGroup>
            <SettingRow label="Provider" value="Anthropic" />
            <SettingRow label="Model" value="Claude Opus" isLast />
          </SectionGroup>

          {/* Group 5 — Newsletters */}
          <SectionGroup>
            <SettingRow label="Ingest Email" value="ingest@brett.app" isLast />
          </SectionGroup>

          {/* Group 6 — Timezone & Location */}
          <SectionGroup>
            <SettingRow label="Timezone" value="America/Denver" />
            <SettingRow label="Weather" value="Enabled" isLast />
          </SectionGroup>

          {/* Group 7 — App */}
          <SectionGroup>
            <SettingRow label="Import" value="›" />
            <SettingRow label="Updates" value="v1.0.0" isLast />
          </SectionGroup>

          {/* Group 8 — Account */}
          <SectionGroup>
            <SettingRow
              label="Sign Out"
              isDestructive
              isLast
              onPress={handleSignOut}
              accessibilityLabel="Sign out"
              accessibilityRole="button"
            />
          </SectionGroup>
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
  sectionCard: {
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border.subtle,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text.primary,
  },
  labelDestructive: {
    color: colors.red,
  },
  value: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.text.secondary,
    maxWidth: '60%',
    textAlign: 'right',
  },
});
