import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { authClient } from "../auth/auth-client";

export function ProfileSection() {
  const { user, refetchUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const isDirty = name !== (user?.name || "");

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await authClient.updateUser({ name });
      if (error) {
        throw new Error(error.message || "Failed to update profile");
      }
      refetchUser();
      setMessage({ type: "success", text: "Profile updated" });
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update profile",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold mb-4">
        Profile
      </h3>

      {/* Avatar */}
      <div className="flex items-center gap-4 mb-5">
        {user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="w-14 h-14 rounded-full flex-shrink-0"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-14 h-14 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-bold text-white">
              {(user?.name || user?.email || "?")[0].toUpperCase()}
            </span>
          </div>
        )}
        <div>
          <div className="text-xs text-white/50 mb-1">Profile photo</div>
          <span
            className="text-xs text-white/30 cursor-default"
            title="Coming soon"
          >
            Change photo (coming soon)
          </span>
        </div>
      </div>

      {/* Name */}
      <div className="mb-4">
        <label
          htmlFor="settings-name"
          className="block text-xs text-white/50 mb-1.5"
        >
          Display name
        </label>
        <input
          id="settings-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
        />
      </div>

      {/* Email (read-only) */}
      <div className="mb-4">
        <label
          htmlFor="settings-email"
          className="block text-xs text-white/50 mb-1.5"
        >
          Email
        </label>
        <input
          id="settings-email"
          type="email"
          value={user?.email || ""}
          readOnly
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/40 cursor-not-allowed"
        />
      </div>

      {/* Message */}
      {message && (
        <p
          className={`text-xs mb-3 ${message.type === "success" ? "text-green-400" : "text-red-400"}`}
        >
          {message.text}
        </p>
      )}

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className="bg-blue-500 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
