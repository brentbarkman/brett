import React, { useState, useRef, useEffect } from "react";
import { Inbox, Calendar, Clock, Search, Plus, MoreHorizontal, GripVertical, ChevronRight } from "lucide-react";
import type { NavList } from "@brett/types";
import { slugify } from "@brett/utils";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const colorMap: Record<string, string> = {
  "bg-blue-400": "#60a5fa",
  "bg-emerald-400": "#34d399",
  "bg-violet-400": "#a78bfa",
  "bg-amber-400": "#fbbf24",
  "bg-rose-400": "#fb7185",
  "bg-sky-400": "#38bdf8",
  "bg-orange-400": "#fb923c",
  "bg-slate-400": "#94a3b8",
  // Legacy values from before palette update
  "bg-blue-500": "#3b82f6",
  "bg-green-500": "#22c55e",
  "bg-purple-500": "#a855f7",
  "bg-amber-500": "#f59e0b",
  "bg-red-500": "#ef4444",
  "bg-pink-500": "#ec4899",
  "bg-cyan-500": "#06b6d4",
  "bg-orange-500": "#f97316",
  "bg-gray-500": "rgba(255,255,255,0.4)",
};

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
  /** Current route path (e.g., "/today", "/lists/abc123") */
  currentPath?: string;
  /** Navigation function — called with target path */
  navigate?: (path: string) => void;
  /** Number of upcoming items to show on the Upcoming badge */
  upcomingCount?: number;
  /** Real inbox badge count */
  inboxCount?: number;
  onCreateList?: (name: string) => void;
  onRenameList?: (id: string, newName: string) => void;
  onDeleteList?: (id: string) => void;
  onReorderLists?: (orderedIds: string[]) => void;
  onArchiveList?: (id: string) => void;
  onUnarchiveList?: (id: string) => void;
  archivedLists?: NavList[];
}

export function LeftNav({
  isCollapsed,
  lists,
  user,
  incompleteCount,
  currentPath = "/today",
  navigate,
  upcomingCount,
  inboxCount,
  onCreateList,
  onRenameList,
  onDeleteList,
  onReorderLists,
  onArchiveList,
  onUnarchiveList,
  archivedLists,
}: LeftNavProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) {
      createInputRef.current?.focus();
    }
  }, [isCreating]);

  const handleCreateSubmit = () => {
    const name = createName.trim();
    if (name) {
      onCreateList?.(name);
    }
    setCreateName("");
    setIsCreating(false);
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      handleCreateSubmit();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setCreateName("");
      setIsCreating(false);
    }
  };

  const sortableIds = lists.map((l) => `sortable-list-${l.id}`);

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
          isActive={currentPath === "/today"}
          isCollapsed={isCollapsed}
          onClick={() => navigate?.("/today")}
        />
        <NavItem
          icon={<Clock size={18} />}
          label="Upcoming"
          badge={upcomingCount}
          isActive={currentPath === "/upcoming"}
          isCollapsed={isCollapsed}
          onClick={() => navigate?.("/upcoming")}
        />
        <NavItem
          icon={<Inbox size={18} />}
          label="Inbox"
          badge={inboxCount}
          isActive={currentPath === "/inbox"}
          isCollapsed={isCollapsed}
          onClick={() => navigate?.("/inbox")}
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
          <div className="flex items-center justify-between px-2 mb-3">
            <h3 className="font-mono text-xs uppercase tracking-wider text-white/40 font-semibold">
              Lists
            </h3>
            {onCreateList && (
              <button
                onClick={() => setIsCreating(true)}
                className="text-white/30 hover:text-white/70 transition-colors p-0.5 rounded hover:bg-white/10"
              >
                <Plus size={14} />
              </button>
            )}
          </div>
        )}

        {/* Inline create input */}
        {isCreating && !isCollapsed && (
          <div className="px-1 mb-2">
            <input
              ref={createInputRef}
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={handleCreateKeyDown}
              onBlur={handleCreateSubmit}
              placeholder="List name…"
              className="w-full bg-white/10 backdrop-blur-md border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none focus:border-white/40 transition-colors"
            />
          </div>
        )}

        <SortableContext
          items={sortableIds}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-1">
            {lists.map((list) => (
              <SortableListItem
                key={list.id}
                list={list}
                isCollapsed={isCollapsed}
                isActive={currentPath === `/lists/${slugify(list.name)}`}
                onClick={() => navigate?.(`/lists/${slugify(list.name)}`)}
                onRename={onRenameList}
                onDelete={onDeleteList}
                onArchive={onArchiveList}
              />
            ))}
          </div>
        </SortableContext>

        {!isCollapsed && archivedLists && archivedLists.length > 0 && (
          <ArchivedListsSection
            lists={archivedLists}
            currentPath={currentPath}
            navigate={navigate}
            onUnarchive={onUnarchiveList}
            onDelete={onDeleteList}
          />
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto pt-4 space-y-2">
        {user && (
          <>
            <div className="h-px bg-white/10 w-full" />
            <button
              onClick={() => navigate?.("/settings")}
              className={`
              flex items-center gap-2.5 rounded-lg transition-colors w-full cursor-pointer hover:bg-white/5
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
            </button>
          </>
        )}
      </div>
    </nav>
  );
}

function SortableListItem({
  list,
  isCollapsed,
  isActive,
  onClick,
  onRename,
  onDelete,
  onArchive,
}: {
  list: NavList;
  isCollapsed: boolean;
  isActive?: boolean;
  onClick?: () => void;
  onRename?: (id: string, newName: string) => void;
  onDelete?: (id: string) => void;
  onArchive?: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: `sortable-list-${list.id}`,
    data: { type: "sortable-list", listId: list.id },
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(list.name);
  const [showMenu, setShowMenu] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isEditing) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [isEditing]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const handleRenameSubmit = () => {
    const name = editName.trim();
    if (name && name !== list.name) {
      onRename?.(list.id, name);
    }
    setIsEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setEditName(list.name);
      setIsEditing(false);
    }
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };


  // Convert colorClass like "bg-blue-500" to a low-opacity version for drop highlight
  const dropHighlight =
    isOver && list.colorClass
      ? list.colorClass.replace("bg-", "bg-").replace("-500", "-500/20")
      : "";

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      {isEditing && !isCollapsed ? (
        <div className="px-1">
          <input
            ref={editInputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={handleRenameSubmit}
            className="w-full bg-white/10 backdrop-blur-md border border-white/20 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-white/40 transition-colors"
          />
        </div>
      ) : (
        <button
          onClick={onClick}
          className={`
            flex items-center w-full rounded-lg transition-colors duration-200 group outline-none
            ${isCollapsed ? "justify-center p-2.5" : "px-2 py-1.5 gap-2.5"}
            ${
              isOver
                ? `${dropHighlight} border border-white/20 text-white`
                : isActive
                  ? "bg-white/10 text-white border border-transparent"
                  : "text-white/60 hover:bg-white/5 hover:text-white/90 border border-transparent"
            }
          `}
          {...attributes}
          {...listeners}
        >
          <ProgressDot
            count={list.count}
            completedCount={list.completedCount}
            colorClass={list.colorClass}
          />

          {!isCollapsed && (
            <>
              <span className="text-sm font-medium flex-1 text-left truncate">
                {list.name}
              </span>
              {(onRename || onDelete) && (
                <button
                  ref={menuButtonRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(!showMenu);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-white/70 transition-all p-0.5 rounded hover:bg-white/10 flex-shrink-0"
                >
                  <MoreHorizontal size={14} />
                </button>
              )}
            </>
          )}
        </button>
      )}

      {/* Context menu dropdown */}
      {showMenu && !isCollapsed && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full mt-1 z-50 bg-black/60 backdrop-blur-2xl rounded-lg border border-white/10 py-1 min-w-[120px] shadow-xl"
        >
          {onRename && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                setEditName(list.name);
                setIsEditing(true);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              Rename
            </button>
          )}
          {onArchive && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onArchive(list.id);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              Archive
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(false);
                onDelete(list.id);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-white/10 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Tiny SVG ring that fills clockwise based on completion percentage */
function ProgressDot({
  count,
  completedCount,
  colorClass,
}: {
  count: number;
  completedCount: number;
  colorClass: string;
}) {
  const size = 20;
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = count > 0 ? completedCount / count : 0;
  const filled = circumference * progress;

  const strokeColor = colorMap[colorClass] ?? "rgba(255,255,255,0.4)";

  // Empty list — just a dim dot
  if (count === 0) {
    return (
      <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
        <div className="w-2.5 h-2.5 rounded-full bg-white/20" />
      </div>
    );
  }

  // All done — filled circle
  if (progress >= 1) {
    return (
      <svg width={size} height={size} className="flex-shrink-0">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill={strokeColor}
          opacity={0.8}
        />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      className="flex-shrink-0"
      style={{ transform: "rotate(-90deg)" }}
    >
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={strokeWidth}
      />
      {/* Progress arc */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={`${filled} ${circumference - filled}`}
        strokeLinecap="round"
      />
    </svg>
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

function ArchivedListsSection({
  lists,
  currentPath,
  navigate,
  onUnarchive,
  onDelete,
}: {
  lists: NavList[];
  currentPath?: string;
  navigate?: (path: string) => void;
  onUnarchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="mt-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 px-2 mb-2 text-white/30 hover:text-white/50 transition-colors"
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
        />
        <span className="font-mono text-xs uppercase tracking-wider font-semibold">
          Archived
        </span>
      </button>
      {isExpanded && (
        <div className="space-y-1">
          {lists.map((list) => (
            <ArchivedListItem
              key={list.id}
              list={list}
              isActive={currentPath === `/lists/${slugify(list.name)}`}
              onClick={() => navigate?.(`/lists/${slugify(list.name)}`)}
              onUnarchive={onUnarchive}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ArchivedListItem({
  list,
  isActive,
  onClick,
  onUnarchive,
  onDelete,
}: {
  list: NavList;
  isActive?: boolean;
  onClick?: () => void;
  onUnarchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          menuButtonRef.current && !menuButtonRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showMenu]);

  const dotColor = colorMap[list.colorClass] ?? "rgba(255,255,255,0.4)";

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className={`
          flex items-center w-full rounded-lg transition-colors duration-200 px-2 py-1.5 gap-2.5 opacity-50
          ${isActive ? "bg-white/10 text-white !opacity-100" : "text-white/60 hover:bg-white/5 hover:text-white/90"}
        `}
      >
        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
        <span className="text-sm font-medium flex-1 text-left truncate">{list.name}</span>
        {(onUnarchive || onDelete) && (
          <button
            ref={menuButtonRef}
            onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
            className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-white/70 transition-all p-0.5 rounded hover:bg-white/10 flex-shrink-0"
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </button>

      {showMenu && (
        <div ref={menuRef} className="absolute right-0 top-full mt-1 z-50 bg-black/60 backdrop-blur-2xl rounded-lg border border-white/10 py-1 min-w-[120px] shadow-xl">
          {onUnarchive && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(false); onUnarchive(list.id); }}
              className="w-full text-left px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >Unarchive</button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete(list.id); }}
              className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-white/10 transition-colors"
            >Delete</button>
          )}
        </div>
      )}
    </div>
  );
}
