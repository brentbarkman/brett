import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { haptics } from '../theme/haptics';
import { colors, radii } from '../theme/tokens';

interface OmnibarProps {
  placeholder?: string;
  onSubmit: (text: string) => void;
}

const GOLD = colors.gold;
const GOLD_BORDER_ACTIVE = 'rgba(232, 185, 49, 0.4)';
const BORDER_TRANSPARENT = 'rgba(232, 185, 49, 0)';

export function Omnibar({ placeholder = 'Add a task...', onSubmit }: OmnibarProps) {
  const [text, setText] = useState('');
  const borderOpacity = useSharedValue(0);

  const animatedBorderStyle = useAnimatedStyle(() => ({
    borderColor: borderOpacity.value === 0 ? BORDER_TRANSPARENT : GOLD_BORDER_ACTIVE,
  }));

  // Flash: transparent → gold → transparent in 300ms total
  const flashBorder = () => {
    borderOpacity.value = withSequence(
      withTiming(1, { duration: 100 }),
      withTiming(0, { duration: 200 }),
    );
  };

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText('');
    haptics.light();
    flashBorder();
  };

  return (
    <Animated.View style={[styles.container, animatedBorderStyle]}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor="rgba(255, 255, 255, 0.25)"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
        blurOnSubmit={false}
      />
      <View style={styles.goldDot} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radii.omnibar,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER_TRANSPARENT,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.85)',
    padding: 0,
    margin: 0,
  },
  goldDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
    marginLeft: 8,
  },
});
