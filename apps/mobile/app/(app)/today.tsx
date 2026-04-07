import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Button,
  Pressable,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Alert,
} from "react-native";
import { useAuth } from "../../src/auth/provider";
import { useItems } from "../../src/hooks/use-items";
import { useLists } from "../../src/hooks/use-lists";
import { useSync } from "../../src/hooks/use-sync";
import { useSyncStore } from "../../src/store/sync";
import { initializeStores } from "../../src/store";
import { initSync, sync } from "../../src/sync/sync-manager";
import type { ItemRow } from "../../src/store/items";

export default function TodayScreen() {
  const { userId, signOut } = useAuth();
  const { todayItems, items, createItem, toggleItem } = useItems();
  const { navLists } = useLists();
  const {
    isSyncing,
    pendingMutationCount,
    deadMutationCount,
    lastSuccessfulPullAt,
    lastError,
    consecutiveFailures,
    triggerSync,
  } = useSync();
  const lastSuccessfulPushAt = useSyncStore((s) => s.lastSuccessfulPushAt);

  const [newTitle, setNewTitle] = useState("");
  const [ready, setReady] = useState(false);
  const initRef = useRef(false);

  // Initialize stores and sync on mount
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    try {
      initializeStores();
      initSync();
      setReady(true);
      // Kick off initial sync
      sync().catch(() => {
        // Errors are recorded in sync health, not thrown to the user here
      });
    } catch (err) {
      console.error("Initialization failed:", err);
    }
  }, []);

  const handleAdd = useCallback(() => {
    const title = newTitle.trim();
    if (!title) return;
    createItem({ type: "task", title });
    setNewTitle("");
  }, [newTitle, createItem]);

  const handleToggle = useCallback(
    (id: string) => {
      toggleItem(id);
    },
    [toggleItem],
  );

  const handleSignOut = useCallback(() => {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => signOut() },
    ]);
  }, [signOut]);

  const handleRefresh = useCallback(async () => {
    await triggerSync();
  }, [triggerSync]);

  // Sync status label
  const syncLabel = isSyncing
    ? "syncing..."
    : lastError
      ? "error"
      : "synced";

  const renderItem = useCallback(
    ({ item }: { item: ItemRow }) => {
      const isDone = item.status === "done";
      return (
        <Pressable
          style={styles.itemRow}
          onPress={() => handleToggle(item.id)}
        >
          <Text style={styles.checkbox}>{isDone ? "[x]" : "[ ]"}</Text>
          <Text
            style={[styles.itemTitle, isDone && styles.itemTitleDone]}
            numberOfLines={1}
          >
            {item.title}
          </Text>
        </Pressable>
      );
    },
    [handleToggle],
  );

  if (!ready) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.loadingText}>Initializing...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Today</Text>
        <Button title="Sign Out" onPress={handleSignOut} />
      </View>

      {/* Sync Status Bar */}
      <View style={styles.syncBar}>
        <Text style={styles.syncText}>
          Sync: {syncLabel}
          {pendingMutationCount > 0 && ` | ${pendingMutationCount} pending`}
        </Text>
      </View>

      {/* Task List */}
      <FlatList
        data={todayItems}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={isSyncing} onRefresh={handleRefresh} />
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No items yet. Add one below.</Text>
        }
      />

      {/* Quick Add */}
      <View style={styles.quickAdd}>
        <TextInput
          style={styles.input}
          placeholder="Add a task..."
          placeholderTextColor="#888"
          value={newTitle}
          onChangeText={setNewTitle}
          onSubmitEditing={handleAdd}
          returnKeyType="done"
        />
        <Button title="Add" onPress={handleAdd} />
      </View>

      {/* Debug Panel */}
      <View style={styles.debugPanel}>
        <Text style={styles.debugTitle}>Debug</Text>
        <Text style={styles.debugLine}>User ID: {userId ?? "none"}</Text>
        <Text style={styles.debugLine}>Items in store: {items.size}</Text>
        <Text style={styles.debugLine}>Lists: {navLists.length}</Text>
        <Text style={styles.debugLine}>
          Pending mutations: {pendingMutationCount}
        </Text>
        <Text style={styles.debugLine}>
          Dead mutations: {deadMutationCount}
        </Text>
        <Text style={styles.debugLine}>
          Last push: {lastSuccessfulPushAt ?? "never"}
        </Text>
        <Text style={styles.debugLine}>
          Last pull: {lastSuccessfulPullAt ?? "never"}
        </Text>
        <Text style={styles.debugLine}>
          Consecutive failures: {consecutiveFailures}
        </Text>
        <Text style={styles.debugLine}>
          Last error: {lastError ?? "none"}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  loadingText: {
    color: "#fff",
    fontSize: 16,
    textAlign: "center",
    marginTop: 100,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "bold",
  },
  syncBar: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#111",
  },
  syncText: {
    color: "#aaa",
    fontSize: 13,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  checkbox: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "monospace",
    marginRight: 10,
  },
  itemTitle: {
    color: "#fff",
    fontSize: 16,
    flex: 1,
  },
  itemTitleDone: {
    textDecorationLine: "line-through",
    color: "#666",
  },
  emptyText: {
    color: "#666",
    fontSize: 14,
    textAlign: "center",
    marginTop: 40,
  },
  quickAdd: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#333",
    gap: 8,
  },
  input: {
    flex: 1,
    color: "#fff",
    fontSize: 16,
    backgroundColor: "#111",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#333",
  },
  debugPanel: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#0a0a0a",
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  debugTitle: {
    color: "#ff0",
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 4,
  },
  debugLine: {
    color: "#888",
    fontSize: 12,
    fontFamily: "monospace",
    lineHeight: 18,
  },
});
