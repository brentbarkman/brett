import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme/tokens';

type SectionHeaderVariant = 'default' | 'overdue' | 'gold' | 'done';

interface SectionHeaderProps {
  label: string;
  variant?: SectionHeaderVariant;
}

const LABEL_COLOR: Record<SectionHeaderVariant, string> = {
  default: colors.text.tertiary,
  overdue: 'rgba(230, 85, 75, 0.6)',
  gold: 'rgba(232, 185, 49, 0.5)',
  done: 'rgba(255, 255, 255, 0.15)',
};

export function SectionHeader({ label, variant = 'default' }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: LABEL_COLOR[variant] }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  label: {
    ...typography.sectionLabel,
  },
});
