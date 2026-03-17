import React, { useState, useRef } from "react";
import { MoreHorizontal, Trash2, Copy, ArrowRight, Link2 } from "lucide-react";
import { useClickOutside } from "./useClickOutside";

interface OverflowMenuProps {
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveToList: () => void;
  onCopyLink: () => void;
}

export function OverflowMenu({
  onDelete,
  onDuplicate,
  onMoveToList,
  onCopyLink,
}: OverflowMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setIsOpen(false));

  const items: {
    icon: typeof Copy;
    label: string;
    action: () => void;
    danger?: boolean;
  }[] = [
    { icon: Copy, label: "Duplicate", action: onDuplicate },
    { icon: ArrowRight, label: "Move to List\u2026", action: onMoveToList },
    { icon: Link2, label: "Copy Link", action: onCopyLink },
    { icon: Trash2, label: "Delete", action: onDelete, danger: true },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-full transition-colors"
      >
        <MoreHorizontal size={16} />
      </button>
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-black/80 backdrop-blur-xl rounded-lg border border-white/10 shadow-xl z-10 py-1">
          {items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                item.action();
                setIsOpen(false);
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                item.danger
                  ? "text-red-400 hover:bg-red-500/10"
                  : "text-white/80 hover:bg-white/10"
              }`}
            >
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
