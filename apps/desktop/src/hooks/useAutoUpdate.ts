import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api/client";

declare global {
  interface Window {
    electronAPI?: {
      installUpdate: () => Promise<void>;
      getDownloadedUpdateVersion: () => Promise<string | null>;
      getUpdateTaskId: () => Promise<string | null>;
      setUpdateTaskId: (taskId: string | null) => Promise<void>;
      clearPendingUpdate: () => Promise<void>;
      getAutoInstallOnQuit: () => Promise<boolean>;
      setAutoInstallOnQuit: (enabled: boolean) => Promise<void>;
      onUpdateDownloaded: (callback: (version: string) => void) => () => void;
    };
  }
}

interface UseAutoUpdateReturn {
  updateReady: boolean;
  version: string | null;
  install: () => void;
}

export function useAutoUpdate(): UseAutoUpdateReturn {
  const [version, setVersion] = useState<string | null>(null);
  const api = window.electronAPI;

  // On mount: check if an update was already downloaded (survives renderer reloads)
  useEffect(() => {
    if (!api) return;

    api.getDownloadedUpdateVersion().then((v) => {
      if (v) {
        setVersion(v);
        ensureUpdateTask(v);
      } else {
        // No pending update — clean up any stale task from a previous update
        cleanupStaleTask();
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to new update downloads
  useEffect(() => {
    if (!api) return;

    const unsubscribe = api.onUpdateDownloaded((v) => {
      setVersion(v);
      ensureUpdateTask(v);
    });

    return unsubscribe;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function ensureUpdateTask(newVersion: string) {
    if (!api) return;

    try {
      const existingTaskId = await api.getUpdateTaskId();

      if (existingTaskId) {
        // Update existing task with new version
        try {
          await apiFetch(`/things/${existingTaskId}`, {
            method: "PATCH",
            body: JSON.stringify({ title: `Update Brett to v${newVersion}` }),
          });
          return;
        } catch {
          // Task may have been deleted — create a new one
        }
      }

      // Create new system task in Today
      const today = new Date().toISOString().split("T")[0] + "T00:00:00.000Z";
      const task = await apiFetch<{ id: string }>("/things", {
        method: "POST",
        body: JSON.stringify({
          type: "task",
          title: `Update Brett to v${newVersion}`,
          sourceId: "system:update",
          dueDate: today,
          dueDatePrecision: "day",
        }),
      });

      await api.setUpdateTaskId(task.id);
    } catch (err) {
      console.error("[AutoUpdate] Failed to create update task:", err);
    }
  }

  async function cleanupStaleTask() {
    if (!api) return;

    try {
      const taskId = await api.getUpdateTaskId();
      if (taskId) {
        await apiFetch(`/things/${taskId}`, { method: "DELETE" }).catch(() => {});
        await api.setUpdateTaskId(null);
        await api.clearPendingUpdate();
      }
    } catch {
      // Cleanup is best-effort
    }
  }

  const install = useCallback(() => {
    if (!api) return;
    api.installUpdate().catch((err) => {
      console.error("[AutoUpdate] Install failed:", err);
    });
  }, [api]);

  return {
    updateReady: version !== null,
    version,
    install,
  };
}
