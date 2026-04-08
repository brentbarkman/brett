import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="task/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="list/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="scouts/index" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="scouts/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="content/[id]" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
