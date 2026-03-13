import React from "react";
import { Inbox, Calendar, Search } from "lucide-react";
import type { NavList } from "@brett/types";
import { useDroppable } from "@dnd-kit/core";

interface LeftNavUser {
  name: string | null;
  avatarUrl: string | null;
  email: string;
}

interface LeftNavProps {
  isCollapsed: boolean;
  lists: NavList[];
  user?: LeftNavUser | null;
  /** Number of incomplete things to show on the Today badge */
  incompleteCount?: number;
  /** Currently active view */
  activeView?: string;
  /** Callback when a nav item is clicked */
  onNavClick?: (view: string) => void;
  /** Real inbox badge count */
  inboxCount?: number;
}

export function LeftNav({
  isCollapsed,
  lists,
  user,
  incompleteCount,
  activeView = "today",
  onNavClick,
  inboxCount,
}: LeftNavProps) {
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
          badge={incompleteCount}
          isActive={activeView === "today"}
          isCollapsed={isCollapsed}
          onClick={() => onNavClick?.("today")}
        />
        <NavItem
          icon={<Inbox size={18} />}
          label="Inbox"
          badge={inboxCount}
          isActive={activeView === "inbox"}
          isCollapsed={isCollapsed}
          onClick={() => onNavClick?.("inbox")}
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
            <DroppableNavItem
              key={list.id}
              list={list}
              isCollapsed={isCollapsed}
              onClick={() => onNavClick?.(`list:${list.id}`)}
            />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto pt-4 space-y-2">
        {user && (
          <>
            <div className="h-px bg-white/10 w-full" />
            <div
              className={`
              flex items-center gap-2.5 rounded-lg transition-colors w-full
              ${isCollapsed ? "justify-center p-2" : "px-2 py-1.5"}
            `}
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="w-6 h-6 rounded-full flex-shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-white/80">
                    {(user.name || user.email)[0].toUpperCase()}
                  </span>
                </div>
              )}
              {!isCollapsed && (
                <span className="text-xs text-white/60 truncate">
                  {user.name || user.email}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

function DroppableNavItem({
  list,
  isCollapsed,
  onClick,
}: {
  list: NavList;
  isCollapsed: boolean;
  onClick?: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `list-drop-${list.id}`,
    data: { type: "list", listId: list.id },
  });

  return (
    <div ref={setNodeRef}>
      <NavItem
        icon={
          <div
            className={`w-2 h-2 rounded-full ${list.colorClass}`}
          />
        }
        label={list.name}
        count={list.count}
        isCollapsed={isCollapsed}
        isDropTarget={isOver}
        dropColorClass={list.colorClass}
        onClick={onClick}
      />
    </div>
  );
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  badge?: number;
  count?: number;
  isActive?: boolean;
  isCollapsed: boolean;
  isDropTarget?: boolean;
  dropColorClass?: string;
  onClick?: () => void;
}

function NavItem({
  icon,
  label,
  badge,
  count,
  isActive,
  isCollapsed,
  isDropTarget,
  dropColorClass,
  onClick,
}: NavItemProps) {
  // Convert colorClass like "bg-blue-500" to a low-opacity version for drop highlight
  const dropHighlight = isDropTarget && dropColorClass
    ? dropColorClass.replace("bg-", "bg-").replace("-500", "-500/20")
    : "";

  return (
    <button
      onClick={onClick}
      className={`
      flex items-center w-full rounded-lg transition-colors duration-200 group
      ${isCollapsed ? "justify-center p-2.5" : "px-2 py-1.5 gap-3"}
      ${isDropTarget
        ? `${dropHighlight} border border-white/20 text-white`
        : isActive
          ? "bg-white/10 text-white"
          : "text-white/60 hover:bg-white/5 hover:text-white/90"
      }
    `}
    >
      <div
        className={`${isActive || isDropTarget ? "text-white" : "text-white/50 group-hover:text-white/80"}`}
      >
        {icon}
      </div>

      {!isCollapsed && (
        <>
          <span className="text-sm font-medium flex-1 text-left truncate">
            {label}
          </span>
          {badge !== undefined && badge > 0 && (
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
