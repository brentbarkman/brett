import * as Haptics from "expo-haptics";

export const haptics = {
  completion: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  rigid: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid),
  error: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
} as const;
