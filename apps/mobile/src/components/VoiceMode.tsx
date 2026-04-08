import React, { useEffect } from 'react';
import { Text, Pressable, StyleSheet, Dimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, typography } from '../theme/tokens';

interface VoiceModeProps {
  visible: boolean;
  onDismiss: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Waveform Bar ──────────────────────────────────────────────────────────────

interface WaveBarProps {
  delay: number;
  height: number;
  opacity: number;
}

function WaveBar({ delay, height, opacity: baseOpacity }: WaveBarProps) {
  const scale = useSharedValue(0.4);
  const opacity = useSharedValue(baseOpacity * 0.5);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.0, { duration: 800 + delay * 100 }),
      -1,
      true,
    );
    opacity.value = withRepeat(
      withTiming(baseOpacity, { duration: 600 + delay * 80 }),
      -1,
      true,
    );
  }, []);

  const barStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.waveBar,
        { height, backgroundColor: colors.gold },
        barStyle,
      ]}
    />
  );
}

// ── Wave Bars Config ──────────────────────────────────────────────────────────

const WAVE_BARS = [
  { delay: 0, height: 20, opacity: 0.4 },
  { delay: 1, height: 40, opacity: 0.7 },
  { delay: 2, height: 60, opacity: 1.0 },
  { delay: 3, height: 40, opacity: 0.7 },
  { delay: 4, height: 20, opacity: 0.4 },
  { delay: 1, height: 50, opacity: 0.8 },
  { delay: 3, height: 30, opacity: 0.5 },
];

// ── VoiceMode ─────────────────────────────────────────────────────────────────

export function VoiceMode({ visible, onDismiss }: VoiceModeProps) {
  const overlayOpacity = useSharedValue(0);

  useEffect(() => {
    overlayOpacity.value = withTiming(visible ? 1 : 0, { duration: 200 });
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
    pointerEvents: overlayOpacity.value > 0 ? 'auto' : 'none',
  }));

  if (!visible && overlayOpacity.value === 0) {
    // Still render but invisible so animation can play on dismiss
  }

  return (
    <Animated.View style={[styles.overlay, overlayStyle]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss}>
        <Animated.View style={styles.content} pointerEvents="none">
          {/* Waveform visualization */}
          <Animated.View style={styles.waveform}>
            {WAVE_BARS.map((bar, i) => (
              <WaveBar key={i} delay={bar.delay} height={bar.height} opacity={bar.opacity} />
            ))}
          </Animated.View>

          {/* Listening label */}
          <Text style={styles.listeningText}>Listening...</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 80,
  },
  waveBar: {
    width: 4,
    borderRadius: 2,
  },
  listeningText: {
    ...typography.body,
    color: colors.text.secondary,
    marginTop: 20,
  },
});
