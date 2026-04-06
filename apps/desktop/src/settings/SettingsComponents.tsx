import React from "react";

/**
 * Shared settings primitives. Use these in ALL settings sections
 * to guarantee visual consistency across tabs.
 */

/** Glass card wrapper for a settings section. */
export function SettingsCard({
  children,
  className = "",
  danger,
}: {
  children: React.ReactNode;
  className?: string;
  danger?: boolean;
}) {
  return (
    <div
      className={`bg-black/30 backdrop-blur-xl rounded-xl border ${
        danger ? "border-red-500/30" : "border-white/10"
      } p-6 ${className}`}
    >
      {children}
    </div>
  );
}

/** Uppercase section header inside a settings card. */
export function SettingsHeader({
  children,
  className = "",
  danger,
}: {
  children: React.ReactNode;
  className?: string;
  danger?: boolean;
}) {
  return (
    <h3
      className={`text-xs uppercase tracking-wider font-semibold mb-4 ${
        danger ? "text-red-400/60" : "text-white/40"
      } ${className}`}
    >
      {children}
    </h3>
  );
}

/** Standard toggle switch. Gold when on, neutral when off. */
export function SettingsToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
        checked ? "bg-brett-gold" : "bg-white/10"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}
