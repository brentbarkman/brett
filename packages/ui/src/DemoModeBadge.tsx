import React from "react";
import { EyeOff } from "lucide-react";
import { useDemoMode } from "./lib/demoMode";

interface DemoModeBadgeProps {
  isCollapsed?: boolean;
}

export function DemoModeBadge({ isCollapsed = false }: DemoModeBadgeProps) {
  const { enabled, toggle } = useDemoMode();
  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      title="Demo mode is on — click to turn off (⌘⇧D)"
      aria-label="Demo mode on — click to turn off"
      className={`
        flex items-center gap-1.5 mb-3 rounded-md border transition-colors
        bg-brett-gold/15 border-brett-gold/30 text-brett-gold
        hover:bg-brett-gold/25 hover:border-brett-gold/50
        ${isCollapsed ? "justify-center h-8 w-full" : "px-2 py-1 w-full"}
      `}
    >
      <EyeOff size={12} className="flex-shrink-0" />
      {!isCollapsed && (
        <span className="text-[10px] font-semibold uppercase tracking-[0.15em]">
          Demo Mode
        </span>
      )}
    </button>
  );
}
