import { View, Text, Pressable } from "react-native";
import { createTask } from "@brett/business";
import { formatDate } from "@brett/utils";
import type { Task } from "@brett/types";

export default function HomeScreen() {
  const task: Task = createTask("Hello from Mobile", "user-1");

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 20 }}>
      <Text style={{ fontSize: 24, fontWeight: "bold" }}>
        Brett Productivity - Mobile
      </Text>
      <Text style={{ marginTop: 12 }}>Task: {task.title}</Text>
      <Text>Created: {formatDate(task.createdAt)}</Text>
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
