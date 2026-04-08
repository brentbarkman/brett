import React, { useEffect } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useReduceMotion } from '../hooks/use-reduce-motion';

interface MorningRitualProps {
  enabled: boolean;
  children: React.ReactNode;
}

const STAGGER_DELAYS = [0, 200, 400, 600, 750];

function AnimatedChild({
  child,
  index,
  reduceMotion,
}: {
  child: React.ReactNode;
  index: number;
  reduceMotion: boolean;
}) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(reduceMotion ? 0 : 20);

  useEffect(() => {
    const delay = STAGGER_DELAYS[index] ?? (index * 150);
    if (reduceMotion) {
      opacity.value = withDelay(delay, withTiming(1, { duration: 300 }));
    } else {
      opacity.value = withDelay(delay, withSpring(1, { damping: 20, stiffness: 200, mass: 0.8 }));
      translateY.value = withDelay(delay, withSpring(0, { damping: 20, stiffness: 200, mass: 0.8 }));
    }
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={animStyle}>{child}</Animated.View>;
}

export function MorningRitual({ enabled, children }: MorningRitualProps) {
  const reduceMotion = useReduceMotion();

  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <>
      {React.Children.map(children, (child, index) => (
        <AnimatedChild
          key={index}
          child={child}
          index={index}
          reduceMotion={reduceMotion}
        />
      ))}
    </>
  );
}
