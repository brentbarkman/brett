import React from "react";
import { Zap } from "lucide-react";

interface InboxDragOverlayProps {
  title: string;
  count: number;
}

export function InboxDragOverlay({ title, count }: InboxDragOverlayProps) {
  return (
    <div
      className="bg-black/60 backdrop-blur-xl rounded-lg border border-white/20 px-3 py-2 shadow-2xl"
      style={{ transform: "rotate(2deg)" }}
    >
      <div className="flex items-center gap-2">
        <Zap size={14} className="text-blue-400" />
        <span className="text-sm text-white/90 truncate max-w-[200px]">
          {title}
        </span>
        {count > 1 && (
          <span className="bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
            {count}
          </span>
        )}
      </div>
    </div>
  );
}
