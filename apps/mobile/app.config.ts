import type { ExpoConfig, ConfigContext } from "expo/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "Brett",
  slug: "brett",
  version: "1.0.0",
  orientation: "portrait",
  scheme: "brett",
  platforms: ["ios"],
  ios: {
    bundleIdentifier: "com.brett.app",
    buildNumber: "1",
    supportsTablet: true,
    infoPlist: {
      NSFaceIDUsageDescription: "Unlock Brett with Face ID",
      UIFileSharingEnabled: false,
      LSSupportsOpeningDocumentsInPlace: false,
    },
    entitlements: {
      "com.apple.security.application-groups": ["group.com.brett.app"],
      "aps-environment": "development",
    },
    config: {
      usesNonExemptEncryption: false,
    },
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "expo-local-authentication",
    "expo-apple-authentication",
    "expo-sqlite",
    ["expo-notifications", { color: "#E8B931" }],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001",
  },
});
