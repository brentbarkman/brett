import React, { useState } from "react";
import { createPortal } from "react-dom";

interface DeleteAccountDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteAccountDialog({
  isOpen,
  onClose,
  onConfirm,
}: DeleteAccountDialogProps) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isConfirmed = confirmText === "DELETE";

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err: any) {
      setError(err.message || "Failed to delete account");
      setDeleting(false);
    }
  }

  function handleClose() {
    if (deleting) return;
    setConfirmText("");
    setError(null);
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md bg-[#0a0e1a] border border-red-500/30 rounded-xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-red-400 mb-2">
          Delete account
        </h3>
        <p className="text-sm text-white/60 mb-4">
          This action is permanent and cannot be undone. All your data will be
          deleted.
        </p>

        <div className="mb-4">
          <label
            htmlFor="delete-confirm"
            className="block text-xs text-white/50 mb-1.5"
          >
            Type <span className="font-mono font-bold text-white/70">DELETE</span> to confirm
          </label>
          <input
            id="delete-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={deleting}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50 focus:outline-none"
            placeholder="DELETE"
            autoFocus
          />
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        <div className="flex justify-end gap-3">
          <button
            onClick={handleClose}
            disabled={deleting}
            className="text-white/60 border border-white/15 rounded-lg px-4 py-2 text-sm hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!isConfirmed || deleting}
            className="bg-red-500/20 text-red-400 border border-red-500/40 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {deleting ? "Deleting..." : "Delete account"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
