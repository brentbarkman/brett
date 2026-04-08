import React, { useState } from "react";
import { Mail, Copy, Check, Trash2 } from "lucide-react";
import { SettingsCard, SettingsHeader, SettingsToggle } from "./SettingsComponents";
import {
  useNewsletterSenders,
  useNewsletterPending,
  useUpdateSender,
  useDeleteSender,
  useApprovePendingSender,
  useBlockPendingSender,
} from "../api/newsletters";
import type { NewsletterSender, PendingNewsletterSummary } from "@brett/types";
import { useAppConfig } from "../hooks/useAppConfig";

function ForwardingAddressCard({ email }: { email: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!email) {
    return (
      <SettingsCard>
        <SettingsHeader>Forwarding Address</SettingsHeader>
        <p className="text-xs text-white/40">Newsletter ingestion is not configured on this server.</p>
      </SettingsCard>
    );
  }

  function handleCopy() {
    navigator.clipboard.writeText(email!).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <SettingsCard>
      <SettingsHeader>Forwarding Address</SettingsHeader>
      <p className="text-xs text-white/40 mb-3 leading-relaxed">
        Set up Gmail auto-forwarding to send newsletters to this address. Brett
        will process them and surface what matters.
      </p>
      <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
        <Mail size={14} className="text-white/30 flex-shrink-0" />
        <span className="flex-1 text-sm text-white font-mono select-all">{email}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-white/40 hover:text-white/70 transition-colors flex-shrink-0"
          title="Copy to clipboard"
        >
          {copied ? (
            <>
              <Check size={13} className="text-brett-gold" />
              <span className="text-brett-gold">Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              Copy
            </>
          )}
        </button>
      </div>
    </SettingsCard>
  );
}

interface PendingRowProps {
  pending: PendingNewsletterSummary;
}

function PendingRow({ pending }: PendingRowProps) {
  const approve = useApprovePendingSender();
  const block = useBlockPendingSender();
  const isBusy = approve.isPending || block.isPending;

  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{pending.senderName || pending.senderEmail}</p>
        <p className="text-[11px] text-white/40 truncate">{pending.senderEmail}</p>
        <p className="text-[11px] text-white/30 mt-0.5 truncate">
          {pending.subject} ·{" "}
          {new Date(pending.receivedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
        <button
          onClick={() => approve.mutate(pending.id)}
          disabled={isBusy}
          className="text-xs text-brett-gold hover:text-brett-gold/80 font-medium transition-colors disabled:opacity-40"
        >
          {approve.isPending ? "Approving…" : "Approve"}
        </button>
        <button
          onClick={() => block.mutate(pending.id)}
          disabled={isBusy}
          className="text-xs text-white/40 hover:text-red-400 transition-colors disabled:opacity-40"
        >
          {block.isPending ? "Blocking…" : "Block"}
        </button>
      </div>
    </div>
  );
}

interface SenderRowProps {
  sender: NewsletterSender;
}

function SenderRow({ sender }: SenderRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const updateSender = useUpdateSender();
  const deleteSender = useDeleteSender();

  function handleDelete() {
    deleteSender.mutate(sender.id, {
      onSuccess: () => setConfirmDelete(false),
    });
  }

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 first:pt-2.5 last:pb-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{sender.name}</p>
        <p className="text-[11px] text-white/40 truncate">{sender.email}</p>
      </div>

      <SettingsToggle
        checked={sender.active}
        onChange={() =>
          updateSender.mutate({ id: sender.id, data: { active: !sender.active } })
        }
        disabled={updateSender.isPending}
      />

      {confirmDelete ? (
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleDelete}
            disabled={deleteSender.isPending}
            className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors disabled:opacity-40"
          >
            {deleteSender.isPending ? "Removing…" : "Remove"}
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="text-xs text-white/40 hover:text-white/60 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          className="flex-shrink-0 text-white/20 hover:text-red-400 transition-colors"
          title="Remove sender"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

export function NewsletterSection() {
  const { data: config } = useAppConfig();
  const { data: senders = [], isLoading: sendersLoading, error: sendersError } = useNewsletterSenders();
  const { data: pending = [], isLoading: pendingLoading } = useNewsletterPending();

  return (
    <>
      <ForwardingAddressCard email={config?.newsletterIngestEmail ?? null} />

      {/* Pending senders */}
      {(pendingLoading || pending.length > 0) && (
        <SettingsCard className="border-amber-400/20">
          <SettingsHeader>Pending Senders</SettingsHeader>
          <p className="text-xs text-white/40 mb-3">
            These senders forwarded a newsletter but haven't been approved yet.
          </p>

          {pendingLoading ? (
            <div className="space-y-2">
              <div className="bg-white/5 animate-pulse rounded-lg h-10 w-full" />
              <div className="bg-white/5 animate-pulse rounded-lg h-10 w-3/4" />
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {pending.map((p) => (
                <PendingRow key={p.id} pending={p} />
              ))}
            </div>
          )}
        </SettingsCard>
      )}

      {/* Configured senders */}
      <SettingsCard>
        <SettingsHeader>Newsletter Senders</SettingsHeader>

        {sendersLoading && (
          <div className="space-y-2">
            <div className="bg-white/5 animate-pulse rounded-lg h-10 w-full" />
            <div className="bg-white/5 animate-pulse rounded-lg h-10 w-3/4" />
          </div>
        )}

        {sendersError && (
          <p className="text-sm text-red-400">Failed to load newsletter senders.</p>
        )}

        {!sendersLoading && !sendersError && senders.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Mail size={24} className="text-white/20" />
            <div>
              <p className="text-sm text-white/50">No senders configured yet</p>
              <p className="text-xs text-white/30 mt-1">
                Forward a newsletter to your ingest address to get started.
              </p>
            </div>
          </div>
        )}

        {!sendersLoading && !sendersError && senders.length > 0 && (
          <div className="bg-white/5 rounded-lg overflow-hidden divide-y divide-white/10">
            {senders.map((sender) => (
              <SenderRow key={sender.id} sender={sender} />
            ))}
          </div>
        )}
      </SettingsCard>
    </>
  );
}
