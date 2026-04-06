import React, { useState, useEffect } from "react";
import { useAutoUpdate } from "../hooks/useAutoUpdate";
import { Download, Check } from "lucide-react";

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
      {/* Current version */}
      <div className="bg-white/5 rounded-xl border border-white/10 p-5">
        <h3 className="text-sm font-medium text-white mb-3">Version</h3>
        <p className="text-sm text-white/60">
          Brett v{currentVersion}
        </p>
      </div>

      {/* Pending update */}
      {updateReady && (
        <div className="bg-white/5 rounded-xl border border-white/10 p-5">
          <h3 className="text-sm font-medium text-white mb-3">Update Available</h3>
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
        </div>
      )}

      {!updateReady && (
        <div className="bg-white/5 rounded-xl border border-white/10 p-5">
          <div className="flex items-center gap-2">
            <Check size={14} className="text-emerald-400" />
            <p className="text-sm text-white/60">You're up to date.</p>
          </div>
        </div>
      )}

      {/* Auto-install setting */}
      <div className="bg-white/5 rounded-xl border border-white/10 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-white">Auto-install on quit</h3>
            <p className="text-xs text-white/40 mt-1">
              Automatically install downloaded updates when you quit Brett.
            </p>
          </div>
          <button
            onClick={handleToggle}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              autoInstall ? "bg-brett-gold" : "bg-white/20"
            }`}
          >
            <div
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                autoInstall ? "translate-x-5" : ""
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
