import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withRepeat,
  withTiming,
  useAnimatedReaction,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Sun,
  Inbox,
  Mic,
  CalendarDays,
  Calendar,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { haptics } from '../theme/haptics';
import { colors, typography, spacing } from '../theme/tokens';
import { VoiceMode } from './VoiceMode';
import { ContextualDrawer } from './ContextualDrawer';
import { useReduceMotion } from '../hooks/use-reduce-motion';

// Tab config — order must match Tabs.Screen order in _layout
const TABS = [
  { name: 'today', label: 'Today', Icon: Sun },
  { name: 'inbox', label: 'Inbox', Icon: Inbox },
  { name: 'voice', label: 'Voice', Icon: Mic },
  { name: 'upcoming', label: 'Upcoming', Icon: CalendarDays },
  { name: 'calendar', label: 'Calendar', Icon: Calendar },
] as const;

const TAB_COUNT = TABS.length;
const VOICE_INDEX = 2;

// Approximate width per tab — the sliding dot uses this to compute translateX.
// We use a percentage-based approach driven by a shared value.
const VOICE_BUTTON_SIZE = 48;

const SCREEN_WIDTH = Dimensions.get('window').width;
const SCREEN_HEIGHT = Dimensions.get('window').height;

// Each non-voice tab has flex: 1. There are 4 non-voice tabs + 1 voice wrapper (flex: 1).
// All 5 slots share equal width = SCREEN_WIDTH / 5.
const TAB_SLOT_WIDTH = SCREEN_WIDTH / TAB_COUNT;

// Map from route tab index (0–4, including voice at 2) to the X center of the tab slot.
function tabSlotCenter(tabIndex: number): number {
  'worklet';
  return TAB_SLOT_WIDTH * tabIndex + TAB_SLOT_WIDTH / 2;
}

type DrawerTab = 'today' | 'inbox' | 'upcoming' | 'calendar';

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const activeIndex = useSharedValue(state.index);
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab | null>(null);

  // Sync shared value with React state
  useAnimatedReaction(
    () => state.index,
    (current) => {
      activeIndex.value = withSpring(current, {
        damping: 18,
        stiffness: 200,
        mass: 0.6,
      });
    },
  );

  // Ambient glow pulse for voice button — static when reduce motion is on
  const glowOpacity = useSharedValue(reduceMotion ? 0.1 : 0.05);
  React.useEffect(() => {
    if (reduceMotion) {
      glowOpacity.value = 0.1;
      return;
    }
    glowOpacity.value = withRepeat(
      withTiming(0.15, { duration: 4500 }),
      -1,
      true,
    );
  }, [reduceMotion]);

  // Inbox badge breathing — static when reduce motion is on
  const badgeOpacity = useSharedValue(reduceMotion ? 1 : 0.8);
  React.useEffect(() => {
    if (reduceMotion) {
      badgeOpacity.value = 1;
      return;
    }
    badgeOpacity.value = withRepeat(
      withTiming(1.0, { duration: 2000 }),
      -1,
      true,
    );
  }, [reduceMotion]);

  // Sliding dot X position — spring normally, fast timing when reduce motion is on
  const dotX = useSharedValue(tabSlotCenter(state.index));

  useAnimatedReaction(
    () => state.index,
    (current) => {
      if (reduceMotion) {
        dotX.value = withTiming(tabSlotCenter(current), { duration: 200 });
      } else {
        dotX.value = withSpring(tabSlotCenter(current), {
          damping: 15,
          stiffness: 200,
        });
      }
    },
  );

  const inboxCount = 0; // TODO: hook up to store

  const tabBarHeight = 54 + Math.max(insets.bottom, 8);

  return (
    <>
      {/* Voice mode overlay — covers full screen upward from tab bar */}
      <View
        style={[styles.overlayContainer, { height: SCREEN_HEIGHT + tabBarHeight }]}
        pointerEvents={voiceModeActive ? 'auto' : 'none'}
      >
        <VoiceMode
          visible={voiceModeActive}
          onDismiss={() => setVoiceModeActive(false)}
        />
      </View>

      {/* Contextual drawer overlay */}
      <View
        style={[styles.overlayContainer, { height: SCREEN_HEIGHT + tabBarHeight }]}
        pointerEvents={drawerTab !== null ? 'auto' : 'none'}
      >
        <ContextualDrawer
          tab={drawerTab ?? 'today'}
          visible={drawerTab !== null}
          onDismiss={() => setDrawerTab(null)}
          onNavigate={(route) => {
            setDrawerTab(null);
            router.push(route as never);
          }}
        />
      </View>

    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {/* Glass background */}
      <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.overlay]} />

      {/* Top border */}
      <View style={styles.topBorder} />

      {/* Tab row */}
      <View style={styles.row}>
        {TABS.map((tab, index) => {
          const isFocused = state.index === index;
          const isVoice = index === VOICE_INDEX;
          const descriptor = descriptors[state.routes[index]?.key ?? ''];
          const label = descriptor?.options?.title ?? tab.label;
          const { Icon } = tab;

          const iconColor = isFocused
            ? colors.gold
            : 'rgba(255,255,255,0.35)';
          const labelColor = isFocused
            ? colors.gold
            : 'rgba(255,255,255,0.35)';

          const onPress = () => {
            if (isVoice) {
              haptics.heavy();
              setVoiceModeActive(true);
              return;
            }
            const route = state.routes[index];
            if (!route) return;
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            if (isVoice) return;
            const tabName = tab.name as DrawerTab;
            haptics.rigid();
            setDrawerTab(tabName);
            const route = state.routes[index];
            if (!route) return;
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          if (isVoice) {
            return (
              <View key={tab.name} style={styles.voiceWrapper}>
                <VoiceButton
                  glowOpacity={glowOpacity}
                  onPress={onPress}
                />
              </View>
            );
          }

          return (
            <Pressable
              key={tab.name}
              style={styles.tab}
              onPress={onPress}
              onLongPress={onLongPress}
              accessibilityRole="tab"
              accessibilityLabel={`${label} tab`}
              accessibilityState={{ selected: isFocused }}
            >
              <View style={styles.iconWrapper}>
                <Icon size={22} color={iconColor} strokeWidth={isFocused ? 2.2 : 1.8} />
                {/* Inbox badge */}
                {tab.name === 'inbox' && inboxCount > 0 && (
                  <InboxBadge count={inboxCount} badgeOpacity={badgeOpacity} />
                )}
              </View>
              <Text style={[styles.label, { color: labelColor }]} maxFontSizeMultiplier={1.3}>{label}</Text>
              {/* Dot placeholder to maintain layout height — actual dot is rendered globally */}
              <View style={styles.dotPlaceholder} />
            </Pressable>
          );
        })}
      </View>

      {/* Single globally-positioned sliding dot */}
      <SlidingDot dotX={dotX} />
    </View>
    </>
  );
}

// ── Voice Button ─────────────────────────────────────────────────────────────

interface VoiceButtonProps {
  glowOpacity: SharedValue<number>;
  onPress: () => void;
}

function VoiceButton({ glowOpacity, onPress }: VoiceButtonProps) {
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  return (
    <Pressable
      style={styles.voiceButton}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Activate Brett voice mode"
      accessibilityHint="Double-tap to start listening"
    >
      {/* Ambient glow */}
      <Animated.View style={[styles.voiceGlow, glowStyle]} />
      {/* Gold gradient background */}
      <LinearGradient
        colors={['#f5d060', colors.gold, '#c8971a']}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={styles.voiceGradient}
      />
      <Mic size={22} color="#000" strokeWidth={2.2} />
    </Pressable>
  );
}

// ── Inbox Badge ───────────────────────────────────────────────────────────────

interface InboxBadgeProps {
  count: number;
  badgeOpacity: SharedValue<number>;
}

function InboxBadge({ count, badgeOpacity }: InboxBadgeProps) {
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badgeOpacity.value,
  }));

  return (
    <Animated.View style={[styles.badge, badgeStyle]}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </Animated.View>
  );
}

// ── Sliding Dot ───────────────────────────────────────────────────────────────
// A single absolutely-positioned dot that slides to the active tab's center.

interface SlidingDotProps {
  dotX: SharedValue<number>;
}

const DOT_SIZE = 4;

function SlidingDot({ dotX }: SlidingDotProps) {
  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dotX.value - DOT_SIZE / 2 }],
  }));

  return (
    <Animated.View style={[styles.dot, dotStyle]} />
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlayContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
  },
  overlay: {
    backgroundColor: 'rgba(0,0,0,0.50)',
  },
  topBorder: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingTop: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: spacing.xs,
    minHeight: 54,
    justifyContent: 'flex-start',
  },
  iconWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  label: {
    ...typography.tabLabel,
    marginBottom: 6,
  },
  // Placeholder to reserve vertical space occupied by the dot
  dotPlaceholder: {
    width: DOT_SIZE,
    height: DOT_SIZE,
  },
  // The single globally-positioned sliding dot
  dot: {
    position: 'absolute',
    bottom: spacing.xs + 4,
    left: 0,
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: colors.gold,
  },
  // Voice button
  voiceWrapper: {
    flex: 1,
    alignItems: 'center',
    paddingBottom: spacing.xs + 2,
    justifyContent: 'flex-end',
  },
  voiceButton: {
    width: VOICE_BUTTON_SIZE,
    height: VOICE_BUTTON_SIZE,
    borderRadius: VOICE_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
    // Elevation for iOS
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    // Android
    elevation: 8,
  },
  voiceGlow: {
    position: 'absolute',
    width: VOICE_BUTTON_SIZE + 24,
    height: VOICE_BUTTON_SIZE + 24,
    borderRadius: (VOICE_BUTTON_SIZE + 24) / 2,
    backgroundColor: colors.gold,
    top: -(12),
    left: -(12),
  },
  voiceGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: VOICE_BUTTON_SIZE / 2,
  },
  // Inbox badge
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 12,
  },
});
