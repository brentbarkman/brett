import React, { useState, useEffect } from "react";
import { useAutoUpdate } from "../hooks/useAutoUpdate";
import { Download, Check } from "lucide-react";
import { SettingsCard, SettingsHeader, SettingsToggle } from "./SettingsComponents";

export function UpdatesSection() {
  const { updateReady, version, install } = useAutoUpdate();
  const [autoInstall, setAutoInstall] = useState(true);
  const api = window.electronAPI;

  useEffect(() => {
    api?.getAutoInstallOnQuit().then(setAutoInstall);
  }, [api]);

  const handleToggle = () => {
    const next = !autoInstall;
    setAutoInstall(next);
    api?.setAutoInstallOnQuit(next);
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
          <div className="flex items-center gap-2">
            <Check size={14} className="text-emerald-400" />
            <p className="text-sm text-white/60">You're up to date.</p>
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
