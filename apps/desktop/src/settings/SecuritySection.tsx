import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { authClient } from "../auth/auth-client";
import { useAccountType } from "./useAccountType";

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function SecuritySection() {
  const { user } = useAuth();
  const { isGoogle, isEmailPassword, loading, error: accountError } = useAccountType();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
      });
      if (error) {
        throw new Error(error.message || "Failed to change password");
      }
      setCurrentPassword("");
      setNewPassword("");
      setMessage({ type: "success", text: "Password updated" });
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to change password",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-4">
          Security
        </h3>
        <div className="space-y-3">
          <div className="bg-white/5 animate-pulse rounded-lg h-10 w-full" />
          <div className="bg-white/5 animate-pulse rounded-lg h-10 w-3/4" />
        </div>
      </div>
    );
  }

  if (accountError) {
    return (
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-4">
          Security
        </h3>
        <div className="text-sm text-red-400">{accountError}</div>
      </div>
    );
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-4">
        Security
      </h3>

      {/* Google badge */}
      {isGoogle && (
        <div className="flex items-center gap-2 mb-4 p-2.5 bg-white/5 rounded-lg">
          <GoogleIcon />
          <div>
            <div className="text-sm text-white">Signed in with Google</div>
            <div className="text-xs text-white/40">{user?.email}</div>
          </div>
        </div>
      )}

      {/* Password form for email/password users */}
      {isEmailPassword ? (
        <form onSubmit={handleChangePassword}>
          <div className="mb-3">
            <label
              htmlFor="current-password"
              className="block text-xs text-white/50 mb-1.5"
            >
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
              placeholder="Enter current password"
            />
          </div>
          <div className="mb-3">
            <label
              htmlFor="new-password"
              className="block text-xs text-white/50 mb-1.5"
            >
              New password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
              placeholder="Enter new password"
            />
          </div>

          {message && (
            <p
              className={`text-xs mb-3 ${message.type === "success" ? "text-green-400" : "text-red-400"}`}
            >
              {message.text}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!currentPassword || !newPassword || saving}
              className="bg-white/10 text-white border border-white/15 rounded-lg px-4 py-2 text-sm font-medium hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Updating..." : "Update password"}
            </button>
          </div>
        </form>
      ) : (
        isGoogle && (
          <p className="text-xs text-white/40 italic">
            Password management is not available for Google accounts.
          </p>
        )
      )}
    </div>
  );
}
