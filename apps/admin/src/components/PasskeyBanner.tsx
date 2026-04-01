import React, { useState } from "react";
import { usePasskeys, useRegisterPasskey } from "../api/passkeys";
import { KeyRound, X } from "lucide-react";

export function PasskeyBanner() {
  const { data: passkeys, isLoading } = usePasskeys();
  const register = useRegisterPasskey();
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Don't show if loading, has passkeys, or dismissed
  if (isLoading || (passkeys && passkeys.length > 0) || dismissed) return null;

  async function handleRegister() {
    setError(null);
    try {
      await register.mutateAsync();
    } catch (err: any) {
      setError(err.message || "Failed to register passkey");
    }
  }

  return (
    <div className="relative rounded-xl border border-blue-500/20 bg-blue-500/10 p-4 flex items-center gap-4">
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
        <KeyRound size={20} className="text-blue-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">Set up a passkey for faster sign-in</p>
        <p className="text-xs text-white/50 mt-0.5">
          Use Touch ID or a security key — no password needed.
        </p>
        {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      </div>
      <button
        onClick={handleRegister}
        disabled={register.isPending}
        className="flex-shrink-0 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-400 transition-colors disabled:opacity-30"
      >
        {register.isPending ? "Registering..." : "Register Passkey"}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 p-1 text-white/30 hover:text-white/60 transition-colors"
        title="Dismiss"
      >
        <X size={16} />
      </button>
    </div>
  );
}
