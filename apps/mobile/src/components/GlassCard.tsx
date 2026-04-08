import React, { ReactNode } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, radii } from '../theme/tokens';

type GlassVariant = 'primary' | 'light' | 'elevated' | 'heavy';

interface GlassCardProps {
  children: ReactNode;
  variant?: GlassVariant;
  style?: ViewStyle;
}

const BLUR_INTENSITY: Record<GlassVariant, number> = {
  primary: 40,
  light: 30,
  elevated: 50,
  heavy: 60,
};

const OVERLAY_COLOR: Record<GlassVariant, string> = {
  primary: 'rgba(0,0,0,0.3)',
  light: 'rgba(0,0,0,0.2)',
  elevated: 'rgba(0,0,0,0.4)',
  heavy: 'rgba(0,0,0,0.5)',
};

export function GlassCard({ children, variant = 'primary', style }: GlassCardProps) {
  return (
    <View style={[styles.container, style]}>
      <BlurView
        intensity={BLUR_INTENSITY[variant]}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: OVERLAY_COLOR[variant] }]}
      />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  content: {
    position: 'relative',
  },
});
