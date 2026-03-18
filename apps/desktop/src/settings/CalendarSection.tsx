import React, { useState } from "react";
import { Calendar, Plus, Trash2, RefreshCw } from "lucide-react";
import {
  useCalendarAccounts,
  useConnectCalendar,
  useDisconnectCalendar,
  useToggleCalendarVisibility,
} from "../api/calendar-accounts";
import { useFetchCalendarRange } from "../api/calendar";
import type { ConnectedCalendarAccount } from "@brett/types";

const isDev = import.meta.env.DEV;

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
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

interface ConnectedAccountRowProps {
  account: ConnectedCalendarAccount;
}

function ConnectedAccountRow({ account }: ConnectedAccountRowProps) {
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const disconnectCalendar = useDisconnectCalendar();
  const toggleVisibility = useToggleCalendarVisibility();

  function handleDisconnect() {
    disconnectCalendar.mutate(account.id, {
      onSuccess: () => setConfirmDisconnect(false),
    });
  }

  return (
    <div className="bg-white/5 rounded-lg overflow-hidden">
      {/* Account header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0">
          <GoogleIcon />
          <span className="text-sm text-white truncate">{account.googleEmail}</span>
        </div>
        {confirmDisconnect ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs text-white/50">Disconnect?</span>
            <button
              onClick={handleDisconnect}
              disabled={disconnectCalendar.isPending}
              className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors disabled:opacity-40"
            >
              {disconnectCalendar.isPending ? "Removing..." : "Yes"}
            </button>
            <button
              onClick={() => setConfirmDisconnect(false)}
              className="text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDisconnect(true)}
            className="flex items-center gap-1 text-xs text-white/40 hover:text-red-400 transition-colors flex-shrink-0 ml-2"
          >
            <Trash2 size={12} />
            Disconnect
          </button>
        )}
      </div>

      {/* Calendar list */}
      {account.calendars.length > 0 && (
        <div className="divide-y divide-white/5">
          {account.calendars.map((cal) => (
            <div
              key={cal.id}
              className="flex items-center gap-3 px-3 py-2"
            >
              {/* Color swatch */}
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: cal.color }}
              />
              <span className="flex-1 text-sm text-white/70 truncate">{cal.name}</span>
              {/* Visibility toggle */}
              <button
                role="switch"
                aria-checked={cal.isVisible}
                onClick={() =>
                  toggleVisibility.mutate({
                    accountId: account.id,
                    calendarId: cal.id,
                    isVisible: !cal.isVisible,
                  })
                }
                className={`relative inline-flex h-[18px] w-[32px] items-center rounded-full transition-colors flex-shrink-0 ${
                  cal.isVisible ? "bg-blue-500" : "bg-white/15"
                }`}
              >
                <span
                  className={`inline-block h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-transform ${
                    cal.isVisible ? "translate-x-[16px]" : "translate-x-[2px]"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CalendarSection() {
  const { data: accounts = [], isLoading, error } = useCalendarAccounts();
  const connectCalendar = useConnectCalendar();
  const fetchRange = useFetchCalendarRange();

  return (
    <div className="bg-black/30 backdrop-blur-xl rounded-xl border border-white/10 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs uppercase tracking-wider text-white/40 font-semibold">
          Connected Calendars
        </h3>
        <button
          onClick={() => connectCalendar.mutate()}
          disabled={connectCalendar.isPending}
          className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={12} />
          Connect Google Calendar
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2">
          <div className="bg-white/5 animate-pulse rounded-lg h-12 w-full" />
          <div className="bg-white/5 animate-pulse rounded-lg h-8 w-3/4" />
        </div>
      )}

      {error && (
        <div className="text-sm text-red-400">
          Failed to load connected calendars.
        </div>
      )}

      {!isLoading && !error && accounts.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <Calendar size={28} className="text-white/20" />
          <div>
            <p className="text-sm text-white/50">No calendars connected yet</p>
            <p className="text-xs text-white/30 mt-1">
              Connect your Google Calendar to see events alongside your tasks
            </p>
          </div>
        </div>
      )}

      {!isLoading && !error && accounts.length > 0 && (
        <div className="space-y-3">
          {accounts.map((account) => (
            <ConnectedAccountRow key={account.id} account={account} />
          ))}
        </div>
      )}

      {isDev && !isLoading && accounts.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/5">
          <button
            onClick={() => {
              const now = new Date();
              const start = new Date(now);
              start.setDate(start.getDate() - 30);
              const end = new Date(now);
              end.setDate(end.getDate() + 90);
              const fmt = (d: Date) => d.toISOString().split("T")[0];
              fetchRange.mutate({ startDate: fmt(start), endDate: fmt(end) });
            }}
            disabled={fetchRange.isPending}
            className="flex items-center gap-1.5 text-xs text-amber-400/60 hover:text-amber-400 transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={fetchRange.isPending ? "animate-spin" : ""} />
            {fetchRange.isPending ? "Resyncing..." : "Force resync (dev)"}
          </button>
        </div>
      )}
    </div>
  );
}
