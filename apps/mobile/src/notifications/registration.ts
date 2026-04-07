import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiRequest } from "../api/client";

export async function registerForPushNotifications(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return null;

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: Constants.expoConfig?.extra?.eas?.projectId,
  });
  const pushToken = tokenData.data;

  try {
    await apiRequest("/devices/register", {
      method: "POST",
      body: JSON.stringify({
        token: pushToken,
        platform: Platform.OS,
        appVersion: Constants.expoConfig?.version ?? "1.0.0",
      }),
    });
  } catch (err) {
    console.warn("Failed to register push token:", err);
  }

  return pushToken;
}
