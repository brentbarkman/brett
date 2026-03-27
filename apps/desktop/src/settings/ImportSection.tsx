import React, { useState } from "react";
import { Download, Check, Loader2, AlertCircle } from "lucide-react";
import type { Things3ScanResult, Things3ImportResult } from "@brett/types";

const electronAPI = (window as any).electronAPI as
  | {
      platform: string;
      things3Scan: () => Promise<Things3ScanResult | { error: string }>;
      things3Import: () => Promise<Things3ImportResult | { error: string }>;
    }
  | undefined;

type ImportState =
  | { step: "idle" }
  | { step: "scanning" }
  | { step: "preview"; scan: Things3ScanResult }
  | { step: "importing" }
  | { step: "done"; result: Things3ImportResult; importedAt: string }
  | { step: "error"; message: string };

const STORAGE_KEY = "things3-import-completed";

function getStoredImport(userId: string): { importedAt: string; result: Things3ImportResult } | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}-${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeImportCompletion(userId: string, result: Things3ImportResult): string {
  const importedAt = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  localStorage.setItem(
    `${STORAGE_KEY}-${userId}`,
    JSON.stringify({ importedAt, result })
  );
  return importedAt;
}

export function ImportSection({ userId }: { userId: string }) {
  const [state, setState] = useState<ImportState>(() => {
    const stored = getStoredImport(userId);
    return stored
      ? { step: "done", result: stored.result, importedAt: stored.importedAt }
      : { step: "idle" };
  });

  // Only show on macOS in Electron
  if (!electronAPI || electronAPI.platform !== "darwin") return null;

  async function handleScan() {
    setState({ step: "scanning" });
    const result = await electronAPI!.things3Scan();
    if ("error" in result) {
      setState({ step: "error", message: result.error });
    } else {
      setState({ step: "preview", scan: result });
    }
  }

  async function handleImport() {
    setState({ step: "importing" });
    try {
      const result = await electronAPI!.things3Import();
      if ("error" in result) {
        setState({ step: "error", message: result.error });
      } else {
        const importedAt = storeImportCompletion(userId, result);
        setState({ step: "done", result, importedAt });
      }
    } catch (err: any) {
      setState({ step: "error", message: err.message || "Import failed" });
    }
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Import</h2>
          <p className="text-sm text-white/50">Import your tasks from other apps</p>
        </div>
      </div>

      {state.step === "idle" && (
        <button
          onClick={handleScan}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm transition-colors"
        >
          <Download size={16} />
          Import from Things 3
        </button>
      )}

      {state.step === "scanning" && (
        <div className="flex items-center gap-2 text-white/50 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Scanning Things 3...
        </div>
      )}

      {state.step === "preview" && (
        <div className="space-y-3">
          <div className="bg-white/5 rounded-lg p-4 text-sm text-white/70">
            {state.scan.projects === 0 && state.scan.tasks.active === 0 && state.scan.tasks.completed === 0 ? (
              "No tasks found in Things 3."
            ) : (
              <>
                Found <span className="text-white font-medium">{state.scan.projects}</span> project{state.scan.projects !== 1 ? "s" : ""}{" "}
                and <span className="text-white font-medium">{state.scan.tasks.active + state.scan.tasks.completed}</span> task{state.scan.tasks.active + state.scan.tasks.completed !== 1 ? "s" : ""}{" "}
                ({state.scan.tasks.active} active, {state.scan.tasks.completed} completed)
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {(state.scan.projects > 0 || state.scan.tasks.active > 0 || state.scan.tasks.completed > 0) && (
              <button
                onClick={handleImport}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-sm font-medium transition-colors"
              >
                <Download size={16} />
                Import
              </button>
            )}
            <button
              onClick={() => setState({ step: "idle" })}
              className="px-4 py-2 rounded-lg text-white/50 hover:text-white/70 text-sm transition-colors"
            >
              {state.scan.projects === 0 && state.scan.tasks.active === 0 && state.scan.tasks.completed === 0 ? "OK" : "Cancel"}
            </button>
          </div>
        </div>
      )}

      {state.step === "importing" && (
        <div className="flex items-center gap-2 text-white/50 text-sm">
          <Loader2 size={16} className="animate-spin" />
          Importing...
        </div>
      )}

      {state.step === "done" && (
        <div className="flex items-center gap-2 text-green-400/80 text-sm">
          <Check size={16} />
          Imported {state.result.lists} list{state.result.lists !== 1 ? "s" : ""} and{" "}
          {state.result.tasks} task{state.result.tasks !== 1 ? "s" : ""} from Things 3 on{" "}
          {state.importedAt}
        </div>
      )}

      {state.step === "error" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-red-400/80 text-sm">
            <AlertCircle size={16} />
            {state.message}
          </div>
          <button
            onClick={() => setState({ step: "idle" })}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white text-sm transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
