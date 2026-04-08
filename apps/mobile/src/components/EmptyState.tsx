import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme/tokens';

export type EmptyStateVariant =
  | 'all-done'
  | 'inbox-empty'
  | 'inbox-cleared'
  | 'upcoming-empty'
  | 'list-empty'
  | 'scouts-empty'
  | 'no-events';

interface EmptyStateProps {
  variant: EmptyStateVariant;
}

interface EmptyStateCopy {
  heading: string;
  body: string;
}

const COPY: Record<EmptyStateVariant, EmptyStateCopy> = {
  'all-done': {
    heading: 'Cleared.',
    body: 'Nothing left. Go build something or enjoy the quiet.',
  },
  'inbox-empty': {
    heading: 'Your inbox',
    body: 'Everything worth doing starts here.',
  },
  'inbox-cleared': {
    heading: 'Cleared.',
    body: 'Nothing left. Go build something or enjoy the quiet.',
  },
  'upcoming-empty': {
    heading: 'Wide open',
    body: "Nothing scheduled ahead. That's either zen or an oversight.",
  },
  'list-empty': {
    heading: 'No tasks yet',
    body: 'Add one, or enjoy the emptiness.',
  },
  'scouts-empty': {
    heading: 'No scouts yet',
    body: 'Scouts monitor the internet for you. Create one to get started.',
  },
  'no-events': {
    heading: 'Nothing on the books today.',
    body: 'A rare opening — use it well.',
  },
};

export function EmptyState({ variant }: EmptyStateProps) {
  const { heading, body } = COPY[variant];

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{heading}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxxl,
    paddingVertical: 80,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.text.secondary,
    lineHeight: 22,
    textAlign: 'center',
  },
});
