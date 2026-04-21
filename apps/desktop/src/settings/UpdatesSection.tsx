import React, { useState, useEffect } from "react";
import { useAutoUpdate } from "../hooks/useAutoUpdate";
import { Download, Check, RefreshCw, AlertCircle } from "lucide-react";
import { SettingsCard, SettingsHeader, SettingsToggle } from "./SettingsComponents";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "update-available"; version: string }
  | { kind: "error"; message: string };

export function UpdatesSection() {
  const { updateReady, version, install } = useAutoUpdate();
  const [autoInstall, setAutoInstall] = useState(true);
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const api = window.electronAPI;

  useEffect(() => {
    api?.getAutoInstallOnQuit().then(setAutoInstall);
  }, [api]);

  const handleToggle = () => {
    const next = !autoInstall;
    setAutoInstall(next);
    api?.setAutoInstallOnQuit(next);
  };

  const handleCheck = async () => {
    if (!api || check.kind === "checking") return;
    setCheck({ kind: "checking" });
    try {
      const res = await api.checkForUpdates();
      if (res.status === "update-available") {
        setCheck({ kind: "update-available", version: res.version });
      } else if (res.status === "up-to-date") {
        setCheck({ kind: "up-to-date" });
      } else {
        setCheck({ kind: "error", message: res.message });
      }
    } catch (err: any) {
      setCheck({ kind: "error", message: err?.message || "Check failed" });
    }
  };

  const currentVersion = __APP_VERSION__;

  return (
    <div className="space-y-5">
      <SettingsCard>
        <SettingsHeader>Version</SettingsHeader>
        <p className="text-sm text-white/60">Brett v{currentVersion}</p>
      </SettingsCard>

      {updateReady ? (
        <SettingsCard>
          <SettingsHeader>Update Available</SettingsHeader>
          <p className="text-sm text-white/60 mb-4">
            Version {version} is ready to install. Brett will restart to apply the update.
          </p>
          <button
            onClick={install}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-brett-gold/15 text-brett-gold hover:bg-brett-gold/25 transition-colors"
          >
            <Download size={14} />
            Install &amp; Restart
          </button>
        </SettingsCard>
      ) : (
        <SettingsCard>
          <div className="flex items-center justify-between gap-4">
            <CheckStatus state={check} />
            <button
              onClick={handleCheck}
              disabled={check.kind === "checking"}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-white/80 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={12} className={check.kind === "checking" ? "animate-spin" : ""} />
              {check.kind === "checking" ? "Checking…" : "Check now"}
            </button>
          </div>
        </SettingsCard>
      )}

      <SettingsCard>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-white">Auto-install on quit</h3>
            <p className="text-xs text-white/40 mt-1">
              Automatically install downloaded updates when you quit Brett.
            </p>
          </div>
          <SettingsToggle checked={autoInstall} onChange={handleToggle} />
        </div>
      </SettingsCard>
    </div>
  );
}

function CheckStatus({ state }: { state: CheckState }) {
  if (state.kind === "checking") {
    return <p className="text-sm text-white/60">Checking for updates…</p>;
  }
  if (state.kind === "update-available") {
    return (
      <div className="flex items-center gap-2">
        <Download size={14} className="text-brett-gold" />
        <p className="text-sm text-white/80">Version {state.version} found — downloading…</p>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="flex items-center gap-2">
        <AlertCircle size={14} className="text-red-400" />
        <p className="text-sm text-red-300/80">{state.message}</p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Check size={14} className="text-emerald-400" />
      <p className="text-sm text-white/60">You're up to date.</p>
    </div>
  );
}
