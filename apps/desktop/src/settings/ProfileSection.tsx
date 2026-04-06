import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { authClient } from "../auth/auth-client";
import { getAvatarColor, Wordmark } from "@brett/ui";
import { useAssistantName, useUpdateAssistantName } from "../api/assistant-name";

export function ProfileSection() {
  const { user, refetchUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const isDirty = name !== (user?.name || "");

  const currentAssistantName = useAssistantName();
  const [assistantNameInput, setAssistantNameInput] = useState(currentAssistantName);
  const updateAssistantName = useUpdateAssistantName();
  const isAssistantNameDirty = assistantNameInput.trim() !== currentAssistantName;

  async function handleAssistantNameSave() {
    try {
      await updateAssistantName.mutateAsync(assistantNameInput);
      setMessage({ type: "success", text: "Assistant name updated" });
    } catch (err: unknown) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update",
      });
    }
  }

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
          <div className={`w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 ${getAvatarColor(user?.name || user?.email || "?")}`}>
            <span className="text-xl font-bold">
              {(user?.name || user?.email || "?")[0].toUpperCase()}
            </span>
          </div>
        )}
        <div>
          <div className="text-sm font-medium text-white">
            {user?.name || user?.email || "?"}
          </div>
          <div className="text-xs text-white/40">
            {user?.email || ""}
          </div>
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
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-brett-gold/50 focus:ring-1 focus:ring-brett-gold/50 focus:outline-none"
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

      {/* Assistant name */}
      <div className="mb-4">
        <label
          htmlFor="settings-assistant-name"
          className="block text-xs text-white/50 mb-1.5"
        >
          Assistant name
        </label>
        <div className="flex items-center gap-3">
          <input
            id="settings-assistant-name"
            type="text"
            value={assistantNameInput}
            onChange={(e) => {
              if (e.target.value.length <= 10) setAssistantNameInput(e.target.value);
            }}
            maxLength={10}
            placeholder="Brett"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-brett-gold/50 focus:ring-1 focus:ring-brett-gold/50 focus:outline-none"
          />
          <Wordmark name={assistantNameInput.trim() || "Brett"} size={16} />
        </div>
        <p className="text-[10px] text-white/30 mt-1">{assistantNameInput.length}/10</p>
      </div>

      {/* Message */}
      {message && (
        <p
          className={`text-xs mb-3 ${message.type === "success" ? "text-brett-teal" : "text-red-400"}`}
        >
          {message.text}
        </p>
      )}

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={async () => {
            let failed = false;
            if (isDirty) {
              try { await handleSave(); } catch { failed = true; }
            }
            if (!failed && isAssistantNameDirty) {
              await handleAssistantNameSave();
            }
          }}
          disabled={(!isDirty && !isAssistantNameDirty) || saving || updateAssistantName.isPending}
          className="bg-brett-gold text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-brett-gold-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {(saving || updateAssistantName.isPending) ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
