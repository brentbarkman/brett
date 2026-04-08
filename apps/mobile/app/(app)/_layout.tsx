import { useEffect } from "react";
import { Stack } from "expo-router";
import { registerForPushNotifications } from "../../src/notifications/registration";

export default function AppLayout() {
  useEffect(() => {
    registerForPushNotifications();
  }, []);
  return <Stack screenOptions={{ headerShown: false }} />;
}
