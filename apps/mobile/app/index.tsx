import { View, Text, Pressable } from "react-native";

export default function HomeScreen() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
      <Text style={{ fontSize: 24, fontWeight: "bold" }}>
        Brett Productivity - Mobile
      </Text>
      <Pressable
        style={{
          marginTop: 20,
          backgroundColor: "#007AFF",
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: "white", fontWeight: "600" }}>Get Started</Text>
      </Pressable>
    </View>
  );
}
