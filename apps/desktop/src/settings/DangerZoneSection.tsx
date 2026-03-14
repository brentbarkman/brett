import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { authClient } from "../auth/auth-client";
import { DeleteAccountDialog } from "./DeleteAccountDialog";

export function DangerZoneSection() {
  const { signOut } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  async function handleDeleteAccount() {
    const { error } = await authClient.deleteUser();
    if (error) {
      throw new Error(error.message || "Failed to delete account");
    }
    await signOut();
  }

  return (
    <>
      <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-red-500/30 px-6 py-5 flex items-center justify-between">
        <div>
          <div className="text-sm text-red-400">Delete account</div>
          <div className="text-xs text-white/40">
            Permanently delete your account and all data
          </div>
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          className="bg-transparent text-red-400 border border-red-500/40 rounded-lg px-4 py-1.5 text-sm hover:bg-red-500/10 transition-colors"
        >
          Delete account
        </button>
      </div>

      <DeleteAccountDialog
        isOpen={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleDeleteAccount}
      />
    </>
  );
}
