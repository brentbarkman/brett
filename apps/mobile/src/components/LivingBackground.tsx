import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

type TimeSegment = 'dawn' | 'morning' | 'afternoon' | 'golden_hour' | 'evening' | 'night';

const SEGMENT_GRADIENTS: Record<TimeSegment, [string, string, string]> = {
  dawn: ['#1a0a2e', '#2d1b4e', '#4a2c6e'],
  morning: ['#0c1220', '#1a2840', '#2a4060'],
  afternoon: ['#0f1a2e', '#1e3050', '#2e4668'],
  golden_hour: ['#1a1005', '#2e1f0a', '#4a3010'],
  evening: ['#0a0e1a', '#141e30', '#1c2a42'],
  night: ['#050508', '#0a0c14', '#0f1220'],
};

function getSegment(hour: number): TimeSegment {
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 19) return 'golden_hour';
  if (hour >= 19 && hour < 21) return 'evening';
  return 'night';
}

export function LivingBackground() {
  const colors = useMemo(() => {
    const hour = new Date().getHours();
    const segment = getSegment(hour);
    return SEGMENT_GRADIENTS[segment];
  }, []);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Base gradient */}
      <LinearGradient
        colors={colors}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Top vignette */}
      <LinearGradient
        colors={['rgba(0,0,0,0.5)', 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.topVignette}
      />
      {/* Bottom vignette */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.6)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={styles.bottomVignette}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topVignette: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  bottomVignette: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '70%',
  },
});
