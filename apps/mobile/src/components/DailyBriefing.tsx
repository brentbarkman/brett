import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radii } from '../theme/tokens';

interface DailyBriefingProps {
  content: string;
  generatedAt: string;
  isCollapsed: boolean;
  isDismissed: boolean;
  toggleCollapse: () => void;
  dismiss: () => void;
}

/** Parse **bold** markers: odd-indexed segments after splitting on ** are bold */
function parseBoldContent(text: string): React.ReactNode[] {
  const segments = text.split('**');
  return segments.map((segment, index) => {
    const isBold = index % 2 === 1;
    return (
      <Text
        key={index}
        style={isBold ? styles.boldText : styles.bodyText}
      >
        {segment}
      </Text>
    );
  });
}

/** Format an ISO timestamp to HH:MM */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function DailyBriefing({
  content,
  generatedAt,
  isCollapsed,
  isDismissed,
  toggleCollapse,
  dismiss,
}: DailyBriefingProps) {
  if (isDismissed) return null;

  return (
    <View style={styles.wrapper}>
      {/* Header row */}
      <Pressable style={styles.header} onPress={toggleCollapse}>
        <Text style={styles.label}>
          Daily Briefing{isCollapsed ? ' ▸' : ''}
        </Text>
        <Pressable onPress={dismiss} hitSlop={8} style={styles.dismissButton}>
          <Text style={styles.dismissIcon}>✕</Text>
        </Pressable>
      </Pressable>

      {/* Collapsible content */}
      {!isCollapsed && (
        <>
          <Text style={styles.body}>
            {parseBoldContent(content)}
          </Text>
          <Text style={styles.timestamp}>
            Generated at {formatTime(generatedAt)}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'rgba(70, 130, 195, 0.06)',
    borderColor: 'rgba(70, 130, 195, 0.12)',
    borderWidth: 1,
    borderRadius: radii.omnibar,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: 'rgba(70, 130, 195, 0.5)',
  },
  dismissButton: {
    padding: 2,
  },
  dismissIcon: {
    fontSize: 11,
    color: 'rgba(70, 130, 195, 0.4)',
  },
  body: {
    fontSize: 12,
    lineHeight: 20,
    color: 'rgba(255, 255, 255, 0.55)',
    marginTop: 8,
  },
  bodyText: {
    fontSize: 12,
    lineHeight: 20,
    color: 'rgba(255, 255, 255, 0.55)',
  },
  boldText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.75)',
  },
  timestamp: {
    fontSize: 10,
    color: 'rgba(70, 130, 195, 0.3)',
    marginTop: 8,
  },
});
