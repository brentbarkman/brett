import React from "react";
import { Inbox, Calendar, Search, Plus } from "lucide-react";
import type { NavList } from "@brett/types";

interface LeftNavProps {
  isCollapsed: boolean;
  lists: NavList[];
}

export function LeftNav({ isCollapsed, lists }: LeftNavProps) {
  return (
    <nav
      className={`
      flex flex-col h-full py-6 transition-all duration-300 ease-in-out
      ${isCollapsed ? "w-[68px] px-2" : "w-[220px] px-4"}
    `}
    >
      {/* Header */}
      <div
        className={`flex items-center gap-2 mb-8 ${isCollapsed ? "justify-center" : "px-2"}`}
      >
        <div className="w-6 h-6 rounded bg-blue-500 flex items-center justify-center flex-shrink-0 shadow-[0_0_10px_rgba(59,130,246,0.5)]">
          <span className="text-white font-bold text-xs">B</span>
        </div>
        {!isCollapsed && (
          <span className="text-white font-bold tracking-wide">Brett</span>
        )}
      </div>

      {/* Main Links */}
      <div className="space-y-1 mb-8">
        <NavItem
          icon={<Calendar size={18} />}
          label="Today"
          badge={3}
          isActive
          isCollapsed={isCollapsed}
        />
        <NavItem
          icon={<Inbox size={18} />}
          label="Inbox"
          badge={5}
          isCollapsed={isCollapsed}
        />
        <NavItem
          icon={<Search size={18} />}
          label="Scouts"
          badge={2}
          isCollapsed={isCollapsed}
        />
      </div>

      {/* Divider */}
      <div className="h-px bg-white/10 w-full mb-6" />

      {/* Lists Section */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {!isCollapsed && (
          <h3 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold px-2 mb-3">
            Lists
          </h3>
        )}
        <div className="space-y-1">
          {lists.map((list) => (
            <NavItem
              key={list.id}
              icon={
                <div
                  className={`w-2 h-2 rounded-full ${list.colorClass}`}
                />
              }
              label={list.name}
              count={list.count}
              isCollapsed={isCollapsed}
            />
          ))}
        </div>
      </div>

      {/* Footer Action */}
      <div className="mt-auto pt-4">
        <button
          className={`
          flex items-center gap-2 text-white/50 hover:text-white/90 transition-colors w-full
          ${isCollapsed ? "justify-center p-2" : "px-2 py-1.5"}
        `}
        >
          <Plus size={18} />
          {!isCollapsed && (
            <span className="text-sm font-medium">New list</span>
          )}
        </button>
      </div>
    </nav>
  );
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  count?: number;
  isActive?: boolean;
  isCollapsed: boolean;
}

function NavItem({
  icon,
  label,
  badge,
  count,
  isActive,
  isCollapsed,
}: NavItemProps) {
  return (
    <button
      className={`
      flex items-center w-full rounded-lg transition-colors duration-200 group
      ${isCollapsed ? "justify-center p-2.5" : "px-2 py-1.5 gap-3"}
      ${isActive ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white/90"}
    `}
    >
      <div
        className={`${isActive ? "text-white" : "text-white/50 group-hover:text-white/80"}`}
      >
        {icon}
      </div>

      {!isCollapsed && (
        <>
          <span className="text-sm font-medium flex-1 text-left truncate">
            {label}
          </span>
          {badge !== undefined && (
            <span className="bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
              {badge}
            </span>
          )}
          {count !== undefined && (
            <span className="text-xs text-white/30 font-medium">{count}</span>
          )}
        </>
      )}
    </button>
  );
}
