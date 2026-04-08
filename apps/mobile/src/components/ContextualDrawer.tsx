import React, { useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Settings, ChevronRight } from 'lucide-react-native';
import { haptics } from '../theme/haptics';
import { colors, typography, spacing, radii } from '../theme/tokens';
import { useMockLists } from '../mock/hooks';

// ── Helpers ───────────────────────────────────────────────────────────────────

const COLOR_CLASS_MAP: Record<string, string> = {
  'bg-blue-500': '#3B82F6',
  'bg-amber-500': '#F59E0B',
  'bg-emerald-500': '#10B981',
  'bg-purple-500': '#8B5CF6',
  'bg-red-500': '#EF4444',
  'bg-pink-500': '#EC4899',
  'bg-indigo-500': '#6366F1',
  'bg-teal-500': '#14B8A6',
};

function colorClassToHex(colorClass: string): string {
  return COLOR_CLASS_MAP[colorClass] ?? colors.cerulean;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContextualDrawerProps {
  tab: 'today' | 'inbox' | 'upcoming' | 'calendar';
  visible: boolean;
  onDismiss: () => void;
  onNavigate: (route: string) => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.45;

// ── DrawerRow ─────────────────────────────────────────────────────────────────

interface DrawerRowProps {
  label: string;
  onPress: () => void;
  left?: React.ReactNode;
  showChevron?: boolean;
}

function DrawerRow({ label, onPress, left, showChevron = true }: DrawerRowProps) {
  const handlePress = () => {
    haptics.light();
    onPress();
  };

  return (
    <Pressable onPress={handlePress} style={styles.row}>
      {left && <View style={styles.rowLeft}>{left}</View>}
      <Text style={styles.rowLabel}>{label}</Text>
      {showChevron && (
        <ChevronRight size={16} color={colors.text.tertiary} strokeWidth={1.8} />
      )}
    </Pressable>
  );
}

// ── Tab Content ───────────────────────────────────────────────────────────────

function TodayContent({ onNavigate }: { onNavigate: (route: string) => void }) {
  return (
    <DrawerRow
      label="Scouts"
      onPress={() => onNavigate('/scouts')}
    />
  );
}

function UpcomingContent({ onNavigate }: { onNavigate: (route: string) => void }) {
  const { navLists } = useMockLists();

  return (
    <>
      {navLists.map((list) => (
        <DrawerRow
          key={list.id}
          label={`${list.name}  ${list.count}`}
          onPress={() => onNavigate(`/list/${list.id}`)}
          left={
            <View style={[styles.listDot, { backgroundColor: colorClassToHex(list.colorClass) }]} />
          }
        />
      ))}
    </>
  );
}

function CalendarContent({ onNavigate }: { onNavigate: (route: string) => void }) {
  return (
    <DrawerRow
      label="Calendar Settings"
      onPress={() => onNavigate('/settings#calendar')}
    />
  );
}

// ── ContextualDrawer ──────────────────────────────────────────────────────────

export function ContextualDrawer({
  tab,
  visible,
  onDismiss,
  onNavigate,
}: ContextualDrawerProps) {
  const translateY = useSharedValue(SHEET_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      backdropOpacity.value = withTiming(1, { duration: 200 });
      translateY.value = withSpring(0, {
        damping: 22,
        stiffness: 280,
        mass: 0.8,
      });
    } else {
      backdropOpacity.value = withTiming(0, { duration: 200 });
      translateY.value = withSpring(SHEET_HEIGHT, {
        damping: 22,
        stiffness: 280,
        mass: 0.8,
      });
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const handleNavigate = (route: string) => {
    onDismiss();
    onNavigate(route);
  };

  const handleSettingsPress = () => {
    onDismiss();
    onNavigate('/settings');
  };

  return (
    <>
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents={visible ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View style={[styles.sheet, sheetStyle]} pointerEvents={visible ? 'auto' : 'none'}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, styles.sheetOverlay]} />

        {/* Grab handle */}
        <View style={styles.handleContainer}>
          <View style={styles.handle} />
        </View>

        {/* Tab-specific content */}
        {tab === 'today' && <TodayContent onNavigate={handleNavigate} />}
        {tab === 'upcoming' && <UpcomingContent onNavigate={handleNavigate} />}
        {tab === 'calendar' && <CalendarContent onNavigate={handleNavigate} />}

        {/* Always: Settings row */}
        <DrawerRow
          label="Settings"
          onPress={handleSettingsPress}
          left={<Settings size={16} color={colors.text.secondary} strokeWidth={1.8} />}
        />
      </Animated.View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    overflow: 'hidden',
  },
  sheetOverlay: {
    backgroundColor: 'rgba(18,18,18,0.7)',
  },
  handleContainer: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.subtle,
  },
  rowLeft: {
    marginRight: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    ...typography.body,
    color: colors.text.primary,
    flex: 1,
  },
  listDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
